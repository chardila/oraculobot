import { describe, it, expect } from 'vitest';
import { calculatePoints, calculatePointsBreakdown } from '../src/services/scoring';

describe('calculatePoints — grupos (sistema original)', () => {
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

describe('calculatePoints — knockout (nuevo sistema)', () => {
  // treintaidosavos: ×2, max 10 pts
  it('R32: exact score → 10 pts', () => {
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, 'treintaidosavos')).toBe(10);
  });

  it('R32: correct result + correct diff, no individual goals → 6 pts', () => {
    // pred: 2-0, result: 3-1 — result ✓ (home win), diff ✓ (2=2), home ✗ (2≠3), away ✗ (0≠1)
    // (2+1+0+0) × 2 = 6
    expect(calculatePoints({ home: 2, away: 0 }, { home: 3, away: 1 }, 'treintaidosavos')).toBe(6);
  });

  it('R32: correct result + away goals correct → 6 pts', () => {
    // pred: 2-0, result: 1-0 — result ✓, diff ✗ (2≠1), home ✗ (2≠1), away ✓ (0=0)
    // (2+0+0+1) × 2 = 6
    expect(calculatePoints({ home: 2, away: 0 }, { home: 1, away: 0 }, 'treintaidosavos')).toBe(6);
  });

  it('R32: wrong result, home goals correct → 2 pts', () => {
    // pred: 2-1 (home wins), result: 2-3 (away wins)
    // result wrong (0), diff wrong, home correct (2=2), away wrong (1≠3)
    // home(1) × 2 = 2
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 3 }, 'treintaidosavos')).toBe(2);
  });

  it('R32: wrong result, away goals correct → 2 pts', () => {
    // pred: 0-1 (away wins), result: 2-1 (home wins)
    // result wrong, home wrong, away correct (1=1)
    expect(calculatePoints({ home: 0, away: 1 }, { home: 2, away: 1 }, 'treintaidosavos')).toBe(2);
  });

  it('R32: wrong result, no goals correct → 0 pts', () => {
    expect(calculatePoints({ home: 2, away: 0 }, { home: 0, away: 1 }, 'treintaidosavos')).toBe(0);
  });

  it('R32: diff NOT awarded when result is wrong', () => {
    // pred: 2-1 (home, diff 1), result: 1-2 (away, diff 1) — result wrong despite same diff
    // in old system this would give 1 pt; in new knockout system: 0 for result, 0 for diff, 0 home, away wrong
    // away: pred 1, actual 2 → wrong. home: pred 2, actual 1 → wrong. → 0 pts
    expect(calculatePoints({ home: 2, away: 1 }, { home: 1, away: 2 }, 'treintaidosavos')).toBe(0);
  });

  // octavos: ×4, max 20 pts
  it('R16: exact score → 20 pts', () => {
    expect(calculatePoints({ home: 1, away: 0 }, { home: 1, away: 0 }, 'octavos')).toBe(20);
  });

  it('R16: correct result + away correct → 12 pts', () => {
    // pred: 2-0, result: 3-0 — result ✓, diff ✗ (2≠3), home ✗ (2≠3), away ✓ (0=0)
    // (2+0+0+1) × 4 = 12
    expect(calculatePoints({ home: 2, away: 0 }, { home: 3, away: 0 }, 'octavos')).toBe(12);
  });

  it('R16: correct result only, no goals correct → 8 pts', () => {
    // pred: 2-0, result: 3-1 — result ✓, diff ✗ (2≠2)... wait, 2=2 so diff is correct
    // Use pred: 3-1, result: 2-0 — result ✓, diff: 2≠2... 3-1=2, 2-0=2 → same!
    // Use pred: 3-0, result: 2-1 — result ✓ (home win both), diff: 3≠1, home: 3≠2, away: 0≠1
    // (2+0+0+0) × 4 = 8
    expect(calculatePoints({ home: 3, away: 0 }, { home: 2, away: 1 }, 'octavos')).toBe(8);
  });

  // cuartos: ×6, max 30 pts
  it('QF: exact score → 30 pts', () => {
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, 'cuartos')).toBe(30);
  });

  // semis: ×8, max 40 pts
  it('SF: exact score → 40 pts', () => {
    expect(calculatePoints({ home: 0, away: 0 }, { home: 0, away: 0 }, 'semis')).toBe(40);
  });

  // tercer_lugar: ×4, max 20 pts
  it('3rd place: exact score → 20 pts', () => {
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, 'tercer_lugar')).toBe(20);
  });

  // final: ×10, max 50 pts
  it('Final: exact score → 50 pts', () => {
    expect(calculatePoints({ home: 1, away: 0 }, { home: 1, away: 0 }, 'final')).toBe(50);
  });

  it('Final: correct result + correct diff (no exact) → 30 pts', () => {
    // pred: 2-1, result: 3-2 → result correct, diff correct (1=1), home wrong, away wrong
    // (2+1) × 10 = 30
    expect(calculatePoints({ home: 2, away: 1 }, { home: 3, away: 2 }, 'final')).toBe(30);
  });

  it('Final: correct result + home correct → 30 pts', () => {
    // pred: 2-1, result: 2-0 → result correct, diff wrong (1≠2), home correct (2=2), away wrong
    // (2+0+1+0) × 10 = 30
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 0 }, 'final')).toBe(30);
  });

  it('grupos phase uses original system (not knockout)', () => {
    // With grupos, exact score = 5 pts, not 5 × multiplier
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 1 }, 'grupos')).toBe(5);
  });

  it('no phase uses original system', () => {
    expect(calculatePoints({ home: 2, away: 1 }, { home: 2, away: 1 })).toBe(5);
  });
});

describe('calculatePointsBreakdown — knockout', () => {
  it('R32: exact score breakdown', () => {
    const bd = calculatePointsBreakdown({ home: 2, away: 1 }, { home: 2, away: 1 }, 'treintaidosavos');
    expect(bd).toEqual({ result: 4, diff: 2, home: 2, away: 2, total: 10, multiplier: 2 });
  });

  it('R32: correct result + away goals correct', () => {
    // pred: 2-1, result: 3-1 → result ✓, diff: 1=2 ✗, home ✗, away ✓
    const bd = calculatePointsBreakdown({ home: 2, away: 1 }, { home: 3, away: 1 }, 'treintaidosavos');
    expect(bd).toEqual({ result: 4, diff: 0, home: 0, away: 2, total: 6, multiplier: 2 });
  });

  it('Final: correct result only', () => {
    // pred: 1-0, result: 2-0 → result ✓, diff ✗ (1≠2), home ✗, away ✓ (0=0)
    const bd = calculatePointsBreakdown({ home: 1, away: 0 }, { home: 2, away: 0 }, 'final');
    expect(bd).toEqual({ result: 20, diff: 0, home: 0, away: 10, total: 30, multiplier: 10 });
  });

  it('grupos: breakdown total matches calculatePoints', () => {
    const bd = calculatePointsBreakdown({ home: 2, away: 1 }, { home: 2, away: 1 }, 'grupos');
    expect(bd.total).toBe(5);
    expect(bd.multiplier).toBe(1);
  });
});
