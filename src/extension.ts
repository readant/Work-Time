import * as vscode from 'vscode';
import { Storage } from './storage';
import { CodingTracker } from './tracker';
import { StatsWebview } from './webview';
import { Reporter } from './reporter';
import { SmartPomodoro } from './tools/pomodoro';
import { SessionTimer } from './tools/session-timer';
import { SidebarProvider } from './tools/sidebar';
import {
    DayDataPoint,
    ExportFormat,
    PomodoroPhase,
    SessionRecord,
    SessionTimerState,
    TrackerState,
    ViewType,
} from './types';

let storage: Storage;
let tracker: CodingTracker;
let webview: StatsWebview;
let statusBarItem: vscode.StatusBarItem;
let pomodoro: SmartPomodoro;
let sessionTimer: SessionTimer;
let sidebar: SidebarProvider;

/**
 * 扩展激活时调用，VS Code 启动完成后触发（onStartupFinished）。
 */
export async function activate(
    context: vscode.ExtensionContext
): Promise<void> {
    console.log('[work-time] 扩展已激活');

    storage = new Storage();
    storage.init(context);

    tracker = new CodingTracker(storage);
    await tracker.start(context);

    webview = new StatsWebview();

    // 智能番茄钟 & 文件计时器
    pomodoro = new SmartPomodoro(tracker);
    sessionTimer = new SessionTimer(tracker, storage);
    sessionTimer.registerEditorListener();

    // 侧边栏 Tree View
    sidebar = new SidebarProvider(tracker, sessionTimer, storage);
    const treeView = vscode.window.createTreeView('workTime.sidebar', {
        treeDataProvider: sidebar,
        showCollapseAll: false,
    });
    sidebar.startAutoRefresh();
    context.subscriptions.push(treeView);
    context.subscriptions.push({ dispose: () => sidebar.dispose() });

    // 状态栏
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'work-time.showStats';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const statusBarTimer = setInterval(() => updateStatusBar(), 30_000);
    context.subscriptions.push({
        dispose: () => clearInterval(statusBarTimer),
    });
    updateStatusBar();

    // 注册命令（原有 + 番茄钟 + 会话计时器）
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'work-time.showStats',
            () => handleShowStats(context.extensionUri, 'today')
        ),
        vscode.commands.registerCommand(
            'work-time.webviewSwitchView',
            (view: ViewType) =>
                handleShowStats(context.extensionUri, view)
        ),
        vscode.commands.registerCommand(
            'work-time.webviewSwitchYear',
            (year: number) =>
                handleShowStats(context.extensionUri, 'all', year)
        ),
        vscode.commands.registerCommand(
            'work-time.exportReport',
            handleExportReport
        ),

        // ---- 番茄钟命令 ----
        vscode.commands.registerCommand(
            'work-time.pomodoroStart',
            () => pomodoro.start()
        ),
        vscode.commands.registerCommand(
            'work-time.pomodoroTogglePause',
            () => {
                if (pomodoro.getPhase() === PomodoroPhase.Idle) {
                    // idle 状态：尝试恢复（之前暂停的），否则启动
                    if (pomodoro.getRemaining() > 0) {
                        pomodoro.resume();
                    } else {
                        pomodoro.start();
                    }
                } else {
                    pomodoro.pause();
                }
            }
        ),
        vscode.commands.registerCommand(
            'work-time.pomodoroStop',
            () => pomodoro.stop()
        ),
        vscode.commands.registerCommand(
            'work-time.pomodoroSkipBreak',
            () => pomodoro.skipBreak()
        ),
        vscode.commands.registerCommand(
            'work-time.pomodoroConfigure',
            () =>
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'workTime.pomodoro'
                )
        ),

        // ---- 会话计时器命令 ----
        vscode.commands.registerCommand(
            'work-time.sessionStart',
            async (uri?: vscode.Uri) => {
                let filePath: string;
                if (uri) {
                    filePath = vscode.workspace.asRelativePath(uri, false);
                } else {
                    const editor = vscode.window.activeTextEditor;
                    if (!editor) {
                        vscode.window.showWarningMessage(
                            '没有打开的文件，请右键文件选择"开始计时"'
                        );
                        return;
                    }
                    filePath = vscode.workspace.asRelativePath(
                        editor.document.uri,
                        false
                    );
                }
                await sessionTimer.start(filePath);
            }
        ),
        vscode.commands.registerCommand(
            'work-time.sessionTogglePause',
            () => {
                const s = sessionTimer.getState();
                if (s === SessionTimerState.Paused) {
                    sessionTimer.resume();
                } else if (s === SessionTimerState.Running) {
                    sessionTimer.pause();
                }
            }
        ),
        vscode.commands.registerCommand(
            'work-time.sessionStop',
            async () => {
                const record = await sessionTimer.stop();
                const m = Math.floor(record.duration / 60);
                const s = record.duration % 60;
                vscode.window.showInformationMessage(
                    `⏱️ 会话已保存: ${record.fileName} — ${m}m ${s}s`
                );
            }
        ),

        // ---- 刷题记录命令 ----
        vscode.commands.registerCommand(
            'work-time.recordProblem',
            async () => {
                const input = await vscode.window.showInputBox({
                    prompt: '输入今日刷题数量',
                    placeHolder: '例如: 3',
                    validateInput: (v) =>
                        /^\d+$/.test(v) ? undefined : '请输入正整数',
                });
                if (!input) return;
                const count = parseInt(input, 10);
                tracker.addProblemCount(count);
                vscode.window.showInformationMessage(
                    `已记录 ${count} 道题，今日共 ${tracker.getTodayStats().problemCount} 道`
                );
            }
        ),

        // 注: pomodoro/sessionTimer 的状态栏项由各自的 dispose() 释放，
        // 此处不 push 到 subscriptions 避免双重 dispose
    );
}

/**
 * 扩展停用时调用。
 */
export async function deactivate(): Promise<void> {
    if (tracker) {
        await tracker.stop();
    }
    // 番茄钟和会话计时器在 dispose 时自动保存/清理
    pomodoro?.dispose();
    sessionTimer?.dispose();
    sidebar?.dispose();
    webview.dispose();
    console.log('[work-time] 扩展已停用');
}

// ============ 命令处理 ============

async function handleShowStats(
    extensionUri: vscode.Uri,
    view: ViewType,
    year?: number
): Promise<void> {
    try {
        console.log('[work-time] handleShowStats called, view=' + view + (year ? ', year=' + year : ''));
        const data = await prepareWebviewData(view, year);
        console.log('[work-time] prepareWebviewData returned, pts=' + (data.dataPoints?.length || 0));
        webview.show(extensionUri, view, data);
        console.log('[work-time] webview.show completed');
    } catch (e: any) {
        console.error('[work-time] handleShowStats error:', e.message, e.stack);
        vscode.window.showErrorMessage('Work Time 面板打开失败: ' + e.message);
    }
}

async function handleExportReport(): Promise<void> {
    const format = await vscode.window.showQuickPick(
        [
            { label: 'TXT 文本', description: '纯文本报告' },
            { label: 'Markdown', description: 'Markdown 格式，支持表格' },
            { label: 'JSON', description: '结构化数据，可二次分析' },
            { label: 'CSV', description: '逗号分隔，可导入 Excel' },
        ],
        { placeHolder: '选择导出格式' }
    );
    if (!format) return;

    const fmtMap: Record<string, ExportFormat> = {
        'TXT 文本': 'txt',
        Markdown: 'md',
        JSON: 'json',
        CSV: 'csv',
    };
    const exportFormat = fmtMap[format.label];

    const days = await storage.listDays();
    if (days.length === 0) {
        vscode.window.showInformationMessage('暂无统计数据');
        return;
    }

    const allDays = await storage.loadRange({
        start: days[0],
        end: days[days.length - 1],
    });
    const summary = Storage.summarizeLoaded(allDays);
    const report = Reporter.generate(allDays, summary, exportFormat);

    const extMap: Record<ExportFormat, string> = {
        txt: 'txt',
        md: 'md',
        json: 'json',
        csv: 'csv',
    };
    const ext = extMap[exportFormat];

    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(`coding-report.${ext}`),
        filters: {
            [ext.toUpperCase() + ' 文件']: [ext],
        },
    });

    if (uri) {
        await vscode.workspace.fs.writeFile(
            uri,
            Buffer.from(report, 'utf-8')
        );
        vscode.window.showInformationMessage(
            `报告已保存至: ${uri.fsPath}`
        );
    }
}

// ============ Webview 数据准备 ============

async function prepareWebviewData(view: ViewType, year?: number) {
    const todayStats = tracker.getTodayStats();
    const state = tracker.getState();
    const selectedYear = year ?? new Date().getFullYear();

    let dataPoints: DayDataPoint[] = [];
    let heatmapDataPoints: DayDataPoint[] = [];
    let summary = null;
    let commits = todayStats.commits ?? [];
    let adaptiveNote = '';
    let availableYears: number[] = [];

    // 获取可用年份列表和热力图数据
    const allDaysList = await storage.listDays();
    if (allDaysList.length > 0) {
        const yearSet = new Set<number>();
        for (const d of allDaysList) {
            yearSet.add(parseInt(d.slice(0, 4)));
        }
        availableYears = Array.from(yearSet).sort((a, b) => b - a);

        // 热力图始终加载全部历史数据
        const allDaysData = await storage.loadRange({
            start: allDaysList[0],
            end: allDaysList[allDaysList.length - 1],
        });
        heatmapDataPoints = Reporter.toDataPoints(allDaysData);
    }

    switch (view) {
        case 'today': {
            dataPoints = Reporter.toDataPoints([todayStats]);
            // 今日趋势：按小时聚合
            dataPoints = aggregateByHour(todayStats);
            const cfg = vscode.workspace.getConfiguration('workTime');
            const idle = cfg.get<number>('idleTimeout', 300);
            adaptiveNote =
                `当前空闲阈值: ${idle}s (${Math.round(idle / 60)} 分钟)`;
            break;
        }
        case 'week': {
            const range = Storage.getWeekRange();
            const days = await storage.loadRange(range);
            dataPoints = Reporter.toDataPoints(days);
            summary = Storage.summarizeLoaded(days);
            commits = days.flatMap((d) => d.commits ?? []);
            break;
        }
        case 'month': {
            const range = Storage.getMonthRange();
            const days = await storage.loadRange(range);
            // 月趋势：按周聚合
            dataPoints = aggregateByWeek(days);
            summary = Storage.summarizeLoaded(days);
            commits = days.flatMap((d) => d.commits ?? []);
            break;
        }
        case 'all': {
            // 全部视图：指定年度每月汇总
            const yearStart = `${selectedYear}-01-01`;
            const yearEnd = `${selectedYear}-12-31`;
            const days = await storage.loadRange({ start: yearStart, end: yearEnd });
            dataPoints = aggregateByMonth(days);
            summary = Storage.summarizeLoaded(days);
            commits = days.flatMap((d) => d.commits ?? []);
            break;
        }
        case 'sessions': {
            const sDays = await storage.listSessionDays();
            const recent = sDays.slice(-14);
            const sessionArrays = await Promise.all(
                recent.map((d) => storage.loadSessions(d))
            );
            const records: SessionRecord[] = sessionArrays.flat();
            records.sort((a, b) => b.startTime - a.startTime);
            const last30 = (await storage.listDays()).slice(-30);
            const recentDays = await storage.loadRange({
                start: last30[0] ?? '2000-01-01',
                end: last30[last30.length - 1] ?? '2099-12-31',
            });
            summary = Storage.summarizeLoaded(recentDays);
            return {
                view,
                state,
                todayStats,
                summary,
                dataPoints: [],
                heatmapDataPoints,
                commits,
                adaptiveNote,
                theme: getThemeInfo(),
                sessionRecords: records,
                years: availableYears,
                year: selectedYear,
            };
        }
    }

    return {
        view,
        state,
        todayStats,
        summary,
        dataPoints,
        heatmapDataPoints,
        commits,
        adaptiveNote,
        theme: getThemeInfo(),
        years: availableYears,
        year: selectedYear,
    };
}

/** 获取当前 VS Code 主题信息 */
function getThemeInfo() {
    const t = vscode.window.activeColorTheme;
    return {
        kind: t.kind, // 1=Light 2=Dark 3=HighContrast
        isDark: t.kind === 2,
    };
}

// ============ 状态栏 ============

function updateStatusBar(): void {
    const stats = tracker.getTodayStats();
    const state = tracker.getState();

    const icon =
        state === TrackerState.Active
            ? '$(pulse)'
            : state === TrackerState.Idle
              ? '$(history)'
              : '$(circle-slash)';

    const m = Math.floor(stats.totalCodingTime / 60);
    statusBarItem.text = `${icon} ${m}m`;
    statusBarItem.tooltip = [
        `活跃: ${fmtShort(stats.totalActiveTime)}`,
        `编码: ${fmtShort(stats.totalCodingTime)}`,
        `按键: ${stats.totalKeystrokes}`,
        `+/: ${stats.totalLinesAdded}/${stats.totalLinesDeleted}`,
        `提交: ${(stats.commits ?? []).length}`,
    ].join(' | ');
}

function fmtShort(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (h > 0) return `${h}h${m}m`;
    return `${m}m`;
}

// ============ 数据聚合 ============

/** 今日趋势：将单日数据按小时聚合为 24 个数据点。 */
function aggregateByHour(today: DailyStats): DayDataPoint[] {
    // 使用 commits 的时间戳来估算每小时分布
    const hourMap = new Map<number, { codingTime: number; keystrokes: number; linesAdded: number; linesDeleted: number; commits: number }>();
    for (let h = 0; h < 24; h++) {
        hourMap.set(h, { codingTime: 0, keystrokes: 0, linesAdded: 0, linesDeleted: 0, commits: 0 });
    }

    // 按 commits 时间分布编码时间
    const commits = today.commits ?? [];
    const totalCoding = today.totalCodingTime;
    const commitHours = new Map<number, number>();
    for (const c of commits) {
        const h = new Date(c.timestamp).getHours();
        commitHours.set(h, (commitHours.get(h) ?? 0) + 1);
    }

    // 如果有提交记录，按提交分布时间；否则均匀分布
    const totalCommitsInDay = commits.length;
    if (totalCommitsInDay > 0) {
        for (const [h, count] of commitHours) {
            const ratio = count / totalCommitsInDay;
            const entry = hourMap.get(h)!;
            entry.codingTime = Math.round(totalCoding * ratio);
            entry.commits = count;
        }
    } else {
        // 无提交时，假设编码时间集中在 9-18 点
        const activeHours = [9, 10, 11, 13, 14, 15, 16, 17];
        const perHour = Math.round(totalCoding / activeHours.length);
        for (const h of activeHours) {
            hourMap.get(h)!.codingTime = perHour;
        }
    }

    return Array.from(hourMap.entries()).map(([h, v]) => ({
        date: `${String(h).padStart(2, '0')}:00`,
        codingTime: v.codingTime,
        activeTime: v.codingTime,
        keystrokes: v.keystrokes,
        linesAdded: v.linesAdded,
        linesDeleted: v.linesDeleted,
        commits: v.commits,
        problemCount: 0,
    }));
}

/** 将多日数据按月聚合。 */
function aggregateByMonth(days: DailyStats[]): DayDataPoint[] {
    const monthMap = new Map<number, DayDataPoint>();

    for (let m = 1; m <= 12; m++) {
        monthMap.set(m, {
            date: `${m}月`,
            codingTime: 0,
            activeTime: 0,
            keystrokes: 0,
            linesAdded: 0,
            linesDeleted: 0,
            commits: 0,
            problemCount: 0,
        });
    }

    for (const day of days) {
        const d = new Date(day.date);
        const month = d.getMonth() + 1;
        const entry = monthMap.get(month)!;
        entry.codingTime += day.totalCodingTime;
        entry.activeTime += day.totalActiveTime;
        entry.keystrokes += day.totalKeystrokes;
        entry.linesAdded += day.totalLinesAdded;
        entry.linesDeleted += day.totalLinesDeleted;
        entry.commits += (day.commits ?? []).length;
        entry.problemCount += day.problemCount ?? 0;
    }

    // 只返回有数据的月份（当前月之前）+ 当前月
    const currentMonth = new Date().getMonth() + 1;
    return Array.from(monthMap.entries())
        .filter(([m]) => m <= currentMonth)
        .map(([, v]) => v);
}

/** 将多日数据按周聚合。 */
function aggregateByWeek(days: DailyStats[]): DayDataPoint[] {
    const weekMap = new Map<string, DayDataPoint>();

    for (const day of days) {
        const d = new Date(day.date);
        // 获取该周的周一作为 key
        const dayOfWeek = d.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(d);
        monday.setDate(d.getDate() + mondayOffset);
        const weekKey = monday.toISOString().slice(0, 10);

        if (!weekMap.has(weekKey)) {
            const month = monday.getMonth() + 1;
            const weekOfMonth = Math.ceil(monday.getDate() / 7);
            weekMap.set(weekKey, {
                date: `${month}月W${weekOfMonth}`,
                codingTime: 0,
                activeTime: 0,
                keystrokes: 0,
                linesAdded: 0,
                linesDeleted: 0,
                commits: 0,
                problemCount: 0,
            });
        }
        const w = weekMap.get(weekKey)!;
        w.codingTime += day.totalCodingTime;
        w.activeTime += day.totalActiveTime;
        w.keystrokes += day.totalKeystrokes;
        w.linesAdded += day.totalLinesAdded;
        w.linesDeleted += day.totalLinesDeleted;
        w.commits += (day.commits ?? []).length;
        w.problemCount += day.problemCount ?? 0;
    }

    return Array.from(weekMap.values());
}
