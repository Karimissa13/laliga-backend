# Running it on your machine

The zip contains source code — it isn't a running server. `http://localhost:3000`
only responds once you've started it on your own computer. Pick whichever route
below suits you.

---

## Route A — Docker (recommended, nothing else to install)

You need **Docker Desktop** ([docker.com/products/docker-desktop](https://www.docker.com/products/docker-desktop/)).
It bundles the database, so there is nothing else to set up.

```bash
cd laliga-backend
docker compose up
```

First run takes a few minutes (it downloads Node and PostgreSQL images, installs
packages, creates the schema and loads the academy structure — 21 teams, 7 coaches, one test family). You'll know it's ready when
you see:

```
Starting API + admin UI on :3000
LaLiga backend running on http://localhost:3000
```

Then open **http://localhost:3000**.

To stop: `Ctrl+C`. To start again: `docker compose up`. To wipe the data and start
fresh: `docker compose down -v && docker compose up`.

---

## Route B — Node + PostgreSQL directly

You need **Node.js 20+** ([nodejs.org](https://nodejs.org)) and **PostgreSQL 14+**
([postgresql.org/download](https://www.postgresql.org/download/)).

```bash
cd laliga-backend
npm install
```

Create a database and point the app at it. Copy `.env.example` to `.env` and set
`DATABASE_URL` to match your PostgreSQL install, for example:

```
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/laliga
```

Create the database once (from a terminal, or in pgAdmin):

```bash
psql -U postgres -c "CREATE DATABASE laliga;"
```

Then:

```bash
npm run db:setup     # schema + roles + permissions + academy structure + one test family
npm run db:fresh     # wipe and rebuild from scratch (development only)
npm run start:dev
```

Open **http://localhost:3000**.

### On Windows

`npm` and `node` work the same in PowerShell. Two things to watch:

- Run `psql` from the "SQL Shell (psql)" app that ships with PostgreSQL, or add
  `C:\Program Files\PostgreSQL\16\bin` to your PATH.
- If `npm run start:dev` exits immediately, run `npm run build` first and read the
  error it prints — it's almost always the `DATABASE_URL`.

---

## Signing in

| Role | Email | Password |
|---|---|---|
| Super Admin | `admin@laligaacademy.local` | `Admin@12345` |
| Coach (restricted view) | `sergio@laligaacademy.local` | `Coach@12345` |

Sign in as the coach to see permissions enforced — the navigation drops from 13
modules to 6, and the API returns 403 for anything outside that role.

The API explorer (every endpoint, try-it-out) is at **http://localhost:3000/api/docs**.

---

## If something doesn't work

**"This site can't be reached" / connection refused**
The server isn't running. Go back to Route A or B — a terminal must be left open
with the app running.

**`ECONNREFUSED ... 5432` or "database ... does not exist"**
PostgreSQL isn't running, or `DATABASE_URL` is wrong. On Route A this can't happen;
on Route B check the service is started and the database exists.

**`password authentication failed for user "postgres"`**
The password in `DATABASE_URL` doesn't match your PostgreSQL install.

**Port 3000 already in use**
Something else is on that port. Set `PORT=3001` in `.env` (Route B), or change
`"3000:3000"` to `"3001:3000"` in `docker-compose.yml` (Route A), then use
`http://localhost:3001`.

**Blank page, or "Loading…" that never finishes**
Open the browser console (F12). If you see 401s, sign in again; the access token
expires after 15 minutes.

**Docker: "port is already allocated"**
Another container is using 3000 or 5433 — `docker compose down`, then up again.

---

## Verifying it works

```bash
npm test          # 5 unit tests
npm run test:e2e  # 35 end-to-end tests against the real API + database
```

Both suites should pass. The e2e suite needs the database seeded
(`npm run db:setup`) and exercises auth, permissions, registration, waitlists,
transfers, scheduling conflicts, the finance ledger, automations and analytics.

## Starting again from a clean database (Windows / Docker)

`RESET-LALIGA.bat`, next to `START-LALIGA.bat`, erases the local database and starts
fresh: 21 teams, 7 coaches, your login and the one test family. It asks you to type
`RESET` first, because everything entered since is lost.

## Staff sign-in (Karim, Michel, coaches)

- Karim signs in with his account as before.
- **Michel** (michel@inspirat.us, super admin) is created without a usable password. Karim sets one under **Settings → Staff accounts**, tells Michel, and Michel changes it with **Password** under his name.
- Coaches have accounts that are switched off. To give a coach access, tick **Active** on their row in Staff accounts, set a password and Save. Coaches never see fees, invoices or payments.

## Connecting email (welcome emails and invoices)

Until a mailbox is connected, the welcome email (with the parent's sign-in details)
and the invoice email (with the PDF attached) are **recorded in Email log but not sent**.

1. Copy `laliga-mail.env.example` (inside the zip) into the same folder as
   `START-LALIGA.bat`, and rename it to `laliga-mail.env`.
2. Fill in `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS` and `MAIL_FROM` from your
   email provider (Microsoft 365 and Google Workspace examples are in the file).
3. Run `START-LALIGA.bat` again. **Settings → Email to parents** then shows "Connected".

The file lives outside the `laliga-backend` folder on purpose: START unpacks a fresh
copy of that folder each time, and your mail settings must survive that. The password
in it is only read by the server — it is never stored in the database or shown on screen.

Parents sign in at `http://localhost:3000/parent/` (set the real address under
**Settings → Email to parents** once the portal is online).

## Connecting the website's "Book a Free Trial" pop-up

Requests from the website land in **Trials & Leads** once the pop-up posts to this
backend instead of the old admin. Ask the web developer to send the form to:

```
POST https://<where this backend is hosted>/api/v1/public/trial-requests
Content-Type: application/json

{ "guardianName": "Sara Ahmed", "guardianEmail": "sara@example.com" (optional),
  "playerName": "Omar", "guardianMobile": "050 123 4567",
  "playerDob": "14/03/2015", "isGuardian": true, "sourceDetail": "home page pop-up" }
```

- No sign-in is needed. Extra hidden fields on the form are ignored.
- The reply is `{ "ok": true, "reference": "TR-000123" }`; show the reference on the thank-you message.
- A hidden field called `website` must stay empty — anything in it is treated as a bot.
- One address can send at most 8 requests an hour.
- The form's reCAPTCHA is not checked here yet; that needs the site's reCAPTCHA secret key.

While the backend only runs on this PC (localhost) the public website can't reach it —
this works once the backend is hosted.

## Running the tests

The e2e suite needs volume data the real system deliberately doesn't carry, so run it
against a separate **test** database:

```bash
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/laliga_test
npm run db:setup && npm run test:fixtures
npm test && npm run test:e2e
```

Never run `test:fixtures` against the academy's real database.
