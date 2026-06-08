import { describe, it, expect } from 'vitest';
import { validateWcSql } from '../src/services/wc-sql';

describe('validateWcSql', () => {
  it('accepts valid SELECT', () => {
    const r = validateWcSql('SELECT * FROM wc_matches WHERE year = 2018');
    expect(r.valid).toBe(true);
  });

  it('rejects non-SELECT', () => {
    const r = validateWcSql('DELETE FROM wc_matches');
    expect(r.valid).toBe(false);
  });

  it('accepts CTE (WITH ... SELECT)', () => {
    const r = validateWcSql(
      'WITH ranked AS (SELECT family_name, COUNT(*) as cnt FROM wc_referee_appearances GROUP BY family_name) SELECT * FROM ranked ORDER BY cnt DESC LIMIT 1'
    );
    expect(r.valid).toBe(true);
  });

  it('rejects disallowed table', () => {
    const r = validateWcSql('SELECT * FROM users');
    expect(r.valid).toBe(false);
  });

  it('rejects forbidden keywords inside SELECT', () => {
    const r = validateWcSql('SELECT * FROM wc_matches; DROP TABLE users');
    expect(r.valid).toBe(false);
  });

  it('accepts JOIN between allowed tables', () => {
    const r = validateWcSql(
      'SELECT scorer FROM wc_goals JOIN wc_matches ON wc_goals.match_id = wc_matches.id WHERE year = 2022'
    );
    expect(r.valid).toBe(true);
  });

  it('accepts new tables in ALLOWED_TABLES', () => {
    const queries = [
      'SELECT * FROM wc_bookings WHERE yellow_card = true',
      'SELECT * FROM wc_substitutions JOIN wc_matches ON wc_substitutions.match_id = wc_matches.id',
      'SELECT * FROM wc_group_standings WHERE year = 2022',
      "SELECT * FROM wc_award_winners WHERE award_name = 'Golden Boot'",
      'SELECT * FROM wc_penalty_kicks WHERE converted = true',
      "SELECT * FROM wc_player_appearances WHERE position_code = 'GK'",
      'SELECT * FROM wc_referees',
      'SELECT * FROM wc_referee_appearances JOIN wc_referees ON wc_referee_appearances.referee_id = wc_referees.id',
      'SELECT position, team, points FROM wc_standings_2026 WHERE group_name = \'A\' ORDER BY position',
    ];
    for (const q of queries) {
      const r = validateWcSql(q);
      expect(r.valid, q).toBe(true);
    }
  });
});
