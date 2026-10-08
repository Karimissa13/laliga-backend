import { DEMO_PASSWORDS, livePasswordProblem } from '../src/config/live-passwords';

describe('livePasswordProblem', () => {
  it('refuses a missing or short password', () => {
    expect(livePasswordProblem(undefined)).toMatch(/12 characters/);
    expect(livePasswordProblem('')).toMatch(/12 characters/);
    expect(livePasswordProblem('Short@1234')).toMatch(/12 characters/);
  });

  it('refuses every demo password written in the repo, in any case', () => {
    for (const p of DEMO_PASSWORDS) expect(livePasswordProblem(p)).not.toBeNull();
    // LaLiga@2026! is exactly 12 characters, so the length rule alone let it through.
    expect(livePasswordProblem('LaLiga@2026!')).toMatch(/demo password/);
    expect(livePasswordProblem('laliga@2026!')).toMatch(/demo password/);
  });

  it('accepts a long password that is not a demo one', () => {
    expect(livePasswordProblem('a-long-unpublished-passphrase')).toBeNull();
  });
});
