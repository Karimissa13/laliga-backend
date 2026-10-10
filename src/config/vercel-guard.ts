/**
 * Every Vercel deploy runs the seeds (`npm run build:vercel`). Outside live mode they create the
 * demo logins (Admin@12345, the Sergio coach login) and the test family — on a database reachable
 * from the internet. So on Vercel (VERCEL=1, set by Vercel for builds and functions) live mode is
 * required, for Production and Preview alike.
 */
export function vercelLiveModeProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.LALIGA_LIVE === 'true' && env.LALIGA_DEMO === 'true') return 'LALIGA_LIVE and LALIGA_DEMO are both set — a deployment is either the live system or the demo, never both.';
  // The demo site (LALIGA_DEMO=true) runs with test logins on its own database, behind the
  // Vercel login wall; the database marker (database-role.ts) keeps it off the live database.
  if (!env.VERCEL || env.LALIGA_LIVE === 'true' || env.LALIGA_DEMO === 'true') return null;
  return 'Running on Vercel without LALIGA_LIVE=true (or LALIGA_DEMO=true on the demo site). Add it in Vercel → Settings → Environment Variables (Production and Preview) and redeploy.';
}

/** Settings typed into the hosting dashboard, checked for paste mistakes. */
const PASTED_SETTINGS = [
  'LALIGA_LIVE', 'LALIGA_DEMO', 'NODE_ENV', 'DB_SYNCHRONIZE', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
  'SEED_OWNER_EMAIL', 'SEED_OWNER_PASSWORD', 'OWNER_PASSWORD_RESET','SEED_ADMIN_EMAIL', 'SEED_ADMIN_PASSWORD', 'PORTAL_URL',
  'CORS_ORIGINS', 'DATABASE_URL', 'DATABASE_URL_UNPOOLED',
  'MAIL_HOST', 'MAIL_PORT', 'MAIL_SECURE', 'MAIL_USER', 'MAIL_PASS', 'MAIL_FROM',
];

/**
 * Paste mistakes in dashboard settings: surrounding spaces or line breaks, quotes, or "KEY=value"
 * pasted as the value. Reports names and the kind of mistake only — never a value.
 */
export function pastedSettingProblems(env: NodeJS.ProcessEnv = process.env): string[] {
  const out: string[] = [];
  for (const key of PASTED_SETTINGS) {
    const v = env[key];
    if (!v) continue;
    if (v !== v.trim()) out.push(`${key}: starts or ends with a space or line break`);
    else if (/^(['"`]).*\1$/s.test(v)) out.push(`${key}: the value is wrapped in quotes or backticks`);
    else if (new RegExp(`^${key}\\s*[=:]`).test(v)) out.push(`${key}: the value starts with "${key}=" (paste only what comes after the =)`);
  }
  return out;
}

export function assertVercelLiveMode(env: NodeJS.ProcessEnv = process.env) {
  if (env.LALIGA_LIVE === 'true' && env.LALIGA_DEMO === 'true') throw new Error(vercelLiveModeProblem(env)!);
  if (!env.VERCEL) return;
  const problems = pastedSettingProblems(env);
  if (problems.length) {
    throw new Error(`Fix these settings in Vercel → Settings → Environment Variables, then redeploy:\n  - ${problems.join('\n  - ')}`);
  }
  const problem = vercelLiveModeProblem(env);
  if (problem) throw new Error(problem);
}
