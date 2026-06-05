import * as vscode from 'vscode';
import { PomodoroPhase, PomodoroSettings } from '../types';
import { CodingTracker } from '../tracker';
import { TrackerState } from '../types';

/** 用 Unicode block 字符画进度条：█████░░░░░ */
function progressBar(pct: number): string {
    const w = 8;
    const filled = Math.round(Math.max(0, Math.min(1, pct)) * w);
    return '▐'.repeat(filled) + '░'.repeat(w - filled);
}

/**
 * 智能番茄钟。
 *
 * - 基于用户自适应节奏推荐专注时长
 * - 自动检测离开/返回，暂停/恢复计时
 * - 状态栏实时倒计时
 */
export class SmartPomodoro {
    private phase: PomodoroPhase = PomodoroPhase.Idle;
    private remaining: number = 0;
    private completed: number = 0; // 当前周期内已完成的专注次数
    private settings!: PomodoroSettings;
    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private tracker: CodingTracker;
    private autoStopped: boolean = false; // 是否因离开而自动暂停
    private prePausePhase: PomodoroPhase = PomodoroPhase.Focusing; // 暂停前状态

    readonly statusBarItem: vscode.StatusBarItem;

    constructor(tracker: CodingTracker) {
        this.tracker = tracker;
        this.statusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            102
        );
        this.statusBarItem.command = 'work-time.pomodoroTogglePause';
        this.statusBarItem.text = '$(target) 开始';
        this.statusBarItem.tooltip = '点击启动番茄钟';
        this.statusBarItem.show();
        this.reloadConfig();
    }

    // ============ 公开 API ============

    /** 开始一次专注。可传入自定义时长（秒），否则使用配置/推荐值。 */
    start(duration?: number): void {
        if (this.phase !== PomodoroPhase.Idle) return;

        const sec = duration ?? this.getRecommendedDuration();
        this.phase = PomodoroPhase.Focusing;
        this.remaining = sec;
        this.autoStopped = false;
        this.prePausePhase = PomodoroPhase.Focusing;
        this.statusBarItem.show();
        this.setContext(true);
        this.startTicking();
        this.tick(); // 立即刷新状态栏

        console.log(`[work-time] pomodoro focus started: ${Math.round(sec / 60)} min`);
    }

    /** 恢复计时（手动或离开后自动调用均可）。 */
    resume(): void {
        if (this.phase !== PomodoroPhase.Idle) return;
        if (
            this.prePausePhase !== PomodoroPhase.Focusing &&
            this.prePausePhase !== PomodoroPhase.ShortBreak &&
            this.prePausePhase !== PomodoroPhase.LongBreak
        )
            return;
        this.phase = this.prePausePhase;
        this.autoStopped = false;
        this.setContext(true);
        this.startTicking();
        this.tick();
        console.log('[work-time] pomodoro resumed');
    }

    /** 手动暂停当前番茄钟。 */
    pause(): void {
        if (
            this.phase !== PomodoroPhase.Focusing &&
            this.phase !== PomodoroPhase.ShortBreak &&
            this.phase !== PomodoroPhase.LongBreak
        )
            return;
        this.prePausePhase = this.phase;
        this.phase = PomodoroPhase.Idle;
        this.autoStopped = false; // 手动暂停，不会自动恢复
        this.stopTicking();
        this.statusBarItem.text = '$(debug-pause) 已暂停';
        this.setContext(false);
        console.log('[work-time] pomodoro paused');
    }

    /** 停止番茄钟，回到 Idle。 */
    stop(): void {
        this.phase = PomodoroPhase.Idle;
        this.remaining = 0;
        this.autoStopped = false;
        this.stopTicking();
        this.statusBarItem.hide();
        this.setContext(false);
        console.log('[work-time] pomodoro stopped');
    }

    /** 跳过当前休息，立即开始下一轮专注。 */
    skipBreak(): void {
        if (
            this.phase !== PomodoroPhase.ShortBreak &&
            this.phase !== PomodoroPhase.LongBreak
        )
            return;
        this.stopTicking();
        this.phase = PomodoroPhase.Focusing;
        this.remaining = this.settings.focusDuration;
        this.startTicking();
        this.tick();
        vscode.window.showInformationMessage('🍅 休息已跳过，开始新的专注');
        console.log('[work-time] pomodoro break skipped');
    }

    getPhase(): PomodoroPhase {
        return this.phase;
    }

    getRemaining(): number {
        return this.remaining;
    }

    /** 智能推荐专注时长（秒）。基于自适应 idleTimeout。 */
    getRecommendedDuration(): number {
        if (!this.settings.enableSmartRecommend) {
            return this.settings.focusDuration;
        }
        // 读取当前生效的 idleTimeout（可能已被自适应模块调整过）
        const cfg = vscode.workspace.getConfiguration('workTime');
        const idleSec = cfg.get<number>('idleTimeout', 300);
        // 映射：idle 阈值越高 → 用户越专注 → 推荐更长的番茄钟
        if (idleSec < 180) return 20 * 60; // 容易分心 → 20 分钟
        if (idleSec < 420) return 25 * 60; // 中等 → 25 分钟（经典）
        return 40 * 60; // 专注力强 → 40 分钟
    }

    reloadConfig(): void {
        const cfg = vscode.workspace.getConfiguration('workTime.pomodoro');
        this.settings = {
            focusDuration: Math.max(60, cfg.get<number>('focusDuration', 1500)),
            shortBreakDuration: Math.max(30, cfg.get<number>('shortBreakDuration', 300)),
            longBreakDuration: Math.max(60, cfg.get<number>('longBreakDuration', 900)),
            longBreakInterval: Math.max(1, cfg.get<number>('longBreakInterval', 4)),
            autoStartBreak: cfg.get<boolean>('autoStartBreak', false),
            autoStartFocus: cfg.get<boolean>('autoStartFocus', false),
            enableSmartRecommend: cfg.get<boolean>('enableSmartRecommend', true),
        };
    }

    dispose(): void {
        this.stopTicking();
        this.statusBarItem.dispose();
    }

    // ============ 内部逻辑 ============

    private startTicking(): void {
        this.stopTicking();
        this.tickTimer = setInterval(() => this.tick(), 1000);
    }

    private stopTicking(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
    }

    private tick(): void {
        if (this.phase === PomodoroPhase.Idle) return;

        // 自动暂停检测：用户离开 VS Code
        const trackerState = this.tracker.getState();
        if (trackerState === TrackerState.Away) {
            if (
                this.phase === PomodoroPhase.Focusing ||
                this.phase === PomodoroPhase.ShortBreak ||
                this.phase === PomodoroPhase.LongBreak
            ) {
                this.prePausePhase = this.phase;
                this.phase = PomodoroPhase.Idle;
                this.autoStopped = true;
                this.stopTicking();
                this.statusBarItem.text = '$(debug-pause) Away';
                console.log('[work-time] pomodoro auto-paused (away)');
            }
            return;
        }

        // 自动恢复检测：用户回到活跃
        if (this.autoStopped) {
            this.autoStopped = false;
            this.phase = this.prePausePhase;
            this.startTicking();
            console.log('[work-time] pomodoro auto-resumed');
        }

        // 倒计时
        this.remaining--;
        this.updateStatusBar();

        if (this.remaining <= 0) {
            this.onPhaseEnd();
        }
    }

    private onPhaseEnd(): void {
        this.stopTicking();

        if (this.phase === PomodoroPhase.Focusing) {
            this.completed++;
            const isLongBreak =
                this.completed % this.settings.longBreakInterval === 0;

            if (isLongBreak) {
                this.phase = PomodoroPhase.LongBreak;
                this.remaining = this.settings.longBreakDuration;
                vscode.window
                    .showInformationMessage(
                        `🍅 专注完成！${this.completed} 轮了，来一次长休息吧（${Math.round(this.remaining / 60)} 分钟）`,
                        '开始休息'
                    )
                    .then(
                        (choice) => {
                            if (choice === '开始休息' || this.settings.autoStartBreak) {
                                this.startTicking();
                                this.tick();
                            } else {
                                this.phase = PomodoroPhase.Idle;
                                this.statusBarItem.text = '$(debug-pause) 跳过休息';
                            }
                        }
                    );
            } else {
                this.phase = PomodoroPhase.ShortBreak;
                this.remaining = this.settings.shortBreakDuration;
                vscode.window
                    .showInformationMessage(
                        `🍅 专注完成！休息 ${Math.round(this.remaining / 60)} 分钟吧`,
                        '开始休息'
                    )
                    .then((choice) => {
                        if (choice === '开始休息' || this.settings.autoStartBreak) {
                            this.startTicking();
                            this.tick();
                        } else {
                            this.phase = PomodoroPhase.Idle;
                            this.statusBarItem.text = '$(debug-pause) Break skipped';
                        }
                    });
            }
        } else {
            // 休息结束
            this.phase = PomodoroPhase.Idle;
            this.statusBarItem.hide();
            this.setContext(false);
            vscode.window
                .showInformationMessage(
                    '☕ 休息结束，开始新的专注？',
                    '开始专注',
                    '结束'
                )
                .then((choice) => {
                    if (choice === '开始专注' || this.settings.autoStartFocus) {
                        this.start();
                    }
                });
        }
    }

    private updateStatusBar(): void {
        const m = Math.floor(this.remaining / 60);
        const s = this.remaining % 60;
        const time = `${m}:${String(s).padStart(2, '0')}`;
        const pct = this.remaining / this.getTotalForPhase();
        const bar = progressBar(pct);

        if (this.phase === PomodoroPhase.Focusing) {
            this.statusBarItem.text = `$(target) ${time} ${bar}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.warningBackground'
            );
            this.statusBarItem.tooltip = `专注中 — 剩余 ${time}`;
        } else if (this.phase === PomodoroPhase.ShortBreak) {
            this.statusBarItem.text = `$(coffee) ${time} ${bar}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.prominentBackground'
            );
            this.statusBarItem.tooltip = `短休息 — 剩余 ${time}`;
        } else if (this.phase === PomodoroPhase.LongBreak) {
            this.statusBarItem.text = `$(coffee) ${time} ${bar}`;
            this.statusBarItem.backgroundColor = new vscode.ThemeColor(
                'statusBarItem.prominentBackground'
            );
            this.statusBarItem.tooltip = `长休息 — 剩余 ${time}`;
        }
    }

    private getTotalForPhase(): number {
        if (this.phase === PomodoroPhase.ShortBreak)
            return this.settings.shortBreakDuration;
        if (this.phase === PomodoroPhase.LongBreak)
            return this.settings.longBreakDuration;
        return this.settings.focusDuration;
    }

    private setContext(active: boolean): void {
        vscode.commands.executeCommand(
            'setContext',
            'workTime.pomodoroActive',
            active
        );
    }
}
