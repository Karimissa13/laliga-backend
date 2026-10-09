import { shouldSynchronize } from './db-sync';
import { assertVercelLiveMode } from './vercel-guard';

/** The live system (LALIGA_LIVE=true) never starts with the development signing keys. */
function liveSecretsCheck() {
  assertVercelLiveMode();
  if (process.env.LALIGA_LIVE !== 'true') return;
  const a = process.env.JWT_ACCESS_SECRET || '', r = process.env.JWT_REFRESH_SECRET || '';
  // Say which rule failed (lengths only, never the values) so the setting can be fixed first time.
  const why = [
    a.length < 32 && `JWT_ACCESS_SECRET has ${a.length} characters`,
    r.length < 32 && `JWT_REFRESH_SECRET has ${r.length} characters`,
    a && a === r && 'the two secrets are identical',
  ].filter(Boolean);
  if (why.length) {
    throw new Error(`Live system: set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to two different random values of at least 32 characters (${why.join('; ')}).`);
  }
}

export default () => (liveSecretsCheck(), {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  appName: process.env.APP_NAME || 'LaLiga Academy Backend',
  database: {
    url: process.env.DATABASE_URL,
    // One shared rule — see shouldSynchronize().
    synchronize: shouldSynchronize(),
    logging: process.env.DB_LOGGING === 'true',
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || 'dev-access-secret',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret',
    accessTtl: parseInt(process.env.JWT_ACCESS_TTL || '900', 10), // seconds
    refreshTtl: parseInt(process.env.JWT_REFRESH_TTL || '1209600', 10),
  },
  seed: {
    adminEmail: process.env.SEED_ADMIN_EMAIL || 'admin@laligaacademy.local',
    adminPassword: process.env.SEED_ADMIN_PASSWORD || 'Admin@12345',
  },
});
