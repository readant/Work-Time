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
            // 顶级节点
            return [
                this.buildOverviewSection(),
                this.buildActionsSection(),
                ...(await this.buildRecentSessions()),
            ];
        }

        // 子节点
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
        const item = new vscode.TreeItem('今日概览', vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = 'overview';
        item.iconPath = new vscode.ThemeIcon('graph');
        return item;
    }

    private buildOverviewItems(): vscode.TreeItem[] {
        const stats = this.tracker.getTodayStats();
        const state = this.tracker.getState();

        const stateLabel =
            state === TrackerState.Active ? '🟢 活跃中' :
            state === TrackerState.Idle ? '🟡 空闲' : '⚪ 离开';

        const codingTime = fmtDuration(stats.totalCodingTime);
        const activeTime = fmtDuration(stats.totalActiveTime);

        return [
            this.makeInfoItem('状态', stateLabel, 'rocket'),
            this.makeInfoItem('编码时间', codingTime, 'clock'),
            this.makeInfoItem('活跃时间', activeTime, 'pulse'),
            this.makeInfoItem('按键次数', stats.totalKeystrokes.toLocaleString(), 'keyboard'),
            this.makeInfoItem('行变更', `+${stats.totalLinesAdded} / -${stats.totalLinesDeleted}`, 'diff-added'),
            this.makeInfoItem('提交数', String((stats.commits ?? []).length), 'git-commit'),
        ];
    }

    // ============ 快捷操作 ============

    private buildActionsSection(): vscode.TreeItem {
        const item = new vscode.TreeItem('快捷操作', vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = 'actions';
        item.iconPath = new vscode.ThemeIcon('zap');
        return item;
    }

    private buildActionItems(): vscode.TreeItem[] {
        const sessionActive = this.sessionTimer.getState() !== SessionTimerState.Idle;
        const items: vscode.TreeItem[] = [];

        if (!sessionActive) {
            items.push(this.makeActionItem('开始文件计时', 'work-time.sessionStart', 'play'));
        } else {
            items.push(this.makeActionItem('暂停/恢复计时', 'work-time.sessionTogglePause', 'debug-pause'));
            items.push(this.makeActionItem('停止计时', 'work-time.sessionStop', 'debug-stop'));
        }

        items.push(this.makeActionItem('启动番茄钟', 'work-time.pomodoroStart', 'target'));
        items.push(this.makeActionItem('打开统计面板', 'work-time.showStats', 'chart-bar'));

        return items;
    }

    // ============ 最近会话 ============

    private buildRecentSessionsSection(): vscode.TreeItem {
        const item = new vscode.TreeItem('最近会话', vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = 'sessions';
        item.iconPath = new vscode.ThemeIcon('history');
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
                item.iconPath = new vscode.ThemeIcon('info');
                return [item];
            }

            return top5.map(r => {
                const item = new vscode.TreeItem(r.fileName);
                item.description = fmtDuration(r.duration);
                item.tooltip = `${r.filePath}\n${fmtDuration(r.duration)} | 按键 ${r.keystrokes} | +${r.linesAdded}/-${r.linesDeleted}`;
                item.iconPath = new vscode.ThemeIcon('file');
                return item;
            });
        } catch {
            return [];
        }
    }

    // ============ 工具方法 ============

    private makeInfoItem(label: string, value: string, icon: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label);
        item.description = value;
        item.iconPath = new vscode.ThemeIcon(icon);
        return item;
    }

    private makeActionItem(label: string, command: string, icon: string): vscode.TreeItem {
        const item = new vscode.TreeItem(label);
        item.command = { command, title: label };
        item.iconPath = new vscode.ThemeIcon(icon);
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

function fmtDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return '0s';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}
