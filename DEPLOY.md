# Deploying the LaLiga Academy backend

How the live system runs today (Vercel + Neon), and how to run the same code on
any other host — a Docker host, a Node server behind nginx, or the old website's
server — **against the same database**, so the host can change without moving data.

> Rule of thumb: passwords and keys are typed into the host's settings by Karim.
> They are never written in the code, the repository, chat, or email.

---

## 1. What the live system is (October 2026)

| Piece | Where | Notes |
|---|---|---|
| Code | GitHub `Karimissa13/laliga-backend` (private), branch `main` | Every push to `main` deploys to production |
| App | Vercel project `laliga-backend` (team `laliga-backend`, Hobby) | Functions in Frankfurt (`fra1`), Node 24 |
| Database | Neon project `laliga-academy`, branch `production`, database `neondb` | Frankfurt, PostgreSQL 18, Free plan |
| Address | `https://laliga-backend.vercel.app` (behind Vercel's login wall) | Custom domain `app.laligaacademyabudhabi.com` attached in Vercel; DNS record at GoDaddy still to add |

**Before the Term 2 import (December):** move Neon to a paid plan (longer restore
history) and Vercel to Pro (Hobby is for non-commercial use; Hobby cron runs at most daily).

### The database is marked "live"

The first live deploy wrote `app_settings.databaseRole = live`. A deploy in demo mode
refuses a database marked live (and a live deploy refuses one marked demo), so the
demo's test logins can never be created on the live database by a wrong `DATABASE_URL`.

---

## 2. Settings (environment variables)

The same names on every host.

| Setting | Live value | Who sets it |
|---|---|---|
| `LALIGA_LIVE` | `true` | Not secret |
| `NODE_ENV` | `production` | Not secret |
| `DB_SYNCHRONIZE` | `false` (the live system ignores `true` anyway) | Not secret |
| `PORTAL_URL` | `https://app.laligaacademyabudhabi.com/parent/` | Not secret |
| `DATABASE_URL` | Neon **pooled** connection string (host contains `-pooler`) | Neon integration on Vercel; **Karim** elsewhere |
| `DATABASE_URL_UNPOOLED` | Neon **direct** connection string (used for migrations) | Neon integration on Vercel; **Karim** elsewhere |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Two different random values, 32+ characters | **Karim** |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` | The academy mailbox (later) | **Karim** (`MAIL_PASS` is secret) |
| `CORS_ORIGINS` | Stage 2: the homepage's address, comma-separated | Not secret |
| `TRUST_PROXY` | Number of proxies in front: `1` behind nginx / a load balancer. Vercel: automatic | Not secret |
| `API_DOCS` | `true` only to show the API explorer at `/api/docs` on the live system (hidden by default) | Not secret |
| `AUTOMATIONS_ENABLED` | Off until Karim switches automations on | Not secret |
| `SEED_OWNER_PASSWORD` | **Only for a brand-new, empty database**, then delete it | **Karim** |
| `OWNER_PASSWORD_RESET` | **Only to reset the owner's password**: the next deploy applies it once; then delete it | **Karim** |

Generate a signing key (run twice, one line each):

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

**Paste mistakes are caught.** Before setting anything up, a deploy checks these settings
for spaces or line breaks around the value, quotes or backticks, or `KEY=` pasted into the
value, and names the setting (never the value). The app also refuses to start in live mode
without two strong, different JWT secrets, and refuses the demo passwords written in this
repository (`LaLiga@2026!`, `Admin@12345`, `Coach@12345`).

---

## 3. What every deploy runs: `npm run release`

Same on every host:

1. `node dist/database/migrate.js` — applies new reviewed migrations over the **direct**
   connection (`DATABASE_URL_UNPOOLED`, else `DATABASE_URL`). The live schema is never
   auto-synchronised.
2. `node dist/database/seed.js` — roles, permissions, the named super admins, reference data.
   Idempotent: only adds what is missing. In live mode: no generic admin, no demo logins.
3. `node dist/database/seed-academy.js` — the academy's structure (coaches, teams, price list,
   calendar). Idempotent; no test family in live mode.
4. `node dist/database/demo-data.js` — demo / test data. **Skipped on the live system.**

On Vercel this is `npm run build:vercel` (= `nest build` + `npm run release`), set in `vercel.json`.

---

## 4. Vercel + Neon (current)

### First-time set-up (what was done in October 2026)

1. **GitHub** — private repository `laliga-backend`, push `main`.
2. **Neon** — project `laliga-academy`, region **AWS Europe Central 1 (Frankfurt)**.
3. **Vercel** — *Add New → Project → Import* the repository; Framework Preset **Other**.
   `vercel.json` sets the rest: install `npm ci --include=dev` (the build tools are needed
   even with `NODE_ENV=production`), build `npm run build:vercel`, output `public`,
   functions in `fra1`, security headers, `/api/*` → the function.
4. **Settings** — the table above, for **Production and Preview**, marked *Sensitive*.
5. **Neon ↔ Vercel** — Neon Console → *Integrations → Vercel*: link the Vercel project
   `laliga-backend` to `laliga-academy` / `production` / `neondb`. It manages
   `DATABASE_URL` and `DATABASE_URL_UNPOOLED` (they don't show in `vercel env ls`, which
   hides integration-managed settings — the Vercel dashboard and API do show them).
6. **First deploy** — *Deployments → ⋯ → Redeploy* (without build cache). The log shows
   `Migrations applied`, `database: live`, the seeds, and `Demo data: live system — skipped`.
7. **First sign-in** — `karim@inspirat.us` with `SEED_OWNER_PASSWORD`; then delete that setting.

### Every change after that

Push to `main` → Vercel builds, runs `npm run release`, and switches traffic only if
everything succeeded. A failed build leaves the previous version live.

### Custom domain (to do)

The domain `app.laligaacademyabudhabi.com` is already attached to the Vercel project.
At GoDaddy (*My Products → Domains → laligaacademyabudhabi.com → DNS → Add New Record*):

| Type | Name | Value | TTL |
|---|---|---|---|
| CNAME | `app` | `1c41524825f0306e.vercel-dns-017.com` | default |

Change nothing else (the `@` A record keeps the current website, MX keeps email).
Vercel issues the HTTPS certificate by itself. On the custom domain the app is public
(the parent portal and pay page need that), unlike the `.vercel.app` address.

### Vercel specifics handled in code

- Vercel's rewrite adds `?path=…` to every API request and pre-parses `req.query`;
  `src/common/vercel-request.ts` removes both before Nest validates the request.
- On Vercel (`VERCEL=1`) the seeds and the app refuse to run unless `LALIGA_LIVE=true`
  (or `LALIGA_DEMO=true` on a demo site) — `src/config/vercel-guard.ts`.
- Scheduled automations don't run on Vercel functions; they will use Vercel Cron (planned).

---

## 5. Another host, same database

The code is host-independent: `src/main.ts` (long-running server) and `src/serverless.ts`
(Vercel) share one set-up, `src/app-setup.ts` — security headers, CORS, body limits,
validation, error format, proxy handling — so the system behaves the same everywhere.

### Option A — Docker (any server with Docker)

```bash
docker build -t laliga-backend .
```

```bash
docker run -d --name laliga --restart unless-stopped -p 3000:3000 --env-file /etc/laliga/live.env laliga-backend
```

`/etc/laliga/live.env` holds the settings from section 2 (`LALIGA_LIVE=true`,
`DATABASE_URL`, `DATABASE_URL_UNPOOLED`, the JWT secrets, `PORTAL_URL`, `TRUST_PROXY=1` behind
nginx, …), readable only by root. On start the container waits for the database, runs
`npm run release` (because `LALIGA_LIVE=true`), then starts the API + admin UI on port 3000.
It reports its health to Docker (`/api/v1/health`).

### Option B — Node 24 directly (behind nginx or similar)

```bash
npm ci
```

```bash
npm run build
```

```bash
npm run release
```

```bash
npm run start:prod
```

Run the last one under a process manager (systemd, pm2) with the section 2 settings in
its environment, and put nginx (TLS) in front with `TRUST_PROXY=1`.

### Moving the live system from Vercel to another host

1. Set up the new host (A or B) with **the same** `DATABASE_URL` / `DATABASE_URL_UNPOOLED`
   (copy them from Neon → *Connect*), new or the same JWT secrets (new ones sign everyone out once),
   `LALIGA_LIVE=true`, `PORTAL_URL`, `MAIL_*`, `CORS_ORIGINS`.
2. Start it and check `https://<new host>/api/v1/health` → `"mode":"live","db":"up"`;
   sign in on the new host's address.
3. Point the DNS for `app.laligaacademyabudhabi.com` at the new host.
4. Once traffic has moved, disconnect the Vercel project from GitHub (*Settings → Git*) so
   pushes no longer deploy there; nothing in the database changes.

Neon stays where it is; the data never moves. (To leave Neon too: take a `pg_dump` of
`neondb`, restore it into the new PostgreSQL 16+, run `npm run release` against it.)

### Running two hosts at once

Possible (both on the same database), with two cautions: run **one** release at a time
(migrations), and switch scheduled automations on in **one** place only.

---

## 6. Backups and recovery

- Neon keeps a restore history (6 hours on Free; longer on paid plans) — restore by
  creating a branch at a point in time, check it, then switch.
- Before anything risky (the legacy import), create a Neon **branch** and work there first
  (CLAUDE.md rule: imports never run on `main`/`production` first).
- Records are protected in the database itself where it matters most: tax credit notes
  cannot be edited or deleted (database trigger).

---

## 7. Local development (laptop)

`docker compose up` (see RUNNING.md) runs a local PostgreSQL and the app with test logins
and a test family. That database is built from the entities (`DB_SYNCHRONIZE=true`) — it is
**not** the live database and never touches it.
