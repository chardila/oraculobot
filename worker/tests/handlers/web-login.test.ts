import { describe, it, expect } from 'vitest';

// Test the guard logic: only send OTP if user exists in our DB
function shouldSendOtp(userExistsInDb: boolean): boolean {
  return userExistsInDb;
}

describe('web login OTP guard', () => {
  it('sends OTP when user is registered', () => {
    expect(shouldSendOtp(true)).toBe(true);
  });

  it('does NOT send OTP when user is not registered', () => {
    expect(shouldSendOtp(false)).toBe(false);
  });
});
