import * as vscode from 'vscode';
import { CodingTracker } from '../tracker';
import { SessionTimer } from './session-timer';
import { Storage } from '../storage';
import { SessionTimerState, TrackerState } from '../types';

/**
 * 侧边栏 Tree View 数据提供者。
 *
 * 树结构：
 *   今日概览（状态、编码时间、按键、行变更）
 *   快捷操作（开始计时、番茄钟、打开面板）
 *   最近会话（最近 5 条会话记录）
 */
export class SidebarProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<vscode.TreeItem | undefined>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private tracker: CodingTracker;
    private sessionTimer: SessionTimer;
    private storage: Storage;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;

    constructor(tracker: CodingTracker, sessionTimer: SessionTimer, storage: Storage) {
        this.tracker = tracker;
        this.sessionTimer = sessionTimer;
        this.storage = storage;
    }

    /** 启动自动刷新（每 5 秒）。 */
    startAutoRefresh(): void {
        this.refreshTimer = setInterval(() => this.refresh(), 5_000);
    }

    refresh(): void {
        this._onDidChangeTreeData.fire(undefined);
    }

    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        if (!element) {
            return [
                this.buildOverviewSection(),
                this.buildActionsSection(),
                ...(await this.buildRecentSessions()),
            ];
        }

        if (element.contextValue === 'overview') {
            return this.buildOverviewItems();
        }
        if (element.contextValue === 'actions') {
            return this.buildActionItems();
        }
        if (element.contextValue === 'sessions') {
            return this.buildSessionItems();
        }

        return [];
    }

    // ============ 今日概览 ============

    private buildOverviewSection(): vscode.TreeItem {
        const stats = this.tracker.getTodayStats();
        const state = this.tracker.getState();
        const codingTime = fmtDuration(stats.totalCodingTime);

        const item = new vscode.TreeItem(`今日概览  ${codingTime}`, vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = 'overview';

        if (state === TrackerState.Active) {
            item.iconPath = new vscode.ThemeIcon('pulse', new vscode.ThemeColor('charts.green'));
        } else if (state === TrackerState.Idle) {
            item.iconPath = new vscode.ThemeIcon('clock', new vscode.ThemeColor('charts.yellow'));
        } else {
            item.iconPath = new vscode.ThemeIcon('circle-slash', new vscode.ThemeColor('charts.foreground'));
        }

        return item;
    }

    private buildOverviewItems(): vscode.TreeItem[] {
        const stats = this.tracker.getTodayStats();
        const state = this.tracker.getState();

        const stateInfo = getStateInfo(state);
        const codingTime = fmtDuration(stats.totalCodingTime);
        const activeTime = fmtDuration(stats.totalActiveTime);
        const efficiency = stats.totalActiveTime > 0
            ? Math.round((stats.totalCodingTime / stats.totalActiveTime) * 100)
            : 0;

        return [
            this.makeColoredItem('状态', stateInfo.label, stateInfo.icon, stateInfo.color),
            this.makeColoredItem('编码时间', codingTime, 'clock', 'charts.blue'),
            this.makeColoredItem('活跃时间', activeTime, 'watch', 'charts.green'),
            this.makeColoredItem('效率', `${efficiency}%`, 'dashboard', efficiency >= 80 ? 'charts.green' : efficiency >= 50 ? 'charts.yellow' : 'charts.red'),
            this.makeColoredItem('按键', stats.totalKeystrokes.toLocaleString(), 'keyboard', 'charts.foreground'),
            this.makeColoredItem('行变更', `+${stats.totalLinesAdded}  -${stats.totalLinesDeleted}`, 'diff-added', 'charts.foreground'),
            this.makeColoredItem('提交', String((stats.commits ?? []).length), 'git-commit', 'charts.purple'),
        ];
    }

    // ============ 快捷操作 ============

    private buildActionsSection(): vscode.TreeItem {
        const item = new vscode.TreeItem('快捷操作', vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = 'actions';
        item.iconPath = new vscode.ThemeIcon('zap', new vscode.ThemeColor('charts.yellow'));
        return item;
    }

    private buildActionItems(): vscode.TreeItem[] {
        const sessionActive = this.sessionTimer.getState() !== SessionTimerState.Idle;
        const items: vscode.TreeItem[] = [];

        if (!sessionActive) {
            items.push(this.makeCommandItem('开始文件计时', 'work-time.sessionStart', 'play', 'charts.green'));
        } else {
            const elapsed = fmtDuration(this.sessionTimer.getElapsed());
            items.push(this.makeCommandItem(`暂停计时 (${elapsed})`, 'work-time.sessionTogglePause', 'debug-pause', 'charts.yellow'));
            items.push(this.makeCommandItem('停止计时', 'work-time.sessionStop', 'debug-stop', 'charts.red'));
        }

        items.push(this.makeCommandItem('启动番茄钟', 'work-time.pomodoroStart', 'target', 'charts.orange'));
        items.push(this.makeCommandItem('打开统计面板', 'work-time.showStats', 'graph', 'charts.blue'));

        return items;
    }

    // ============ 最近会话 ============

    private buildRecentSessionsSection(): vscode.TreeItem {
        const item = new vscode.TreeItem('最近会话', vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = 'sessions';
        item.iconPath = new vscode.ThemeIcon('history', new vscode.ThemeColor('charts.purple'));
        return item;
    }

    private async buildRecentSessions(): Promise<vscode.TreeItem[]> {
        return [this.buildRecentSessionsSection()];
    }

    private async buildSessionItems(): Promise<vscode.TreeItem[]> {
        try {
            const sDays = await this.storage.listSessionDays();
            const recent = sDays.slice(-3);
            const allRecords = [];
            for (const d of recent) {
                const records = await this.storage.loadSessions(d);
                allRecords.push(...records);
            }
            allRecords.sort((a, b) => b.startTime - a.startTime);
            const top5 = allRecords.slice(0, 5);

            if (top5.length === 0) {
                const item = new vscode.TreeItem('暂无会话记录');
                item.description = '右键文件开始计时';
                item.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('charts.foreground'));
                return [item];
            }

            return top5.map(r => {
                const item = new vscode.TreeItem(r.fileName);
                item.description = fmtDuration(r.duration);
                item.tooltip = [
                    `文件: ${r.filePath}`,
                    `时长: ${fmtDuration(r.duration)}`,
                    `按键: ${r.keystrokes}`,
                    `行变更: +${r.linesAdded} / -${r.linesDeleted}`,
                    `项目: ${r.project}`,
                    `时间: ${formatTimeRange(r.startTime, r.endTime)}`,
                ].join('\n');
                item.iconPath = new vscode.ThemeIcon('file', new vscode.ThemeColor('charts.blue'));
                return item;
            });
        } catch {
            return [];
        }
    }

    // ============ 工具方法 ============

    private makeColoredItem(label: string, value: string, icon: string, color: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label);
        item.description = value;
        item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
        return item;
    }

    private makeCommandItem(label: string, command: string, icon: string, color: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label);
        item.command = { command, title: label };
        item.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
        return item;
    }

    dispose(): void {
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        this._onDidChangeTreeData.dispose();
    }
}

// ============ 辅助函数 ============

function getStateInfo(state: TrackerState): { label: string; icon: string; color: string } {
    switch (state) {
        case TrackerState.Active:
            return { label: '活跃中', icon: 'pulse', color: 'charts.green' };
        case TrackerState.Idle:
            return { label: '空闲', icon: 'clock', color: 'charts.yellow' };
        case TrackerState.Away:
            return { label: '离开', icon: 'circle-slash', color: 'charts.foreground' };
    }
}

function fmtDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

function formatTimeRange(start: number, end: number): string {
    const s = new Date(start);
    const e = new Date(end);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(s.getHours())}:${pad(s.getMinutes())} - ${pad(e.getHours())}:${pad(e.getMinutes())}`;
}
