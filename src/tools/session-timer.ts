import * as vscode from 'vscode';
import {
    FileStatsSnapshot,
    PauseInterval,
    SessionRecord,
    SessionTimerState,
} from '../types';
import { CodingTracker } from '../tracker';
import { Storage } from '../storage';

/**
 * 文件绑定会话计时器。
 *
 * - 右键文件 → 开始计时，计时器绑定该文件
 * - 切换到其他文件自动暂停，切回自动恢复
 * - 结束时保存 SessionRecord
 * - 复用 tracker 的实时统计做增量计算
 */
export class SessionTimer {
    private state: SessionTimerState = SessionTimerState.Idle;
    private filePath: string | null = null;
    private fileName: string = '';
    private project: string = '';
    private startTime: number = 0;
    private elapsed: number = 0;
    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private tracker: CodingTracker;
    private storage: Storage;
    private startSnapshot: FileStatsSnapshot | null = null;
    private pauseStart: number = 0;
    private pauseIntervals: PauseInterval[] = [];
    private autoPaused: boolean = false;
    private disposables: vscode.Disposable[] = [];

    readonly statusBarItem: vscode.StatusBarItem;

    constructor(tracker: CodingTracker, storage: Storage) {
        this.tracker = tracker;
        this.storage = storage;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            101
        );
        this.statusBarItem.command = 'work-time.sessionTogglePause';
        this.statusBarItem.hide();
    }

    // ============ 公开 API ============

    /** 开始对指定文件计时。filePath 为工作区相对路径。 */
    async start(filePath: string): Promise<void> {
        // 如果已有活跃会话，提示
        if (this.state !== SessionTimerState.Idle) {
            const choice = await vscode.window.showWarningMessage(
                `已有活跃会话 "${this.fileName}"。先停止当前会话？`,
                '停止并开始新会话',
                '取消'
            );
            if (choice !== '停止并开始新会话') return;
            await this.stop();
        }

        this.filePath = filePath;
        this.fileName = filePath.split(/[/\\]/).pop() ?? filePath;
        this.project =
            vscode.workspace.workspaceFolders?.[0]?.name ?? '';
        this.startTime = Date.now();
        this.elapsed = 0;
        this.pauseIntervals = [];
        this.autoPaused = false;
        this.startSnapshot = this.snapshotFileStats();
        this.state = SessionTimerState.Running;

        this.statusBarItem.show();
        this.setContext(true);
        this.startTicking();
        this.updateStatusBar();

        console.log(`[work-time] session started: ${this.fileName}`);
    }

    /** 暂停计时（用户手动或切换文件自动触发）。 */
    pause(): void {
        if (this.state !== SessionTimerState.Running) return;
        this.state = SessionTimerState.Paused;
        this.pauseStart = Date.now();
        this.stopTicking();
        this.updateStatusBar();
        console.log(`[work-time] session paused: ${this.fileName}`);
    }

    /** 恢复计时。 */
    resume(): void {
        if (this.state !== SessionTimerState.Paused) return;
        if (this.pauseStart > 0) {
            this.pauseIntervals.push({
                start: this.pauseStart,
                end: Date.now(),
            });
            this.pauseStart = 0;
        }
        this.state = SessionTimerState.Running;
        this.startTicking();
        this.updateStatusBar();
        console.log(`[work-time] session resumed: ${this.fileName}`);
    }

    /** 停止计时并保存会话记录。 */
    async stop(): Promise<SessionRecord> {
        // 如果正在暂停中，记录最后的暂停区间
        if (this.pauseStart > 0) {
            this.pauseIntervals.push({
                start: this.pauseStart,
                end: Date.now(),
            });
            this.pauseStart = 0;
        }

        this.stopTicking();

        const endTime = Date.now();
        const diff = this.computeDiff();

        const record: SessionRecord = {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            filePath: this.filePath ?? '',
            fileName: this.fileName,
            project: this.project,
            duration: this.elapsed,
            keystrokes: diff.keystrokes,
            linesAdded: diff.linesAdded,
            linesDeleted: diff.linesDeleted,
            startTime: this.startTime,
            endTime,
            pauses: [...this.pauseIntervals],
        };

        this.state = SessionTimerState.Idle;
        this.filePath = null;
        this.fileName = '';
        this.startSnapshot = null;
        this.pauseIntervals = [];
        this.autoPaused = false;

        this.statusBarItem.hide();
        this.setContext(false);

        // 持久化
        try {
            await this.storage.addSession(record);
            console.log(
                `[work-time] session saved: ${record.fileName} ${formatDuration(record.duration)}`
            );
        } catch {
            console.warn('[work-time] 保存会话记录失败');
        }

        return record;
    }

    getState(): SessionTimerState {
        return this.state;
    }

    getElapsed(): number {
        return this.elapsed;
    }

    /** 获取当前计时文件名（供外部显示）。 */
    getFileName(): string {
        return this.fileName;
    }

    /** 注册编辑器切换监听，实现自动暂停/恢复。在 activate 中调用一次。 */
    registerEditorListener(): void {
        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor((editor) => {
                if (!this.filePath) return;
                if (
                    this.state !== SessionTimerState.Running &&
                    this.state !== SessionTimerState.Paused
                )
                    return;

                const currentPath = editor
                    ? vscode.workspace.asRelativePath(editor.document.uri, false)
                    : '';

                if (this.state === SessionTimerState.Running) {
                    if (currentPath !== this.filePath) {
                        this.autoPaused = true;
                        this.pause();
                    }
                } else if (
                    this.state === SessionTimerState.Paused &&
                    this.autoPaused
                ) {
                    if (currentPath === this.filePath) {
                        this.autoPaused = false;
                        this.resume();
                    }
                }
            })
        );
    }

    dispose(): void {
        this.stopTicking();
        for (const d of this.disposables) d.dispose();
        this.statusBarItem.dispose();
    }

    // ============ 内部 ============

    private startTicking(): void {
        this.stopTicking();
        this.tickTimer = setInterval(() => {
            this.elapsed++;
            this.updateStatusBar();
        }, 1000);
    }

    private stopTicking(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
    }

    private updateStatusBar(): void {
        const time = formatDuration(this.elapsed);
        if (this.state === SessionTimerState.Running) {
            this.statusBarItem.text = `$(watch) ${this.fileName} ${time}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.prominentBackground'
            );
            this.statusBarItem.tooltip = `计时中: ${this.filePath}\n已用时 ${time}`;
        } else if (this.state === SessionTimerState.Paused) {
            this.statusBarItem.text = `$(debug-pause) ${this.fileName} ${time}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
            this.statusBarItem.tooltip = `已暂停: ${this.filePath}\n已用时 ${time}`;
        }
    }

    private snapshotFileStats(): FileStatsSnapshot {
        const stats = this.tracker.getTodayStats();
        const proj = this.project ? stats.projects[this.project] : undefined;
        if (!proj || !this.filePath || !proj.files[this.filePath]) {
            return { keystrokes: 0, linesAdded: 0, linesDeleted: 0 };
        }
        const f = proj.files[this.filePath];
        return {
            keystrokes: f.keystrokes,
            linesAdded: f.linesAdded,
            linesDeleted: f.linesDeleted,
        };
    }

    private computeDiff(): FileStatsSnapshot {
        const end = this.snapshotFileStats();
        if (!this.startSnapshot) return { keystrokes: 0, linesAdded: 0, linesDeleted: 0 };
        return {
            keystrokes: Math.max(0, end.keystrokes - this.startSnapshot.keystrokes),
            linesAdded: Math.max(0, end.linesAdded - this.startSnapshot.linesAdded),
            linesDeleted: Math.max(0, end.linesDeleted - this.startSnapshot.linesDeleted),
        };
    }

    private setContext(active: boolean): void {
        vscode.commands.executeCommand(
            'setContext',
            'workTime.sessionActive',
            active
        );
    }
}

function formatDuration(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}
