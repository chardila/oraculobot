import { describe, it, expect } from 'vitest';
import { sanitizeUsername } from '../../src/handlers/question';

describe('sanitizeUsername', () => {
  it('removes newlines', () => {
    expect(sanitizeUsername('user\nINSTRUCTIONS')).not.toContain('\n');
  });

  it('removes carriage returns', () => {
    expect(sanitizeUsername('user\rINSTRUCTIONS')).not.toContain('\r');
  });

  it('truncates to 30 chars', () => {
    expect(sanitizeUsername('a'.repeat(50)).length).toBeLessThanOrEqual(30);
  });

  it('returns Anónimo for null', () => {
    expect(sanitizeUsername(null)).toBe('Anónimo');
  });

  it('returns Anónimo for undefined', () => {
    expect(sanitizeUsername(undefined)).toBe('Anónimo');
  });

  it('leaves normal usernames unchanged', () => {
    expect(sanitizeUsername('Carlos')).toBe('Carlos');
  });
});
