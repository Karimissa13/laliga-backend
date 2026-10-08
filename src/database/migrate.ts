import 'reflect-metadata';
import { AppDataSource } from './data-source';

/**
 * Bring the live database's schema up to date with the migrations in
 * dist/database/migrations (run on every deploy, before seeding). On the live
 * system the schema is never auto-synchronised: every change is a reviewed
 * migration, so a deploy can't silently drop a column holding real data.
 */
async function main() {
  // Schema changes go over the direct connection (Neon's pooler doesn't suit DDL);
  // the app itself uses the pooled DATABASE_URL.
  const direct = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!direct) throw new Error('DATABASE_URL is not set.');
  AppDataSource.setOptions({ url: direct, synchronize: false, migrationsTransactionMode: 'each' } as any);
  await AppDataSource.initialize();
  await AppDataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  const done = await AppDataSource.runMigrations();
  console.log(done.length ? `Migrations applied: ${done.map((m) => m.name).join(', ')}` : 'Schema already up to date.');
  await AppDataSource.destroy();
}
main().catch((e) => { console.error(e); process.exit(1); });
