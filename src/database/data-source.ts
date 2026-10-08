import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';
import * as entities from './entities';
import { shouldSynchronize } from '../config/db-sync';

dotenv.config();

// Standalone DataSource for the TypeORM CLI (migration generation) and seeding.
const DB_URL = process.env.DATABASE_URL;
// Managed Postgres (Neon, Supabase, Render, RDS) requires TLS.
const NEEDS_SSL = /neon\.tech|supabase|render\.com|amazonaws\.com|sslmode=require/.test(DB_URL ?? '');

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: DB_URL,
  ssl: NEEDS_SSL ? { rejectUnauthorized: false } : false,
  entities: Object.values(entities).filter((e: any) => typeof e === "function") as any,
  synchronize: shouldSynchronize(),
  logging: process.env.DB_LOGGING === 'true',
  // Relative to this file, so it works from any working directory (Vercel build, Docker, CLI).
  migrations: [join(__dirname, 'migrations', `*.${__filename.endsWith('.ts') ? 'ts' : 'js'}`)],
});
