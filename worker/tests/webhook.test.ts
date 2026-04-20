import { describe, it, expect } from 'vitest';
import { timingSafeEqual } from '../src/index';

describe('webhook secret validation', () => {
  it('rejects missing secret header (null)', () => {
    expect(timingSafeEqual(null, 'my-secret')).toBe(false);
  });

  it('rejects wrong secret', () => {
    expect(timingSafeEqual('wrong', 'my-secret')).toBe(false);
  });

  it('accepts correct secret', () => {
    expect(timingSafeEqual('my-secret', 'my-secret')).toBe(true);
  });

  it('rejects secret with different length', () => {
    expect(timingSafeEqual('short', 'my-secret')).toBe(false);
  });
});
