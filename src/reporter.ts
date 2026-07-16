import { DailyStats, DayDataPoint, ExportFormat, GlobalStats } from './types';

/**
 * 多格式报告导出模块。
 */
export class Reporter {
    /**
     * 将日统计列表转换为时序数据点。
     */
    static toDataPoints(days: DailyStats[]): DayDataPoint[] {
        return days.map((d) => ({
            date: d.date,
            codingTime: d.totalCodingTime,
            activeTime: d.totalActiveTime,
            keystrokes: d.totalKeystrokes,
            linesAdded: d.totalLinesAdded,
            linesDeleted: d.totalLinesDeleted,
            commits: d.commits.length,
            problemCount: d.problemCount ?? 0,
        }));
    }

    /**
     * 生成报告文本。
     */
    static generate(
        days: DailyStats[],
        summary: GlobalStats,
        format: ExportFormat
    ): string {
        switch (format) {
            case 'json':
                return this.jsonReport(days, summary);
            case 'csv':
                return this.csvReport(days);
            case 'md':
                return this.mdReport(days, summary);
            default:
                return this.txtReport(days, summary);
        }
    }

    // ---- 各格式实现 ----

    private static jsonReport(
        days: DailyStats[],
        summary: GlobalStats
    ): string {
        const exportData = {
            exportedAt: new Date().toISOString(),
            summary,
            daily: days,
        };
        return JSON.stringify(exportData, null, 2);
    }

    private static csvReport(days: DailyStats[]): string {
        const points = this.toDataPoints(days);
        const header =
            '日期,编码时间(s),活跃时间(s),按键,新增行,删除行,提交数';
        const rows = points.map(
            (p) =>
                `${p.date},${p.codingTime},${p.activeTime},${p.keystrokes},${p.linesAdded},${p.linesDeleted},${p.commits}`
        );
        return [header, ...rows].join('\n');
    }

    private static mdReport(
        days: DailyStats[],
        summary: GlobalStats
    ): string {
        const timeFmt = (s: number) => {
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };

        const lines: string[] = [];
        lines.push('# Work Time 统计报告');
        lines.push('');
        lines.push(`> 导出时间：${new Date().toLocaleString('zh-CN')}`);
        lines.push('');
        lines.push('## 总览');
        lines.push('');
        lines.push('| 指标 | 数值 |');
        lines.push('| --- | --- |');
        lines.push(`| 统计天数 | ${summary.totalDays} |`);
        lines.push(`| 总活跃时间 | ${timeFmt(summary.totalActiveTime)} |`);
        lines.push(`| 总编码时间 | ${timeFmt(summary.totalCodingTime)} |`);
        lines.push(
            `| 总按键次数 | ${summary.totalKeystrokes.toLocaleString()} |`
        );
        lines.push(`| 总新增行数 | +${summary.totalLinesAdded} |`);
        lines.push(`| 总删除行数 | -${summary.totalLinesDeleted} |`);
        lines.push(`| Git 提交数 | ${summary.totalCommits} |`);
        lines.push('');

        if (summary.topProjects.length > 0) {
            lines.push('## Top 项目（按编码时间）');
            lines.push('');
            lines.push('| 项目 | 编码时间 |');
            lines.push('| --- | --- |');
            for (const p of summary.topProjects) {
                lines.push(`| ${p.name} | ${timeFmt(p.time)} |`);
            }
            lines.push('');
        }

        if (summary.topFiles.length > 0) {
            lines.push('## Top 文件（按编码时间）');
            lines.push('');
            lines.push('| 文件 | 编码时间 |');
            lines.push('| --- | --- |');
            for (const f of summary.topFiles) {
                lines.push(`| \`${f.path}\` | ${timeFmt(f.time)} |`);
            }
            lines.push('');
        }

        lines.push('## 每日明细');
        lines.push('');
        lines.push('| 日期 | 编码时间 | 活跃时间 | 按键 | +行 | -行 | 提交 |');
        lines.push('| --- | --- | --- | --- | --- | --- | --- |');
        for (const d of days) {
            lines.push(
                `| ${d.date} | ${timeFmt(d.totalCodingTime)} | ${timeFmt(d.totalActiveTime)} | ${d.totalKeystrokes} | ${d.totalLinesAdded} | ${d.totalLinesDeleted} | ${d.commits.length} |`
            );
        }

        return lines.join('\n');
    }

    private static txtReport(
        days: DailyStats[],
        summary: GlobalStats
    ): string {
        const timeFmt = (s: number) => {
            const h = Math.floor(s / 3600);
            const m = Math.floor((s % 3600) / 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
        };

        const lines: string[] = [];
        lines.push('========== Work Time 统计报告 ==========');
        lines.push(`导出时间: ${new Date().toLocaleString('zh-CN')}`);
        lines.push(`统计天数: ${summary.totalDays}`);
        lines.push(`总活跃时间: ${timeFmt(summary.totalActiveTime)}`);
        lines.push(`总编码时间: ${timeFmt(summary.totalCodingTime)}`);
        lines.push(
            `总按键次数: ${summary.totalKeystrokes.toLocaleString()}`
        );
        lines.push(`总新增行数: +${summary.totalLinesAdded}`);
        lines.push(`总删除行数: -${summary.totalLinesDeleted}`);
        lines.push(`Git 提交数: ${summary.totalCommits}`);
        lines.push('');

        if (summary.topProjects.length > 0) {
            lines.push('--- Top 项目（按编码时间） ---');
            for (const p of summary.topProjects) {
                lines.push(`  ${p.name}: ${timeFmt(p.time)}`);
            }
            lines.push('');
        }

        if (summary.topFiles.length > 0) {
            lines.push('--- Top 文件（按编码时间） ---');
            for (const f of summary.topFiles) {
                lines.push(`  ${f.path}: ${timeFmt(f.time)}`);
            }
            lines.push('');
        }

        lines.push('--- 每日明细 ---');
        for (const d of days) {
            lines.push(
                `${d.date}: 编码${timeFmt(d.totalCodingTime)} 活跃${timeFmt(d.totalActiveTime)} 按键${d.totalKeystrokes} +${d.totalLinesAdded}/-${d.totalLinesDeleted} 提交${d.commits.length}`
            );
        }

        return lines.join('\n');
    }
}
