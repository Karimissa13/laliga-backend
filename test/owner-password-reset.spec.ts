import { FROM_SEED, ownerResetPassword } from '../src/database/owner-password-reset';

describe('ownerResetPassword', () => {
  it('is off unless OWNER_PASSWORD_RESET is set', () => {
    expect(ownerResetPassword({ SEED_OWNER_PASSWORD: 'x'.repeat(14) } as any)).toBeUndefined();
    expect(ownerResetPassword({ OWNER_PASSWORD_RESET: '' } as any)).toBeUndefined();
  });

  it('uses the value typed into OWNER_PASSWORD_RESET', () => {
    expect(ownerResetPassword({ OWNER_PASSWORD_RESET: 'a-new-long-password' } as any)).toBe('a-new-long-password');
  });

  it('with the switch, takes the value typed into SEED_OWNER_PASSWORD', () => {
    expect(ownerResetPassword({ OWNER_PASSWORD_RESET: FROM_SEED, SEED_OWNER_PASSWORD: 'typed-by-the-owner' } as any)).toBe('typed-by-the-owner');
    expect(() => ownerResetPassword({ OWNER_PASSWORD_RESET: FROM_SEED } as any)).toThrow(/SEED_OWNER_PASSWORD is not set/);
  });
});
