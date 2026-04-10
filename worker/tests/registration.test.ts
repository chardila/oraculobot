import { describe, it, expect } from 'vitest';
import { extractInviteCode } from '../src/handlers/registration';

describe('extractInviteCode', () => {
  it('extracts code from /start deep-link', () => {
    expect(extractInviteCode('/start ABC12345')).toBe('ABC12345');
  });

  it('returns plain code unchanged', () => {
    expect(extractInviteCode('ABC12345')).toBe('ABC12345');
  });

  it('trims whitespace from deep-link code', () => {
    expect(extractInviteCode('/start  ABC12345 ')).toBe('ABC12345');
  });

  it('returns empty string when only /start with no code', () => {
    expect(extractInviteCode('/start')).toBe('/start');
  });
});
