/**
 * Every Vercel deploy runs the seeds (`npm run vercel-build`). Outside live mode they create the
 * demo logins (Admin@12345, the Sergio coach login) and the test family — on a database reachable
 * from the internet. So on Vercel (VERCEL=1, set by Vercel for builds and functions) live mode is
 * required, for Production and Preview alike.
 */
export function vercelLiveModeProblem(env: NodeJS.ProcessEnv = process.env): string | null {
  if (!env.VERCEL || env.LALIGA_LIVE === 'true') return null;
  return 'Running on Vercel without LALIGA_LIVE=true. Add it in Vercel → Settings → Environment Variables (Production and Preview) and redeploy.';
}

export function assertVercelLiveMode(env: NodeJS.ProcessEnv = process.env) {
  const problem = vercelLiveModeProblem(env);
  if (problem) throw new Error(problem);
}
