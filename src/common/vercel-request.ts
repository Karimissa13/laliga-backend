/**
 * Vercel's rewrite (`/api/:path*` → `/api/index.js`, see vercel.json) appends the matched part as
 * `?path=v1/...`. The global ValidationPipe forbids unknown query parameters, so every list screen
 * with a query DTO would answer 400. Remove the parameter only when it is the rewrite's copy of
 * the path, so a genuine `path` parameter would survive.
 */
export function stripRewritePathParam(url: string): string {
  const q = url.indexOf('?');
  if (q < 0) return url;
  const pathname = url.slice(0, q);
  const copied = pathname.replace(/^\/api\/?/, '');
  const params = new URLSearchParams(url.slice(q + 1));
  const kept = new URLSearchParams();
  let removed = false;
  params.forEach((value, key) => {
    if (!removed && key === 'path' && value === copied) removed = true;
    else kept.append(key, value);
  });
  if (!removed) return url;
  const rest = kept.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/**
 * Prepare a request arriving through the Vercel function before Express sees it.
 *
 * Vercel's Node runtime gives the request a ready-made, lazily parsed `req.query`
 * (and `req.body`). Express only parses the query string itself when `req.query`
 * is empty — so stripping `?path=` from `req.url` alone is not enough: the copy in
 * Vercel's `req.query` would still reach the validation pipe. Reset it so Express
 * parses the cleaned URL. (The body is left alone: Express's parsers replace it.)
 */
export function prepareVercelRequest(req: { url?: string; query?: unknown }) {
  if (typeof req.url !== 'string') return;
  const cleaned = stripRewritePathParam(req.url);
  if (cleaned === req.url) return;
  req.url = cleaned;
  // Vercel defines `query` as a configurable lazy property; replace it with a plain, empty one.
  Object.defineProperty(req, 'query', { value: undefined, writable: true, configurable: true, enumerable: true });
}

/**
 * Browser origins allowed to call the API. `CORS_ORIGINS` (comma-separated) when set; otherwise
 * the live system answers its own site only (false = no CORS headers), and a non-live one
 * stays open for local tools.
 */
export function corsOrigin(env: NodeJS.ProcessEnv = process.env): string[] | boolean {
  const allowed = (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length) return allowed;
  return env.LALIGA_LIVE !== 'true';
}
