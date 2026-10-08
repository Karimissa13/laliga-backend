/**
 * Whether TypeORM should auto-create/alter the schema.
 *
 * One rule, used by both the runtime app (configuration.ts) and the standalone
 * seeding DataSource (data-source.ts), so the two can never disagree.
 *
 * An explicit DB_SYNCHRONIZE wins. That matters because the Docker image runs with
 * NODE_ENV=production and relies on `DB_SYNCHRONIZE=true` to create the schema on
 * first boot — an earlier version ignored the flag in production, so a fresh
 * database was never created and seeding failed with `relation "permissions" does
 * not exist`.
 *
 * With the flag unset the safe default applies: on in dev/test, off in production.
 * Serverless deployments force it off separately (see database.module.ts), because
 * a cold start must never alter a live schema.
 */
export function shouldSynchronize(env: NodeJS.ProcessEnv = process.env): boolean {
  const explicit = env.DB_SYNCHRONIZE;
  if (explicit !== undefined && explicit !== '') return explicit === 'true';
  return env.NODE_ENV !== 'production';
}
