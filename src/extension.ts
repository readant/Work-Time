import * as vscode from 'vscode';
import { Storage } from './storage';
import { CodingTracker } from './tracker';
import { StatsWebview } from './webview';
import { Reporter } from './reporter';
import { SmartPomodoro } from './tools/pomodoro';
import { SessionTimer } from './tools/session-timer';
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

    // 状态栏
    statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'work-time.showStats';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    const statusBarTimer = setInterval(() => updateStatusBar(), 10_000);
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

        // 番茄钟和会话计时器的状态栏项
        pomodoro.statusBarItem,
        sessionTimer.statusBarItem
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
    webview.dispose();
    console.log('[work-time] 扩展已停用');
}

// ============ 命令处理 ============

async function handleShowStats(
    extensionUri: vscode.Uri,
    view: ViewType
): Promise<void> {
    const data = await prepareWebviewData(view);
    webview.show(extensionUri, view, data);
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
    const summary = await storage.summarize(days);
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

async function prepareWebviewData(view: ViewType) {
    const todayStats = tracker.getTodayStats();
    const state = tracker.getState();

    let dataPoints: DayDataPoint[] = [];
    let summary = null;
    let commits = todayStats.commits ?? [];
    let adaptiveNote = '';

    switch (view) {
        case 'today': {
            dataPoints = Reporter.toDataPoints([todayStats]);
            // 自适应提示
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
            summary = await storage.summarize(
                days.map((d) => d.date)
            );
            commits = days.flatMap((d) => d.commits ?? []);
            break;
        }
        case 'month': {
            const range = Storage.getMonthRange();
            const days = await storage.loadRange(range);
            dataPoints = Reporter.toDataPoints(days);
            summary = await storage.summarize(
                days.map((d) => d.date)
            );
            commits = days.flatMap((d) => d.commits ?? []);
            break;
        }
        case 'all': {
            const allDays = await storage.listDays();
            const days = await storage.loadRange({
                start: allDays[0] ?? '2000-01-01',
                end: allDays[allDays.length - 1] ?? '2099-12-31',
            });
            dataPoints = Reporter.toDataPoints(days);
            summary = await storage.summarize(
                days.map((d) => d.date)
            );
            commits = days.flatMap((d) => d.commits ?? []);
            break;
        }
        case 'sessions': {
            // 加载最近 14 天的会话记录
            const sDays = await storage.listSessionDays();
            const recent = sDays.slice(-14);
            const records: SessionRecord[] = [];
            for (const d of recent) {
                records.push(...(await storage.loadSessions(d)));
            }
            records.sort((a, b) => b.startTime - a.startTime);
            summary = await storage.summarize(
                (await storage.listDays()).slice(-30)
            );
            return {
                view,
                state,
                todayStats,
                summary,
                dataPoints,
                commits,
                adaptiveNote,
                theme: getThemeInfo(),
                sessionRecords: records,
            };
        }
    }

    return {
        view,
        state,
        todayStats,
        summary,
        dataPoints,
        commits,
        adaptiveNote,
        theme: getThemeInfo(),
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
