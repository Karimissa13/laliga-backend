import { DataSource } from 'typeorm';

export type DatabaseRole = 'live' | 'demo';

/** What this deployment is: the live academy system, the demo site, or neither (local / tests). */
export function deploymentRole(env: NodeJS.ProcessEnv = process.env): DatabaseRole | null {
  if (env.LALIGA_LIVE === 'true') return 'live';
  if (env.LALIGA_DEMO === 'true') return 'demo';
  return null;
}

/**
 * The first live or demo deploy marks its database (app_settings.databaseRole);
 * a deploy of the other kind then refuses it. So a demo deploy pointed at the live
 * database by mistake stops before creating its test logins — and the reverse.
 */
export async function claimDatabaseRole(ds: DataSource, role: DatabaseRole) {
  const read = async (): Promise<string | null> => {
    const [row] = await ds.query(`SELECT value FROM app_settings WHERE key = 'databaseRole'`);
    return row ? (typeof row.value === 'string' ? row.value : row.value?.role ?? null) : null;
  };
  let current = await read();
  if (!current) {
    await ds.query(`INSERT INTO app_settings (key, value) VALUES ('databaseRole', $1::jsonb) ON CONFLICT (key) DO NOTHING`,
      [JSON.stringify({ role, markedAt: new Date().toISOString() })]);
    current = await read();
  }
  if (current !== role) {
    throw new Error(`This is the ${current} database — a ${role} deploy refuses to use it. Check DATABASE_URL in the hosting settings.`);
  }
}
