# LaLiga Academy — Operations Backend

Production-grade administration & operations backend for LaLiga Academy Abu Dhabi,
built from the approved audit blueprint. **NestJS + PostgreSQL + TypeORM**, API-first,
with real role-based access control and an immutable audit log.

> **Status: all six phases complete — the system runs end to end, with an admin UI.**
>
> | Phase | Delivered |
> |---|---|
> | 1 · Foundation | Schema (25+ tables), JWT auth, RBAC (92 permissions, 7 roles), audit log, People, Dashboard |
> | 2 · Registration | Structure config, Teams + rosters + transfers with history, merged trials pipeline, one-flow registration, waitlists, renewals |
> | 3 · Operations | Session calendar, **venue/coach conflict detection**, bulk term generation, **digital attendance register**, attendance alerts |
> | 4 · Finance | Fees catalog, **automatic discount rule engine**, invoice generation with UAE VAT, **payments ledger with computed status**, refunds/write-offs, wallet, gateway boundary |
> | 5 · Communications | Multi-channel drivers, templates, targeted audiences, history, **4 automations with dry-run preview** |
> | 6 · Analytics | Revenue/enrolment/capacity/coach-load/venue/attendance/conversion analytics, **Player Passport**, documents with expiry |
> | UI | Permission-aware admin interface served at `/` |
>
> | Ops | Cron scheduler for the automations · legacy data migration toolkit |
>
> **61 automated tests pass** (24 unit + 37 e2e) · **141 API routes**

## Quick look

**With Docker (nothing else to install):**

```bash
docker compose up
```

**Or with Node + PostgreSQL:**

```bash
npm install
cp .env.example .env      # set DATABASE_URL
npm run db:setup          # schema + roles + the academy (21 teams, 7 coaches) + one test family
npm run start:dev
```

Full instructions and troubleshooting: **[RUNNING.md](RUNNING.md)**.

Then open **http://localhost:3000** — the admin UI. Sign in as
`admin@laligaacademy.local` / `Admin@12345`, or as a coach
(`sergio@laligaacademy.local` / `Coach@12345`) to watch the navigation shrink to
what that role may see. The API explorer is at **/api/docs**.

## 1. Tech stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20+ / TypeScript |
| Framework | NestJS 10 (modular) |
| Database | PostgreSQL 14+ |
| ORM | TypeORM (pure JS `pg` driver) |
| Auth | JWT access + rotating refresh tokens, bcrypt hashing, 2FA-ready |
| Authorisation | Permission-based RBAC (`module.action`), global guards |
| Validation | class-validator / class-transformer, global ValidationPipe |
| API docs | Swagger / OpenAPI at `/api/docs` |
| Security | Helmet headers, CORS, uniform error envelope |

## 2. Quick start

```bash
# 1. Install
npm install

# 2. Configure — copy the example and set DATABASE_URL + JWT secrets
cp .env.example .env

# 3. Create schema + seed roles, permissions, admin, reference data
#    the academy's real structure, and one test family
npm run db:setup

# 4. Run
npm run start:dev          # watch mode
# or
npm run build && npm run start:prod
```

The API is served at **`http://localhost:3000/api/v1`** and Swagger UI at
**`http://localhost:3000/api/docs`**.

Default super-admin (from `.env`): **`admin@laligaacademy.local` / `Admin@12345`**.

## 3. How to test

```bash
npm test          # 24 unit tests (age derivation + every migration normaliser)
npm run test:e2e  # 37 e2e tests across all six phases + the scheduler
```

The e2e suite boots the real app against Postgres and asserts the full stack —
auth, RBAC enforcement (403s for a coach), registration and waitlisting, transfer
history, scheduling conflicts, the attendance register, the finance ledger and its
settlement tolerance, automations in dry-run, analytics and the Player Passport.
It needs a seeded database (`npm run db:setup`) reachable via `DATABASE_URL`.

### Try it by hand

```bash
BASE=http://localhost:3000/api/v1

# login
TOKEN=$(curl -s -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@laligaacademy.local","password":"Admin@12345"}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).accessToken")

curl -s $BASE/auth/me            -H "Authorization: Bearer $TOKEN"   # role + permissions
curl -s $BASE/dashboard          -H "Authorization: Bearer $TOKEN"   # KPIs + pending actions
curl -s "$BASE/players?limit=10" -H "Authorization: Bearer $TOKEN"   # players (paginated)

# register a family in one flow
GID=$(curl -s -X POST $BASE/guardians -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"fullName":"New Parent","email":"parent@example.com","mobile":"+9715..."}' \
  | node -pe "JSON.parse(require('fs').readFileSync(0)).id")
curl -s -X POST $BASE/players -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"guardianId\":\"$GID\",\"firstName\":\"Leo\",\"lastName\":\"Test\",\"gender\":\"MALE\",\"dateOfBirth\":\"2015-03-01\"}"
```

## 4. Architecture

```
src/
  main.ts                      bootstrap: prefix /api, URI versioning, Helmet, Swagger, global filter
  app.module.ts                wires modules + global guards/interceptor
  config/                      typed configuration
  database/
    entities/                  full domain model (see docs/data-model.reference.prisma)
    database.module.ts         TypeORM connection
    data-source.ts             standalone DataSource (CLI/seed)
    seed.ts                    permissions, roles, admin, reference + sample data
  common/
    decorators/                @Public, @RequirePermissions, @CurrentUser, @Audit
    guards/                    JwtAuthGuard, PermissionsGuard  (both global)
    interceptors/              AuditLogInterceptor
    filters/                   AllExceptionsFilter (uniform errors)
    dto/                       PaginationDto + paginate()
    reference.service.ts       gap-free reference codes (PR-/PL-/TR-/LA-) via Postgres sequences
  audit/                       AuditService (immutable log) — global
  rbac/permissions.catalog.ts  single source of truth: all permissions + default roles
  modules/
    auth/                      login / refresh / logout / me
    users/                     staff user management
    roles/                     roles & permissions (list, create custom, edit, delete)
    people/                    Guardians + Players (age-group derivation, siblings, history)
    structure/                 seasons, terms, locations, venues, age groups
    teams/                     teams, rosters, capacity, coaches, transfers
    registration/              leads/trials pipeline, conversion, one-flow register, enrolment
    scheduling/                session calendar, conflict detection, attendance register
    finance/                   fees, discount engine, invoices, payments ledger, wallet, gateway
    communications/            channels, templates, targeted sends, automations
    analytics/                 revenue, enrolment, capacity, coach load, attendance, conversion
    development/               evaluations, Player Passport, documents
    dashboard/                 KPIs, work queue, upcoming sessions, recent activity
    audit-view/                read the audit log
  migration/                   legacy CSV importer + normalisers (npm run migrate)
public/                        admin UI (index.html + app.css + app.js), served at /
```

## Migrating from the old system

```bash
npm run migrate -- --dir ./legacy-export                 # dry run, writes nothing
npm run migrate -- --dir ./legacy-export --commit        # import
npm run migrate -- --dir ./legacy-export --commit --derive-age --force
```

Export `parents.csv`, `players.csv` and `invoices.csv` from the old admin into a
folder. The dry run reports duplicate families, orphaned rows, unparseable age
categories, unrecognised payment methods, invoices whose status disagrees with
the money, and age labels that contradict the date of birth — and writes
`migration-report.json` beside your files. Nothing is written until `--commit`.

### Where each audit finding was fixed

| Audit finding | Fix |
|---|---|
| Role field unused — everyone an admin | 92-permission RBAC, guards on every route, role-aware UI |
| Audit page redirected to Reports | Immutable audit log + `/audit-logs` viewer |
| No security headers | Helmet with a strict CSP (`script-src 'self'`) |
| Age bands typed by hand, inconsistent | Derived from DOB + season cutoff, override retained |
| Two duplicate lead menus | One pipeline with a source attribute + funnel |
| Teams were labels only | Real entities: capacity, coach, roster, auto-waitlist |
| Changing a team destroyed history | Transfers write TRANSFERRED + new ACTIVE enrolments |
| Attendance via Excel import/export | Digital register per session, with alerts |
| Discounts picked manually | Rule engine (sibling/returning/early-bird) that explains itself |
| 7 hand-set payment statuses | One lifecycle computed from the payments ledger |
| "Not Paid 0" contradicted the data | Outstanding report derived from the ledger |
| Reports = export only | Live analytics across seven dimensions |
| Evaluations buried per-player | Player Passport + cross-player development view |

### Request lifecycle
Every request passes: **JwtAuthGuard** (authenticate, attach user + permissions) →
**PermissionsGuard** (enforce `@RequirePermissions`) → handler → **AuditLogInterceptor**
(records `@Audit`-decorated actions to the immutable log). Routes marked `@Public()`
skip authentication (login, refresh, health).

## 5. Roles & permissions

Permissions are `module.action` strings (e.g. `player.create`, `invoice.refund`).
Seven system roles ship by default (**Super Admin, General Admin, Finance, Operations,
Technical Director, Coach, Sales/Front Desk**) mirroring the approved matrix, and custom
roles can be created at runtime via `POST /roles`. Super Admin holds a `*` wildcard.

The full catalog lives in `src/rbac/permissions.catalog.ts` — add a feature's permission
keys there and reference them in `@RequirePermissions(...)`.

## 6. Data model

The complete normalized schema (25+ tables) is implemented as TypeORM entities under
`src/database/entities/` and documented as an ERD reference in
`docs/data-model.reference.prisma`. History is preserved by design: **enrolments**,
**invoices**, **payments**, **evaluations** and the **audit log** are append/immutable
records, so changing a player's team, season or coach never destroys prior data.

## 7. Configuration

| Var | Purpose |
|---|---|
| `DATABASE_URL` | Postgres connection string |
| `PORT` | HTTP port (default 3000) |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | token signing secrets |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | token lifetimes (seconds) |
| `DB_SYNCHRONIZE` | auto-sync schema (dev/test only; use migrations in prod) |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | initial super-admin |

## 8. Production notes

- **Migrations:** dev uses TypeORM `synchronize`. Before production, generate migrations
  (`typeorm migration:generate`) and set `DB_SYNCHRONIZE=false`; `data-source.ts` is wired
  for the TypeORM CLI. This is the one intentional Phase-1 shortcut, flagged for hardening.
- **Secrets:** replace all default secrets; enable staff 2FA (fields already in the schema).
- **Integrations** (payment gateway, email/SMS/WhatsApp) are stubbed structurally and land
  in their phases — the schema (`payments.gatewayId`, `communications`, templates) is ready.
