#!/bin/sh
set -e

echo "Waiting for PostgreSQL…"
tries=0
until node -e "
const {Client}=require('pg');
const c=new Client({connectionString:process.env.DATABASE_URL});
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

# Schema + seed on first run. Both seeders are idempotent: they skip what exists,
# so this is safe on every restart. `set -e` aborts the boot if either fails
# rather than starting an API with no schema.
echo "Seeding…"
DB_SYNCHRONIZE=true node dist/database/seed.js
DB_SYNCHRONIZE=true node dist/database/seed-academy.js

echo "Starting API + admin UI on :3000"
exec node dist/main.js
