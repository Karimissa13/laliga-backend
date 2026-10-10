#!/bin/sh
set -e

echo "Waiting for PostgreSQL..."
tries=0
until node -e "
const {Client}=require('pg');
const c=new Client({connectionString:process.env.DATABASE_URL_UNPOOLED||process.env.DATABASE_URL});
c.connect().then(()=>c.end()).catch(()=>process.exit(1));
" 2>/dev/null; do
  tries=$((tries+1))
  if [ "$tries" -ge 60 ]; then
    echo "PostgreSQL did not become reachable after 60s. Check DATABASE_URL." >&2
    exit 1
  fi
  sleep 1
done
echo "PostgreSQL is up."

if [ "$LALIGA_LIVE" = "true" ] || [ "$LALIGA_DEMO" = "true" ] || [ "$DB_SYNCHRONIZE" = "false" ]; then
  # Live system / demo / any migration-managed database (e.g. the Neon database the
  # Vercel deployment uses): exactly what every Vercel deploy runs — migrations, then
  # the idempotent setup. The schema is never auto-synchronised here.
  echo "Release: migrations, then setup..."
  npm run release --silent
else
  # Local laptop setup (docker compose, DB_SYNCHRONIZE=true): schema from the entities
  # on first boot, then the idempotent setup — unchanged, so existing local data keeps working.
  echo "Local database: schema sync, then setup..."
  DB_SYNCHRONIZE=true node dist/database/seed.js
  DB_SYNCHRONIZE=true node dist/database/seed-academy.js
fi

echo "Starting API + admin UI on :${PORT:-3000}"
exec node dist/main.js
