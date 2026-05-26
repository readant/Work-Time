import * as vscode from 'vscode';
import { DailyStats, DateRange, GlobalStats } from './types';

/**
 * 数据持久化模块。
 * 每日数据存储为 `<globalStorageUri>/stats/YYYY-MM-DD.json`。
 */
export class Storage {
    private basePath: vscode.Uri | null = null;

    /**
     * 初始化存储路径。需在 activate 中调用一次。
     */
    init(context: vscode.ExtensionContext): void {
        const customDir = vscode.workspace
            .getConfiguration('codingTracker')
            .get<string>('dataDir', '');
        if (customDir) {
            this.basePath = vscode.Uri.file(customDir);
        } else {
            this.basePath = vscode.Uri.joinPath(
                context.globalStorageUri,
                'stats'
            );
        }
    }

    /**
     * 读取指定日期的统计，不存在时返回空对象。
     */
    async loadDay(date: string): Promise<DailyStats> {
        const uri = this.dayUri(date);
        try {
            const raw = await vscode.workspace.fs.readFile(uri);
            return JSON.parse(Buffer.from(raw).toString('utf-8')) as DailyStats;
        } catch {
            return this.emptyDay(date);
        }
    }

    /**
     * 保存（覆盖写入）指定日期的统计。
     */
    async saveDay(stats: DailyStats): Promise<void> {
        const uri = this.dayUri(stats.date);
        const dir = vscode.Uri.joinPath(uri, '..');
        await vscode.workspace.fs.createDirectory(dir);
        const data = Buffer.from(JSON.stringify(stats, null, 2), 'utf-8');
        await vscode.workspace.fs.writeFile(uri, data);
    }

    /**
     * 列出所有已记录的日期。
     */
    async listDays(): Promise<string[]> {
        if (!this.basePath) return [];
        try {
            const entries = await vscode.workspace.fs.readDirectory(
                this.basePath
            );
            return entries
                .filter(([name]) => name.endsWith('.json'))
                .map(([name]) => name.replace('.json', ''))
                .sort();
        } catch {
            return [];
        }
    }

    /**
     * 读取指定日期范围的统计列表。
     */
    async loadRange(range: DateRange): Promise<DailyStats[]> {
        const days = await this.listDays();
        const filtered = days.filter(
            (d) => d >= range.start && d <= range.end
        );
        const results: DailyStats[] = [];
        for (const d of filtered) {
            results.push(await this.loadDay(d));
        }
        return results;
    }

    /**
     * 汇总指定日期范围的全局统计。
     */
    async summarize(days: string[]): Promise<GlobalStats> {
        const projectMap = new Map<
            string,
            { time: number; lines: number }
        >();
        const fileMap = new Map<string, { time: number; lines: number }>();

        let totalActiveTime = 0;
        let totalCodingTime = 0;
        let totalKeystrokes = 0;
        let totalLinesAdded = 0;
        let totalLinesDeleted = 0;
        let totalCommits = 0;

        for (const date of days) {
            const day = await this.loadDay(date);
            if (!day.totalActiveTime && !day.totalCodingTime) continue;

            totalActiveTime += day.totalActiveTime;
            totalCodingTime += day.totalCodingTime;
            totalKeystrokes += day.totalKeystrokes;
            totalLinesAdded += day.totalLinesAdded;
            totalLinesDeleted += day.totalLinesDeleted;
            totalCommits += (day.commits ?? []).length;

            for (const [proj, p] of Object.entries(day.projects)) {
                const cur = projectMap.get(proj) ?? { time: 0, lines: 0 };
                cur.time += p.codingTime;
                cur.lines += p.linesAdded + p.linesDeleted;
                projectMap.set(proj, cur);

                for (const [file, f] of Object.entries(p.files)) {
                    const fc = fileMap.get(file) ?? { time: 0, lines: 0 };
                    fc.time += f.codingTime;
                    fc.lines += f.linesAdded + f.linesDeleted;
                    fileMap.set(file, fc);
                }
            }
        }

        const topProjects = [...projectMap.entries()]
            .map(([name, v]) => ({ name, time: v.time }))
            .sort((a, b) => b.time - a.time)
            .slice(0, 10);

        const topFiles = [...fileMap.entries()]
            .map(([path, v]) => ({ path, time: v.time }))
            .sort((a, b) => b.time - a.time)
            .slice(0, 10);

        return {
            totalDays: days.length,
            totalActiveTime,
            totalCodingTime,
            totalKeystrokes,
            totalLinesAdded,
            totalLinesDeleted,
            totalCommits,
            topProjects,
            topFiles,
        };
    }

    // ---- 工具：日期范围 ----

    /**
     * 获取本周（周一~周日）的日期范围。
     */
    static getWeekRange(): DateRange {
        const now = new Date();
        // 周一为一周第一天
        const dayOfWeek = now.getDay();
        const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setDate(now.getDate() + mondayOffset);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        return {
            start: fmtDate(monday),
            end: fmtDate(sunday),
        };
    }

    /**
     * 获取本月的日期范围。
     */
    static getMonthRange(): DateRange {
        const now = new Date();
        const first = new Date(now.getFullYear(), now.getMonth(), 1);
        const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        return {
            start: fmtDate(first),
            end: fmtDate(last),
        };
    }

    // ---- 内部工具 ----

    private dayUri(date: string): vscode.Uri {
        return vscode.Uri.joinPath(this.basePath!, `${date}.json`);
    }

    private emptyDay(date: string): DailyStats {
        return {
            date,
            totalActiveTime: 0,
            totalCodingTime: 0,
            totalKeystrokes: 0,
            totalLinesAdded: 0,
            totalLinesDeleted: 0,
            commits: [],
            projects: {},
        };
    }
}

/** 格式化 Date 为 YYYY-MM-DD。 */
function fmtDate(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}
