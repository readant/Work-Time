import { describe, it, expect } from 'vitest';
import { Reporter } from '../reporter';
import { DailyStats, GlobalStats } from '../types';

function makeDay(overrides: Partial<DailyStats> = {}): DailyStats {
    return {
        date: '2026-01-01',
        totalActiveTime: 100,
        totalCodingTime: 80,
        totalKeystrokes: 500,
        totalLinesAdded: 20,
        totalLinesDeleted: 5,
        commits: [],
        projects: {},
        languages: {},
        problemCount: 0,
        ...overrides,
    };
}

function makeSummary(overrides: Partial<GlobalStats> = {}): GlobalStats {
    return {
        totalDays: 1,
        totalActiveTime: 100,
        totalCodingTime: 80,
        totalKeystrokes: 500,
        totalLinesAdded: 20,
        totalLinesDeleted: 5,
        totalCommits: 2,
        topProjects: [],
        topFiles: [],
        topLanguages: [],
        ...overrides,
    };
}

describe('Reporter', () => {
    describe('toDataPoints', () => {
        it('should convert DailyStats to DayDataPoint[]', () => {
            const days = [
                makeDay({ date: '2026-01-01', totalCodingTime: 100, commits: [{ timestamp: 1, message: 'a', hash: 'a', project: 'p' }] }),
                makeDay({ date: '2026-01-02', totalCodingTime: 200 }),
            ];
            const points = Reporter.toDataPoints(days);
            expect(points).toHaveLength(2);
            expect(points[0].date).toBe('2026-01-01');
            expect(points[0].codingTime).toBe(100);
            expect(points[0].commits).toBe(1);
            expect(points[1].codingTime).toBe(200);
            expect(points[1].commits).toBe(0);
        });
    });

    describe('generate - JSON', () => {
        it('should produce valid JSON with summary and daily', () => {
            const days = [makeDay()];
            const summary = makeSummary();
            const output = Reporter.generate(days, summary, 'json');
            const parsed = JSON.parse(output);
            expect(parsed.exportedAt).toBeDefined();
            expect(parsed.summary.totalDays).toBe(1);
            expect(parsed.daily).toHaveLength(1);
        });
    });

    describe('generate - CSV', () => {
        it('should produce CSV with header and data rows', () => {
            const days = [makeDay(), makeDay({ date: '2026-01-02' })];
            const summary = makeSummary();
            const output = Reporter.generate(days, summary, 'csv');
            const lines = output.split('\n');
            expect(lines[0]).toContain('日期');
            expect(lines[0]).toContain('编码时间');
            expect(lines).toHaveLength(3); // header + 2 rows
        });
    });

    describe('generate - Markdown', () => {
        it('should produce markdown with tables', () => {
            const days = [makeDay()];
            const summary = makeSummary();
            const output = Reporter.generate(days, summary, 'md');
            expect(output).toContain('# Work Time 统计报告');
            expect(output).toContain('| 指标 | 数值 |');
            expect(output).toContain('| 统计天数 | 1 |');
        });

        it('should include project table when projects exist', () => {
            const summary = makeSummary({
                topProjects: [{ name: 'my-proj', time: 3600 }],
            });
            const output = Reporter.generate([], summary, 'md');
            expect(output).toContain('Top 项目');
            expect(output).toContain('my-proj');
        });
    });

    describe('generate - TXT', () => {
        it('should produce plain text report', () => {
            const days = [makeDay()];
            const summary = makeSummary();
            const output = Reporter.generate(days, summary, 'txt');
            expect(output).toContain('Work Time 统计报告');
            expect(output).toContain('统计天数: 1');
        });
    });
});
