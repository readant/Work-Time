import * as vscode from 'vscode';
import {
    CommitRecord,
    DailyStats,
    FileDailyStats,
    ProjectDailyStats,
    TrackerState,
} from './types';
import { Storage } from './storage';
import { AdaptiveThreshold } from './adaptive';

/** 日期格式 YYYY-MM-DD（使用系统本地时区）。 */
function todayString(): string {
    return fmtLocalDate(new Date());
}

/** 格式化 Date 为 YYYY-MM-DD（系统本地时区）。 */
function fmtLocalDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

/**
 * 编码时间追踪器。
 *
 * - 每秒轮询更新计时
 * - 区分 Active / Idle / Away 三种状态
 * - 监听文档变更统计行增删和按键
 * - 监听 Git 提交并记录
 * - 自适应空闲阈值（P90 滑动窗口）
 * - 跨日自动保存昨日数据
 */
export class CodingTracker {
    private storage: Storage;
    private adaptive: AdaptiveThreshold;
    private state: TrackerState = TrackerState.Away;
    private lastActivityTime: number = Date.now();
    private tickTimer: ReturnType<typeof setInterval> | null = null;
    private saveTimer: ReturnType<typeof setInterval> | null = null;
    private today: string = todayString();
    private todayStats!: DailyStats;

    private currentProject: string | null = null;
    private currentFile = '';
    private currentLanguage = '';

    private idleTimeout = 300;
    private afkTimeout = 600;
    private disposables: vscode.Disposable[] = [];

    /** 仓库路径 → 上次记录的 HEAD commit 哈希 */
    private lastHeadMap = new Map<string, string>();

    constructor(storage: Storage) {
        this.storage = storage;
        this.adaptive = new AdaptiveThreshold();
    }

    // ============ 生命周期 ============

    async start(context: vscode.ExtensionContext): Promise<void> {
        this.reloadConfig();

        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((e) => {
                if (e.affectsConfiguration('workTime')) {
                    this.reloadConfig();
                }
            })
        );

        // 加载今日数据（处理旧数据中可能没有 commits 字段的情况）
        this.today = todayString();
        const loaded = await this.storage.loadDay(this.today);
        this.todayStats = {
            ...loaded,
            commits: loaded.commits ?? [],
            problemCount: loaded.problemCount ?? 0,
        };

        this.updateProject();
        this.updateFile();

        this.disposables.push(
            vscode.window.onDidChangeWindowState((e) => {
                if (e.focused) {
                    this.onActivity();
                } else {
                    this.setState(TrackerState.Away);
                }
            })
        );

        this.disposables.push(
            vscode.window.onDidChangeActiveTextEditor(() => {
                this.onActivity();
                this.updateFile();
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeTextDocument((e) => {
                this.onActivity();
                this.recordEdit(e);
            })
        );

        this.disposables.push(
            vscode.workspace.onDidChangeWorkspaceFolders(() => {
                this.updateProject();
            })
        );

        // Git 集成
        this.setupGitWatcher(context);

        // 如果窗口已聚焦，立即激活
        if (vscode.window.state.focused) {
            this.setState(TrackerState.Active);
        }

        this.tickTimer = setInterval(() => this.onTick(), 1000);
        this.saveTimer = setInterval(() => this.saveToday(), 60_000);

        context.subscriptions.push(...this.disposables);
    }

    async stop(): Promise<void> {
        this.clearTimers();
        this.setState(TrackerState.Away);
        await this.saveToday();
    }

    getState(): TrackerState {
        return this.state;
    }

    /** 暴露活动间隔快照，供外部（如番茄钟）做智能推荐。 */
    getIntervalsSnapshot(): number[] {
        return this.adaptive.getIntervals();
    }

    /** 记录刷题数量（累加到当日）。 */
    addProblemCount(count: number): void {
        this.todayStats.problemCount += count;
    }

    getTodayStats(): Readonly<DailyStats> {
        return this.todayStats;
    }

    // ============ Git 监听 ============

    private setupGitWatcher(context: vscode.ExtensionContext): void {
        try {
            const gitExt = vscode.extensions.getExtension('vscode.git');
            if (!gitExt?.exports) return;

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const api: any = gitExt.exports.getAPI(1);
            if (!api) return;

            // 记录当前所有仓库的 HEAD
            const trackRepo = (repo: any) => {
                const path = repo.rootUri.fsPath;
                const hash = repo.state?.HEAD?.commit ?? '';
                this.lastHeadMap.set(path, hash);

                try {
                    repo.state?.onDidChange(() => {
                        this.checkNewCommit(path, repo);
                    });
                } catch {
                    // onDidChange 可能不可用，回退到不监听
                }
            };

            // 已有仓库
            for (const repo of api.repositories ?? []) {
                trackRepo(repo);
            }

            // 新打开的仓库
            if (typeof api.onDidOpenRepository === 'function') {
                this.disposables.push(
                    api.onDidOpenRepository((repo: any) => {
                        trackRepo(repo);
                    })
                );
            }
        } catch {
            // Git 扩展不可用时静默跳过
        }
    }

    private async checkNewCommit(
        repoPath: string,
        repo: any
    ): Promise<void> {
        const newHash = repo.state?.HEAD?.commit ?? '';
        const oldHash = this.lastHeadMap.get(repoPath) ?? '';

        if (newHash && newHash !== oldHash) {
            this.lastHeadMap.set(repoPath, newHash);
            try {
                const commits = await repo.log({ maxEntries: 1 });
                if (commits.length > 0) {
                    const c = commits[0];
                    const record: CommitRecord = {
                        timestamp: Date.now(),
                        message: c.message.split('\n')[0].slice(0, 200),
                        hash: c.hash,
                        project: this.projectNameFromPath(repoPath),
                    };
                    this.todayStats.commits.push(record);
                    console.log(`[work-time] commit: ${c.hash.slice(0, 7)} ${record.message}`);
                }
            } catch {
                // 静默失败
            }
        }
    }

    private projectNameFromPath(repoPath: string): string {
        const parts = repoPath.replace(/\\/g, '/').split('/');
        return parts[parts.length - 1] || repoPath;
    }

    // ============ 内部逻辑 ============

    private onActivity(): void {
        const now = Date.now();
        const interval = now - this.lastActivityTime;

        // 记录活动间隔供自适应分析（仅当前活跃/空闲状态下的间隔）
        if (
            this.state === TrackerState.Active ||
            this.state === TrackerState.Idle
        ) {
            this.adaptive.recordInterval(interval);
        }

        this.lastActivityTime = now;
        if (
            this.state === TrackerState.Idle ||
            this.state === TrackerState.Away
        ) {
            if (vscode.window.state.focused) {
                this.setState(TrackerState.Active);
            }
        }
    }

    private async onTick(): Promise<void> {
        const now = Date.now();

        // 跨日检测：先取快照再异步保存，避免数据竞态
        const day = todayString();
        if (day !== this.today) {
            const snapshot = this.todayStats;
            this.today = day;
            try {
                await this.storage.saveDay(snapshot);
            } catch {
                console.warn('[work-time] 保存昨日数据失败');
            }
            this.adaptive.tryApply(day);
            this.todayStats = {
                date: day,
                totalActiveTime: 0,
                totalCodingTime: 0,
                totalKeystrokes: 0,
                totalLinesAdded: 0,
                totalLinesDeleted: 0,
                commits: [],
                projects: {},
                languages: {},
                problemCount: 0,
            };
        }

        const idleSeconds = (now - this.lastActivityTime) / 1000;

        if (this.state === TrackerState.Away) {
            return;
        }

        if (this.state === TrackerState.Active) {
            if (idleSeconds >= this.idleTimeout) {
                if (idleSeconds >= this.afkTimeout) {
                    this.setState(TrackerState.Away);
                    return;
                }
                this.setState(TrackerState.Idle);
                this.addSecond(true, false);
                return;
            }
            this.addSecond(true, true);
            return;
        }

        if (this.state === TrackerState.Idle) {
            if (idleSeconds >= this.afkTimeout) {
                this.setState(TrackerState.Away);
                return;
            }
            this.addSecond(true, false);
        }
    }

    private addSecond(active: boolean, coding: boolean): void {
        if (active) {
            this.todayStats.totalActiveTime++;
        }
        if (coding) {
            this.todayStats.totalCodingTime++;
            if (this.currentProject) {
                const proj = this.ensureProject(this.currentProject);
                proj.codingTime++;
                if (this.currentFile) {
                    const file = this.ensureFile(proj, this.currentFile);
                    file.codingTime++;
                }
            }
            if (this.currentLanguage) {
                const lang = this.ensureLanguage(this.currentLanguage);
                lang.codingTime++;
            }
        }
        if (active && this.currentProject) {
            const proj = this.ensureProject(this.currentProject);
            proj.activeTime++;
        }
    }

    private recordEdit(e: vscode.TextDocumentChangeEvent): void {
        if (!this.currentProject) return;

        const changedFile = vscode.workspace.asRelativePath(
            e.document.uri,
            false
        );
        if (!changedFile) return;

        let keystrokes = 0;
        let linesAdded = 0;
        let linesDeleted = 0;

        for (const change of e.contentChanges) {
            keystrokes += Math.max(1, change.text.length);
            const oldLines =
                change.range.end.line - change.range.start.line;
            const newLines = change.text.split('\n').length - 1;
            linesAdded += newLines;
            linesDeleted += oldLines;
        }

        const proj = this.ensureProject(this.currentProject);
        const file = this.ensureFile(proj, changedFile);

        file.keystrokes += keystrokes;
        file.linesAdded += linesAdded;
        file.linesDeleted += linesDeleted;
        proj.keystrokes += keystrokes;
        proj.linesAdded += linesAdded;
        proj.linesDeleted += linesDeleted;
        this.todayStats.totalKeystrokes += keystrokes;
        this.todayStats.totalLinesAdded += linesAdded;
        this.todayStats.totalLinesDeleted += linesDeleted;

        const langId = e.document.languageId;
        if (langId) {
            const lang = this.ensureLanguage(langId);
            lang.keystrokes += keystrokes;
            lang.linesAdded += linesAdded;
            lang.linesDeleted += linesDeleted;
        }
    }

    // ============ 持久化 ============

    private async saveToday(): Promise<void> {
        try {
            await this.storage.saveDay(this.todayStats);
        } catch {
            console.warn('[work-time] 保存今日数据失败');
        }
    }

    // ============ 状态切换 ============

    private setState(newState: TrackerState): void {
        if (this.state === newState) return;
        const old = this.state;
        this.state = newState;
        console.log(`[work-time] ${old} → ${newState}`);
    }

    // ============ 环境和配置 ============

    private updateProject(): void {
        const folder = vscode.workspace.workspaceFolders?.[0];
        this.currentProject = folder?.name ?? null;
    }

    private updateFile(): void {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            this.currentFile = vscode.workspace.asRelativePath(
                editor.document.uri,
                false
            );
            this.currentLanguage = editor.document.languageId;
        } else {
            this.currentFile = '';
            this.currentLanguage = '';
        }
    }

    private reloadConfig(): void {
        const cfg = vscode.workspace.getConfiguration('workTime');
        this.idleTimeout = Math.max(10, cfg.get<number>('idleTimeout', 300));
        this.afkTimeout = Math.max(
            this.idleTimeout + 10,
            cfg.get<number>('afkTimeout', 600)
        );
    }

    private clearTimers(): void {
        if (this.tickTimer) {
            clearInterval(this.tickTimer);
            this.tickTimer = null;
        }
        if (this.saveTimer) {
            clearInterval(this.saveTimer);
            this.saveTimer = null;
        }
    }

    // ============ 数据辅助 ============

    private ensureProject(name: string): ProjectDailyStats {
        if (!this.todayStats.projects[name]) {
            this.todayStats.projects[name] = {
                activeTime: 0,
                codingTime: 0,
                keystrokes: 0,
                linesAdded: 0,
                linesDeleted: 0,
                files: {},
            };
        }
        return this.todayStats.projects[name];
    }

    private ensureFile(
        proj: ProjectDailyStats,
        path: string
    ): FileDailyStats {
        if (!proj.files[path]) {
            proj.files[path] = {
                codingTime: 0,
                keystrokes: 0,
                linesAdded: 0,
                linesDeleted: 0,
            };
        }
        return proj.files[path];
    }

    private ensureLanguage(lang: string): FileDailyStats {
        if (!this.todayStats.languages[lang]) {
            this.todayStats.languages[lang] = {
                codingTime: 0,
                keystrokes: 0,
                linesAdded: 0,
                linesDeleted: 0,
            };
        }
        return this.todayStats.languages[lang];
    }
}
