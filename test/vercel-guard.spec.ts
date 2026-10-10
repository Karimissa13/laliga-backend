import { assertVercelLiveMode, pastedSettingProblems, vercelLiveModeProblem } from '../src/config/vercel-guard';

describe('pastedSettingProblems', () => {
  it('passes clean values and ignores unknown or empty keys', () => {
    expect(pastedSettingProblems({ LALIGA_LIVE: 'true', JWT_ACCESS_SECRET: 'abc', SOMETHING: ' x ', PORTAL_URL: '' } as any)).toEqual([]);
  });

  it('names spaces, line breaks, quotes and KEY= pastes without showing the value', () => {
    const problems = pastedSettingProblems({
      LALIGA_LIVE: 'true\n', NODE_ENV: ' production', DB_SYNCHRONIZE: '"false"',
      SEED_OWNER_PASSWORD: "'hunter2-hunter2'", JWT_ACCESS_SECRET: 'JWT_ACCESS_SECRET=abc',
    } as any);
    expect(problems).toHaveLength(5);
    expect(problems.join(' ')).not.toMatch(/hunter2|abc/);
    const about = (key: string) => problems.find((p) => p.startsWith(`${key}:`));
    expect(about('LALIGA_LIVE')).toMatch(/space or line break/);
    expect(about('NODE_ENV')).toMatch(/space or line break/);
    expect(about('DB_SYNCHRONIZE')).toMatch(/quotes/);
    expect(about('SEED_OWNER_PASSWORD')).toMatch(/quotes/);
    expect(about('JWT_ACCESS_SECRET')).toMatch(/JWT_ACCESS_SECRET=/);
  });

  it('catches backticks from copied code and "KEY = value" lines from a terminal', () => {
    const problems = pastedSettingProblems({ LALIGA_LIVE: '`true`', JWT_REFRESH_SECRET: 'JWT_REFRESH_SECRET = abc' } as any);
    expect(problems).toEqual([
      'LALIGA_LIVE: the value is wrapped in quotes or backticks',
      'JWT_REFRESH_SECRET: the value starts with "JWT_REFRESH_SECRET=" (paste only what comes after the =)',
    ]);
  });

  it('stops a Vercel build on a paste mistake before anything else', () => {
    expect(() => assertVercelLiveMode({ VERCEL: '1', LALIGA_LIVE: 'true ' } as any)).toThrow(/LALIGA_LIVE: starts or ends/);
    expect(() => assertVercelLiveMode({ VERCEL: '1', LALIGA_LIVE: 'true' } as any)).not.toThrow();
    expect(() => assertVercelLiveMode({ LALIGA_LIVE: 'true ' } as any)).not.toThrow();
  });
});

describe('vercelLiveModeProblem', () => {
  it('does nothing off Vercel (local, Docker, tests)', () => {
    expect(vercelLiveModeProblem({} as any)).toBeNull();
    expect(vercelLiveModeProblem({ LALIGA_LIVE: 'false' } as any)).toBeNull();
  });

  it('refuses a Vercel build or function without live mode', () => {
    expect(vercelLiveModeProblem({ VERCEL: '1' } as any)).toMatch(/LALIGA_LIVE=true/);
    expect(vercelLiveModeProblem({ VERCEL: '1', LALIGA_LIVE: 'false' } as any)).toMatch(/LALIGA_LIVE=true/);
    expect(vercelLiveModeProblem({ VERCEL: '1', LALIGA_LIVE: 'TRUE' } as any)).toMatch(/LALIGA_LIVE=true/);
  });

  it('allows Vercel in live mode, or as the demo site', () => {
    expect(vercelLiveModeProblem({ VERCEL: '1', LALIGA_LIVE: 'true' } as any)).toBeNull();
    expect(vercelLiveModeProblem({ VERCEL: '1', LALIGA_DEMO: 'true' } as any)).toBeNull();
  });

  it('refuses live and demo at the same time, anywhere', () => {
    expect(vercelLiveModeProblem({ VERCEL: '1', LALIGA_LIVE: 'true', LALIGA_DEMO: 'true' } as any)).toMatch(/both/);
    expect(() => assertVercelLiveMode({ LALIGA_LIVE: 'true', LALIGA_DEMO: 'true' } as any)).toThrow(/both/);
  });
});
