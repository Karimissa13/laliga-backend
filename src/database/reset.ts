import 'reflect-metadata';
import * as dotenv from 'dotenv';
import { AppDataSource } from './data-source';

dotenv.config();

/** Drops and recreates the public schema — destructive, dev only. */
async function run() {
  if (process.env.NODE_ENV === 'production') {
    console.error('Refusing to reset in production.');
    process.exit(1);
  }
  const ds = await AppDataSource.initialize();
  await ds.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  console.log('Schema reset. Run `npm run db:setup` to rebuild and seed.');
  await ds.destroy();
}
run().catch((e) => { console.error(e); process.exit(1); });
