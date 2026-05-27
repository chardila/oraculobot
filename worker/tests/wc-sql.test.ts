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
});
