import { describe, it, expect } from 'vitest';
import { getBracketEntries, resolveTeam } from '../../src/services/bracket';

describe('getBracketEntries', () => {
  it('returns empty array for group stage match (no match_num)', () => {
    expect(getBracketEntries(null)).toEqual([]);
  });

  it('returns empty array for match 103 and 104 (receive only)', () => {
    expect(getBracketEntries(103)).toEqual([]);
    expect(getBracketEntries(104)).toEqual([]);
  });

  it('match 73 winner goes to match 90 as home', () => {
    const entries = getBracketEntries(73);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ nextMatchNum: 90, as: 'home', qualifier: 'winner' });
  });

  it('match 77 winner goes to match 89 as away', () => {
    const entries = getBracketEntries(77);
    expect(entries[0]).toEqual({ nextMatchNum: 89, as: 'away', qualifier: 'winner' });
  });

  it('match 101 produces two entries: winner to final, loser to third place', () => {
    const entries = getBracketEntries(101);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ nextMatchNum: 104, as: 'home', qualifier: 'winner' });
    expect(entries).toContainEqual({ nextMatchNum: 103, as: 'home', qualifier: 'loser' });
  });

  it('match 102 produces two entries: winner to final as away, loser to third place as away', () => {
    const entries = getBracketEntries(102);
    expect(entries).toHaveLength(2);
    expect(entries).toContainEqual({ nextMatchNum: 104, as: 'away', qualifier: 'winner' });
    expect(entries).toContainEqual({ nextMatchNum: 103, as: 'away', qualifier: 'loser' });
  });
});

describe('resolveTeam', () => {
  const match = { home_team: 'Brazil', away_team: 'Argentina' };

  it('returns home team when winner=home and qualifier=winner', () => {
    expect(resolveTeam(match, 'home', 'winner')).toBe('Brazil');
  });

  it('returns away team when winner=away and qualifier=winner', () => {
    expect(resolveTeam(match, 'away', 'winner')).toBe('Argentina');
  });

  it('returns away team when winner=home and qualifier=loser', () => {
    expect(resolveTeam(match, 'home', 'loser')).toBe('Argentina');
  });

  it('returns home team when winner=away and qualifier=loser', () => {
    expect(resolveTeam(match, 'away', 'loser')).toBe('Brazil');
  });
});
