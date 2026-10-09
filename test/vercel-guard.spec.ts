import { vercelLiveModeProblem } from '../src/config/vercel-guard';

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

  it('allows Vercel in live mode', () => {
    expect(vercelLiveModeProblem({ VERCEL: '1', LALIGA_LIVE: 'true' } as any)).toBeNull();
  });
});
