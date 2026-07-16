import { describe, it, expect, beforeEach } from 'vitest';
import { AdaptiveThreshold } from '../adaptive';

describe('AdaptiveThreshold', () => {
    let threshold: AdaptiveThreshold;

    beforeEach(() => {
        threshold = new AdaptiveThreshold();
    });

    describe('recordInterval', () => {
        it('should record valid intervals (1s ~ 1h)', () => {
            threshold.recordInterval(5000);  // 5s
            threshold.recordInterval(30000); // 30s
            threshold.recordInterval(60000); // 1min
            expect(threshold.getIntervals()).toHaveLength(3);
        });

        it('should reject intervals < 1s', () => {
            threshold.recordInterval(500);
            threshold.recordInterval(999);
            expect(threshold.getIntervals()).toHaveLength(0);
        });

        it('should reject intervals > 1h', () => {
            threshold.recordInterval(3600001);
            expect(threshold.getIntervals()).toHaveLength(0);
        });

        it('should accept boundary values', () => {
            threshold.recordInterval(1000);    // exactly 1s
            threshold.recordInterval(3600000); // exactly 1h
            expect(threshold.getIntervals()).toHaveLength(2);
        });
    });

    describe('window size', () => {
        it('should cap at WINDOW_SIZE (200) entries', () => {
            for (let i = 0; i < 250; i++) {
                threshold.recordInterval(5000);
            }
            expect(threshold.getIntervals()).toHaveLength(200);
        });

        it('should keep most recent entries when overflowing', () => {
            // Fill to window size (200), then add 3 more
            for (let i = 0; i < 200; i++) {
                threshold.recordInterval(1000);
            }
            threshold.recordInterval(5000);
            threshold.recordInterval(6000);
            threshold.recordInterval(7000);
            const intervals = threshold.getIntervals();
            expect(intervals).toHaveLength(200);
            // The last 3 entries should be the most recent ones
            expect(intervals[197]).toBe(5000);
            expect(intervals[198]).toBe(6000);
            expect(intervals[199]).toBe(7000);
        });
    });

    describe('reset', () => {
        it('should clear all intervals', () => {
            threshold.recordInterval(5000);
            threshold.recordInterval(10000);
            threshold.reset();
            expect(threshold.getIntervals()).toHaveLength(0);
        });
    });

    describe('getIntervals', () => {
        it('should return a copy, not the internal array', () => {
            threshold.recordInterval(5000);
            const intervals = threshold.getIntervals();
            intervals.push(99999);
            expect(threshold.getIntervals()).toHaveLength(1);
        });
    });
});
