import { describe, it, expect } from 'vitest';
import { Storage } from '../storage';
import { DailyStats } from '../types';

function makeDay(overrides: Partial<DailyStats> = {}): DailyStats {
    return {
        date: '2026-01-01',
        totalActiveTime: 100,
        totalCodingTime: 80,
        totalKeystrokes: 500,
        totalLinesAdded: 20,
        totalLinesDeleted: 5,
        commits: [
            { timestamp: 1000, message: 'feat: test', hash: 'abc123', project: 'proj' },
        ],
        projects: {
            proj: {
                activeTime: 100,
                codingTime: 80,
                keystrokes: 500,
                linesAdded: 20,
                linesDeleted: 5,
                files: {
                    'src/main.ts': { codingTime: 80, keystrokes: 500, linesAdded: 20, linesDeleted: 5 },
                },
            },
        },
        languages: {
            typescript: { codingTime: 80, keystrokes: 500, linesAdded: 20, linesDeleted: 5 },
        },
        problemCount: 3,
        ...overrides,
    };
}

describe('Storage.summarizeLoaded', () => {
    it('should return empty stats for empty input', () => {
        const result = Storage.summarizeLoaded([]);
        expect(result.totalDays).toBe(0);
        expect(result.totalActiveTime).toBe(0);
        expect(result.totalCodingTime).toBe(0);
        expect(result.totalKeystrokes).toBe(0);
        expect(result.totalCommits).toBe(0);
        expect(result.topProjects).toHaveLength(0);
        expect(result.topLanguages).toHaveLength(0);
    });

    it('should sum stats across multiple days', () => {
        const days = [
            makeDay({ date: '2026-01-01', totalCodingTime: 100, totalKeystrokes: 500 }),
            makeDay({ date: '2026-01-02', totalCodingTime: 200, totalKeystrokes: 300 }),
        ];
        const result = Storage.summarizeLoaded(days);
        expect(result.totalDays).toBe(2);
        expect(result.totalCodingTime).toBe(300);
        expect(result.totalKeystrokes).toBe(800);
    });

    it('should count commits correctly', () => {
        const days = [
            makeDay({
                commits: [
                    { timestamp: 1, message: 'a', hash: 'a', project: 'p' },
                    { timestamp: 2, message: 'b', hash: 'b', project: 'p' },
                ],
            }),
            makeDay({
                commits: [
                    { timestamp: 3, message: 'c', hash: 'c', project: 'p' },
                ],
            }),
        ];
        const result = Storage.summarizeLoaded(days);
        expect(result.totalCommits).toBe(3);
    });

    it('should aggregate projects and sort by time', () => {
        const days = [
            makeDay({
                projects: {
                    alpha: { activeTime: 100, codingTime: 50, keystrokes: 0, linesAdded: 0, linesDeleted: 0, files: {} },
                    beta: { activeTime: 100, codingTime: 200, keystrokes: 0, linesAdded: 0, linesDeleted: 0, files: {} },
                },
            }),
        ];
        const result = Storage.summarizeLoaded(days);
        expect(result.topProjects).toHaveLength(2);
        expect(result.topProjects[0].name).toBe('beta');
        expect(result.topProjects[0].time).toBe(200);
        expect(result.topProjects[1].name).toBe('alpha');
        expect(result.topProjects[1].time).toBe(50);
    });

    it('should aggregate languages and sort by time', () => {
        const days = [
            makeDay({
                languages: {
                    python: { codingTime: 300, keystrokes: 0, linesAdded: 0, linesDeleted: 0 },
                    typescript: { codingTime: 100, keystrokes: 0, linesAdded: 0, linesDeleted: 0 },
                },
            }),
        ];
        const result = Storage.summarizeLoaded(days);
        expect(result.topLanguages).toHaveLength(2);
        expect(result.topLanguages[0].name).toBe('python');
        expect(result.topLanguages[0].time).toBe(300);
    });

    it('should skip days with zero active and coding time', () => {
        const days = [
            makeDay({ totalActiveTime: 0, totalCodingTime: 0 }),
            makeDay({ date: '2026-01-02', totalActiveTime: 100, totalCodingTime: 80 }),
        ];
        const result = Storage.summarizeLoaded(days);
        expect(result.totalDays).toBe(2); // still counts days
        expect(result.totalCodingTime).toBe(80);
    });

    it('should handle missing commits/languages gracefully', () => {
        const day: DailyStats = {
            date: '2026-01-01',
            totalActiveTime: 50,
            totalCodingTime: 50,
            totalKeystrokes: 100,
            totalLinesAdded: 5,
            totalLinesDeleted: 2,
            commits: [],
            projects: {},
            languages: {},
            problemCount: 0,
        };
        const result = Storage.summarizeLoaded([day]);
        expect(result.totalCommits).toBe(0);
        expect(result.topLanguages).toHaveLength(0);
    });
});
