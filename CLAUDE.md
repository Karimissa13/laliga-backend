# LaLiga Academy Abu Dhabi — operations backend

Claude Code reads this file first. It is the hand-over from the Cowork sessions (builds 1–14, Aug–Oct 2026).
Owner: **Karim Issa ("Kimo")**, Operations Manager, karim@inspirat.us. Second super admin: Michel (michel@inspirat.us).

## What this is
The replacement for the academy's old admin (PHP app at laligaacademyabudhabi.com/admin, still the live system of
record for season 2026/27 Term 1). One NestJS app serves: the staff admin UI (`/`), the parent portal (`/parent/`),
the parent payment page (`/pay/#token`) and the API (`/api/v1`).

## Stack
- NestJS 10 + TypeORM 0.3 + PostgreSQL 16. Node 24 (pinned `24.x` in package.json, which Vercel follows; Node 20 is end-of-life).
- On Vercel (`VERCEL=1`) the seeds and the app refuse to run without `LALIGA_LIVE=true` (`src/config/vercel-guard.ts`),
  so a deploy can never create the demo logins on an internet-facing database.
- Front end: vanilla JS SPA in `public/app.js` (no framework, strict CSP: no inline scripts/handlers).
  Actions are `data-act="name" data-a1=…` dispatched to `ACT.name`. New `ACT` entries must be defined **before**
  `const ACTIONS = {...ACT}`. Helpers: `api`, `go`, `openDrawer`, `toast`, `money`, `dmy`, `esc`, `opt`, `can`.
- Global guards: JWT + PermissionsGuard (all listed permissions required; `*` = super admin); `@Public()` opts out;
  `@Audit()` writes the immutable audit log. Global ValidationPipe uses whitelist + forbidNonWhitelisted.
- PDFs with pdfkit; email via SMTP (`MAIL_*`, or `laliga-mail.env` next to START-LALIGA.bat locally).
- JSON timestamps from `timestamp without time zone` columns need `AT TIME ZONE 'UTC'` in raw SQL.

## Run and test
```
npm ci
npm run build
# local DB (Docker gives one):  docker compose up      → http://localhost:3000
DATABASE_URL=postgresql://… DB_SYNCHRONIZE=false node dist/database/migrate.js
node dist/database/seed.js && node dist/database/seed-academy.js
npm test                       # unit (71)
npm run test:e2e               # e2e (141) — needs a seeded DB in DATABASE_URL
npm run db:migration:check     # fails if entities changed without a migration
```
Test logins on a non-live DB: admin@laligaacademy.local / Admin@12345, sergio@laligaacademy.local / Coach@12345.
Run the e2e suite on a **fresh, seeded** database (some suites assume the seed's teams and term dates).

## Rules that must not be broken
1. **Never touch the old system's data.** It is only ever read (exports, read-only screens). Never write to it,
   never migrate it in place. Every import runs into a copy first (a Neon branch or a scratch DB).
2. **Payments and invoices are records.** Never delete an invoice (cancel it). Never edit a recorded payment
   (refund / write-off instead). Instalment plans can't drop below what an instalment received.
3. **Schema changes = migrations.** The live DB runs with `DB_SYNCHRONIZE=false`. After changing an entity:
   `npm run db:migration:generate -- src/database/migrations/<Name>` against a DB at the current schema, review it,
   commit it. `npm run db:migration:check` must pass.
4. **No credentials in code or chat.** Karim types passwords and keys into the hosting settings himself. Don't
   ask for them, don't log them. `LALIGA_LIVE=true` refuses default JWT secrets and demo logins.
5. **Deleting data on Karim's machine is his action** (typed confirmations: RESET for the local DB,
   CLEAR INVENTORY for the store). Don't script deletions of his data.
6. Ask before decisions that are his (prices, policy, wording parents see); flag conflicts instead of assuming;
   keep earlier requirements unless he changes them; summarise what changed each time.

## Where things are
| Area | Code |
|---|---|
| Registration, family invoice, start date proration | `src/modules/player-desk/`, `src/modules/finance/proration.service.ts` |
| Invoices, discounts (sibling ladder + any-% manual), adjust unpaid invoice | `src/modules/finance/invoices.service.ts`, `manual-discounts.ts`, `discount-engine.service.ts` |
| Instalments (2–5, % + due date, staff only) | `src/modules/finance/instalments.ts` (pure), `instalments.service.ts` |
| Payment links + public pay page | `src/modules/payment-links/`, `public/pay/` (gateway = mock until Payfort/Network) |
| Payment gateway boundary + webhook | `src/modules/finance/payment-gateway.service.ts`, `finance.controller.ts` (webhook refused while mock) |
| Term reports (Development 1–5 / Advanced 0–5) | `src/modules/development/` |
| Trials & leads, website pop-up endpoint | `src/modules/registration/leads.controller.ts` → `POST /api/v1/public/trial-requests` |
| Inventory (one practice item LL-TEST-M; super-admin "Start again") | `src/modules/inventory/` |
| Legacy import toolkit (CSV) | `src/migration/import-legacy.ts` (`npm run migrate -- --dir ./legacy-export`, dry run by default) |
| Live deploy (Vercel + Neon) | `vercel.json`, `api/index.js` → `src/serverless.ts`, `npm run build:vercel`, `src/database/migrate.ts` |

History of every build and decision: `PROGRESS.md`. The Claude Project "LaLiga Backend Enhancement" holds one doc
per build and the go-live plan ("LaLiga — go-live and Term 2 cutover plan").

## Where we stopped (8 Oct 2026, build 14)
Done in build 14: inventory reset + one practice item; baseline migration and `migrate.ts`; live mode
(`LALIGA_LIVE`); Vercel entry compiled by `nest build` (`src/serverless.ts`); security headers in `vercel.json`;
live-secrets check. All tests green on a migration-built DB.

Decisions (Karim, 8 Oct): go live in stages (admin online first, then the public homepage); the new system takes
over at **Term 2** — freeze the old admin ~14 Dec, import, reconcile, start Term 2 (4 Jan 2027) on the new system;
old data comes as a **MySQL dump from the old host**; hosting = **Vercel + Neon** (Frankfurt).

## Next, in order
1. **Stage 1 deploy with Karim** (he clicks; walk him through): GitHub private repo → Neon project (Frankfurt) →
   Vercel import with the Neon integration → env vars (`LALIGA_LIVE=true`, `NODE_ENV=production`,
   `DB_SYNCHRONIZE=false`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `SEED_OWNER_PASSWORD`, `PORTAL_URL`, `MAIL_*`,
   later `CORS_ORIGINS`) → first deploy → domain `app.laligaacademyabudhabi.com`. Then rewrite `DEPLOY-VERCEL.md`
   to match (it still describes the old manual-seed flow).
2. **Serverless gaps:** the website pop-up rate limiter is in memory (per instance) — move it to the DB; the
   automation scheduler can't run on Vercel — add Vercel Cron calling a protected endpoint (keep automations off
   until Karim enables them).
3. **Legacy importer from the MySQL dump:** map the old tables (families/parents, players, user terms, invoices,
   installments, payments, wallet, discounts) into the new schema. Keep the old numbers (PL-, PR-, LA-) and start the
   new sequences after the highest. Produce a reconciliation report: every invoice's total, paid and balance and
   every family's balance must equal the old system's. Rehearse on a Neon branch, never on main.
4. **Stage 2:** publish the designer homepage as its own Vercel project; point its pop-up at
   `/api/v1/public/trial-requests`; set `CORS_ORIGINS`.
5. **Payment gateway:** Payfort (the old system's link provider) or Network — a `PaymentGatewayDriver` once Karim
   has merchant credentials.
6. Still open from earlier builds: import of the trials-sheet rows and old leads; the Advanced-teams tab; kit/league
   VAT question (367.50/577.50/620 vs 350/550/600); reCAPTCHA on the pop-up; goalkeeper items of the Advanced
   report to confirm with coaches; old evaluation PDFs not imported; staff 2FA and login rate limiting.

## Known security findings to keep in mind
- Old live site: invoice PDFs are public at guessable URLs (`/public/storage/invoices/INVAB-<invoice><parent>.pdf`),
  and a public backup zip (`bkp-10-7-2026.zip`) likely exposes `.env` and DB data — both must be removed by the
  old host. Mention them again when talking to the host about the dump.
