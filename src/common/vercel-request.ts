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
 * Browser origins allowed to call the API. `CORS_ORIGINS` (comma-separated) when set; otherwise
 * the live system answers its own site only (false = no CORS headers), and a non-live one
 * stays open for local tools.
 */
export function corsOrigin(env: NodeJS.ProcessEnv = process.env): string[] | boolean {
  const allowed = (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length) return allowed;
  return env.LALIGA_LIVE !== 'true';
}
