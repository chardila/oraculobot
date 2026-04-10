import { describe, it, expect } from 'vitest';
import { calculatePoints } from '../src/services/scoring';

describe('calculatePoints', () => {
  it('returns 5 for exact score', () => {
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe(5);
  });

  it('returns 5 for exact score 0-0', () => {
    expect(calculatePoints({ home: 0, away: 0 }, { home: 0, away: 0 })).toBe(5);
  });

  it('returns 4 for correct result + correct diff (not exact)', () => {
    // pred: 2-0, result: 3-1 → both home wins, diff=2 in both
    expect(calculatePoints({ home: 2, away: 0 }, { home: 3, away: 1 })).toBe(4);
  });

  it('returns 3 for correct result only', () => {
    // pred: 2-0, result: 1-0 → both home wins, diff differs
    expect(calculatePoints({ home: 2, away: 0 }, { home: 1, away: 0 })).toBe(3);
  });

  it('returns 1 for correct diff wrong result', () => {
    // pred: 2-1 (home win), result: 1-2 (away win), diff=1 in both
    expect(calculatePoints({ home: 2, away: 1 }, { home: 1, away: 2 })).toBe(1);
  });

  it('returns 4 for correct away win + correct diff', () => {
    // pred: 1-2, result: 0-1 — both away wins, diff 1 in both
    expect(calculatePoints({ home: 1, away: 2 }, { home: 0, away: 1 })).toBe(4);
  });

  it('returns 0 for nothing correct', () => {
    // pred: 2-0 (home win, diff=2), result: 0-1 (away win, diff=1) — both wrong
    expect(calculatePoints({ home: 2, away: 0 }, { home: 0, away: 1 })).toBe(0);
  });

  it('does not add +1 to exact score', () => {
    expect(calculatePoints({ home: 1, away: 1 }, { home: 1, away: 1 })).toBe(5);
  });

  it('returns 4 for correct draw with same diff (0)', () => {
    // pred: 1-1, result: 2-2 → both draws, diff=0 in both → 3+1=4
    expect(calculatePoints({ home: 1, away: 1 }, { home: 2, away: 2 })).toBe(4);
  });
});
