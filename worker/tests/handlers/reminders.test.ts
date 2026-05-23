import { describe, it, expect } from 'vitest';
import { filterUnpredicted } from '../../src/handlers/web/reminders';
import type { ReminderMatch } from '../../src/types';

function match(id: string, hoursFromNow: number): ReminderMatch {
  const kickoff_at = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  return { id, home_team: 'A', away_team: 'B', kickoff_at };
}

describe('filterUnpredicted', () => {
  const now = new Date();

  it('includes unpredicted match within 24h', () => {
    const matches = [match('m1', 10)];
    const result = filterUnpredicted(matches, new Set(), now);
    expect(result.map(m => m.id)).toEqual(['m1']);
  });

  it('excludes already-predicted match', () => {
    const matches = [match('m1', 10)];
    const result = filterUnpredicted(matches, new Set(['m1']), now);
    expect(result).toHaveLength(0);
  });

  it('excludes match kicking off in more than 24h', () => {
    const matches = [match('m1', 25)];
    const result = filterUnpredicted(matches, new Set(), now);
    expect(result).toHaveLength(0);
  });

  it('excludes match already started (kickoff in the past)', () => {
    const past = new Date(Date.now() - 1000).toISOString();
    const matches = [{ id: 'm1', home_team: 'A', away_team: 'B', kickoff_at: past }];
    const result = filterUnpredicted(matches, new Set(), now);
    expect(result).toHaveLength(0);
  });

  it('returns multiple matches sorted as-is', () => {
    const matches = [match('m1', 2), match('m2', 12), match('m3', 23)];
    const predicted = new Set(['m2']);
    const result = filterUnpredicted(matches, predicted, now);
    expect(result.map(m => m.id)).toEqual(['m1', 'm3']);
  });

  it('returns empty array when no matches', () => {
    expect(filterUnpredicted([], new Set(), now)).toEqual([]);
  });
});
