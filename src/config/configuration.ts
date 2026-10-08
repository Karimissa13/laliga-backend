import { shouldSynchronize } from './db-sync';

/** The live system (LALIGA_LIVE=true) never starts with the development signing keys. */
function liveSecretsCheck() {
  if (process.env.LALIGA_LIVE !== 'true') return;
  const a = process.env.JWT_ACCESS_SECRET || '', r = process.env.JWT_REFRESH_SECRET || '';
  if (a.length < 32 || r.length < 32 || a === r) {
    throw new Error('Live system: set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET to two different random values of at least 32 characters.');
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
