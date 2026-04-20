import { describe, it, expect } from 'vitest';

function validateWebhookSecret(header: string | null, expected: string): boolean {
  return header === expected;
}

describe('webhook secret validation', () => {
  it('rejects missing secret header', () => {
    expect(validateWebhookSecret(null, 'my-secret')).toBe(false);
  });

  it('rejects wrong secret', () => {
    expect(validateWebhookSecret('wrong', 'my-secret')).toBe(false);
  });

  it('accepts correct secret', () => {
    expect(validateWebhookSecret('my-secret', 'my-secret')).toBe(true);
  });
});
