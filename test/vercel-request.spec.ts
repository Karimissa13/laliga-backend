import express from 'express';
import request from 'supertest';
import { corsOrigin, prepareVercelRequest, stripRewritePathParam } from '../src/common/vercel-request';

/** Vercel's runtime: `req.query` is a configurable lazy getter parsed from the ORIGINAL url (setter included). */
function vercelLike(req: any) {
  const original = new URL(req.url, 'http://x');
  const parse = () => Object.fromEntries(original.searchParams);
  Object.defineProperty(req, 'query', {
    configurable: true, enumerable: true,
    get: () => { const v = parse(); Object.defineProperty(req, 'query', { value: v, writable: true, configurable: true, enumerable: true }); return v; },
    set: (v) => Object.defineProperty(req, 'query', { value: v, writable: true, configurable: true, enumerable: true }),
  });
}

describe('prepareVercelRequest (what Express ends up parsing)', () => {
  // A tiny Express app that echoes the query it sees, behind the same steps as src/serverless.ts.
  const app = express();
  app.get('/api/v1/players', (req, res) => res.json(req.query));
  const handler = (prepare: boolean) => (req: any, res: any) => { vercelLike(req); if (prepare) prepareVercelRequest(req); app(req, res); };

  it('without it, the rewrite\'s path leaks into the query (the live bug)', async () => {
    const r = await request(handler(false)).get('/api/v1/players?page=2&path=v1%2Fplayers');
    expect(r.body).toEqual({ page: '2', path: 'v1/players' });
  });

  it('with it, Express parses the cleaned URL', async () => {
    const r = await request(handler(true)).get('/api/v1/players?page=2&search=ali+khan&path=v1%2Fplayers');
    expect(r.body).toEqual({ page: '2', search: 'ali khan' });
  });

  it('leaves requests without the rewrite copy untouched', async () => {
    const r = await request(handler(true)).get('/api/v1/players?page=3');
    expect(r.body).toEqual({ page: '3' });
  });
});

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
