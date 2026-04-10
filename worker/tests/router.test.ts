import { describe, it, expect } from 'vitest';
import { isStateStale } from '../src/router';

describe('isStateStale', () => {
  it('returns true when state is older than TTL', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(isStateStale(fiveHoursAgo, 4 * 60 * 60 * 1000)).toBe(true);
  });

  it('returns false when state is within TTL', () => {
    const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
    expect(isStateStale(oneHourAgo, 4 * 60 * 60 * 1000)).toBe(false);
  });

  it('returns false for a just-created state', () => {
    const now = new Date().toISOString();
    expect(isStateStale(now, 4 * 60 * 60 * 1000)).toBe(false);
  });
});
