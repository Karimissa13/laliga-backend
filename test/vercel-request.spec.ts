import { corsOrigin, stripRewritePathParam } from '../src/common/vercel-request';

describe('stripRewritePathParam', () => {
  it('removes the copy of the path added by the Vercel rewrite', () => {
    expect(stripRewritePathParam('/api/v1/auth/login?path=v1%2Fauth%2Flogin')).toBe('/api/v1/auth/login');
    expect(stripRewritePathParam('/api/v1/players?page=2&search=ali+khan&path=v1%2Fplayers'))
      .toBe('/api/v1/players?page=2&search=ali+khan');
  });

  it('leaves other URLs alone', () => {
    expect(stripRewritePathParam('/api/v1/players')).toBe('/api/v1/players');
    expect(stripRewritePathParam('/api/v1/players?page=2')).toBe('/api/v1/players?page=2');
    // A genuine `path` parameter that is not the rewrite's copy survives.
    expect(stripRewritePathParam('/api/v1/files?path=docs%2Fa.pdf')).toBe('/api/v1/files?path=docs%2Fa.pdf');
  });
});

describe('corsOrigin', () => {
  it('uses CORS_ORIGINS when set', () => {
    expect(corsOrigin({ CORS_ORIGINS: 'https://a.example, https://b.example', LALIGA_LIVE: 'true' } as any))
      .toEqual(['https://a.example', 'https://b.example']);
  });

  it('allows no other site on the live system by default, any site elsewhere', () => {
    expect(corsOrigin({ LALIGA_LIVE: 'true' } as any)).toBe(false);
    expect(corsOrigin({} as any)).toBe(true);
  });
});
