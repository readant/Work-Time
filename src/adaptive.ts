import * as vscode from 'vscode';

/**
 * 自适应空闲阈值。
 *
 * 维护最近 N 次活跃间隔的滑动窗口，基于 P90 动态调整 idleTimeout。
 * 调整仅在新一天开始时触发，避免运行时频繁变更配置。
 */
export class AdaptiveThreshold {
    /** 滑动窗口最大长度 */
    private static readonly WINDOW_SIZE = 200;
    /** 最小 idleTimeout（秒） */
    private static readonly MIN_IDLE = 60;
    /** 最大 idleTimeout（秒） */
    private static readonly MAX_IDLE = 900;
    /** afkTimeout 相对于 idleTimeout 的乘数 */
    private static readonly AFK_MULTIPLIER = 2;

    private intervals: number[] = [];
    private lastApplyDate = '';

    /**
     * 记录一次活动间隔（毫秒）。
     * 仅录入 1s ~ 1h 之间的合理间隔。
     */
    recordInterval(ms: number): void {
        if (ms < 1000 || ms > 3600_000) return;
        this.intervals.push(ms);
        if (this.intervals.length > AdaptiveThreshold.WINDOW_SIZE) {
            this.intervals.shift();
        }
    }

    /**
     * 尝试应用自适应阈值。每天仅执行一次。
     */
    tryApply(date: string): void {
        if (date === this.lastApplyDate) return;
        if (this.intervals.length < 10) return; // 样本不足

        this.lastApplyDate = date;

        const p90Ms = this.p90(this.intervals);
        // 将 P90 毫秒转为秒，上下限裁剪
        let idleSec = Math.round(p90Ms / 1000);
        idleSec = Math.max(AdaptiveThreshold.MIN_IDLE, idleSec);
        idleSec = Math.min(AdaptiveThreshold.MAX_IDLE, idleSec);

        const afkSec = idleSec * AdaptiveThreshold.AFK_MULTIPLIER;

        const cfg = vscode.workspace.getConfiguration('workTime');
        const currentIdle = cfg.get<number>('idleTimeout', 300);

        // 只在变化超过 30 秒时才更新，避免频繁波动
        if (Math.abs(currentIdle - idleSec) < 30) return;

        cfg.update('idleTimeout', idleSec, vscode.ConfigurationTarget.Global);
        cfg.update('afkTimeout', afkSec, vscode.ConfigurationTarget.Global);

        console.log(
            `[adaptive] idleTimeout: ${currentIdle}s → ${idleSec}s, ` +
                `afkTimeout → ${afkSec}s (P90=${p90Ms}ms, n=${this.intervals.length})`
        );
    }

    /**
     * 重置滑动窗口。
     */
    reset(): void {
        this.intervals = [];
        this.lastApplyDate = '';
    }

    // ---- 内部 ----

    /** 计算第 90 百分位数。 */
    private p90(values: number[]): number {
        const sorted = [...values].sort((a, b) => a - b);
        const idx = Math.ceil(sorted.length * 0.9) - 1;
        return sorted[Math.max(0, idx)];
    }
}
