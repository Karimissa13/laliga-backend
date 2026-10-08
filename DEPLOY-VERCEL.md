# Deploying to Vercel

> **Out of date since build 14.** Deploys now run migrations and setup automatically (`npm run vercel-build`) and need `LALIGA_LIVE=true`. Follow the go-live plan in the Claude Project; this file is being rewritten (see CLAUDE.md → Next).

This gets you a real, shareable URL — `https://laliga-backend-<something>.vercel.app` —
with the admin UI and the API running against a live database, so you can test
with real data and real writes before we wire up payments, messaging and storage.

Budget about **15 minutes**. Everything below is free-tier.

---

## What you need

| | Why |
|---|---|
| A **GitHub** account | Vercel deploys from a repository |
| A **Vercel** account | [vercel.com/signup](https://vercel.com/signup) — sign in with GitHub |
| A **Neon** account | [neon.tech](https://neon.tech) — free hosted PostgreSQL |

Vercel runs code as *serverless functions*, which don't keep a database running.
That's why the database lives separately at Neon. (Supabase or Vercel Postgres
work identically — just use their connection string instead.)

---

## Step 1 — Create the database (3 min)

1. Sign up at [neon.tech](https://neon.tech) and create a project — call it `laliga`.
2. On the project dashboard, find **Connection string**.
3. Switch the toggle to **Pooled connection** (this matters — see the note at the
   bottom), and copy it. It looks like:

   ```
   postgresql://neondb_owner:XXXX@ep-xxx-pooler.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

Keep that string handy — it's `DATABASE_URL` below.

---

## Step 2 — Load the schema and your account (4 min)

The database starts empty. Run the seed **once** from your own machine, pointed
at Neon:

```bash
cd laliga-backend
npm install
```

Create a file called `.env` in that folder containing:

```
DATABASE_URL=<paste the pooled Neon connection string>
DB_SYNCHRONIZE=true
SEED_OWNER_EMAIL=karim@inspirat.us
SEED_OWNER_NAME=Karim Issa
SEED_OWNER_PASSWORD=<choose a strong password>
```

Then:

```bash
npm run db:setup
```

You should see the tables being created, then `permissions: 92`, your two
super-admin accounts, the 21 teams and 7 coaches, and the one test family. **Set `DB_SYNCHRONIZE=false` in that
file afterwards** — the schema now exists and shouldn't be auto-altered again.

---

## Step 3 — Put the code on GitHub (3 min)

```bash
cd laliga-backend
git init
git add .
git commit -m "LaLiga Academy operations backend"
```

Create an empty repository on GitHub (**private**), then follow the two commands
GitHub shows you — they look like:

```bash
git remote add origin https://github.com/<you>/laliga-backend.git
git branch -M main
git push -u origin main
```

`.gitignore` already excludes `.env` and `node_modules`, so your password and
connection string are not pushed.

---

## Step 4 — Deploy (3 min)

1. Go to [vercel.com/new](https://vercel.com/new) and **Import** that repository.
2. Leave the framework preset as-is — `vercel.json` already tells Vercel what to do.
3. Before clicking Deploy, open **Environment Variables** and add:

| Name | Value |
|---|---|
| `DATABASE_URL` | the pooled Neon connection string |
| `JWT_ACCESS_SECRET` | any long random string |
| `JWT_REFRESH_SECRET` | a *different* long random string |
| `NODE_ENV` | `production` |

   For the two secrets, any long random text works — e.g. run
   `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
   twice and paste the results.

4. Click **Deploy**.

When it finishes you get your URL. Open it — that's the admin UI.

---

## Signing in

| | |
|---|---|
| **Email** | `karim@inspirat.us` |
| **Password** | whatever you set as `SEED_OWNER_PASSWORD` in Step 2 |

That account is **Super Admin** — full access to all 14 modules.

Also seeded, for testing how permissions restrict the system:

| Role | Email | Password |
|---|---|---|
| Super Admin (generic) | `admin@laligaacademy.local` | `Admin@12345` |
| Coach | `sergio@laligaacademy.local` | `Coach@12345` |

Sign in as the coach and the navigation drops from 14 modules to 6 — Finance,
Guardians, Leads, Communications and the Activity Log all disappear, and the API
returns 403 for them.

The API explorer is at `https://<your-url>/api/docs`.

**Change these passwords** once you've finished testing — Settings → Staff Users.

---

## Things worth knowing

**Use the pooled connection string.** Each serverless function holds its own
database connections. With the direct (non-pooled) string you'll hit Neon's
connection limit as soon as more than a couple of people use it. The app already
caps its pool at 2 connections per instance when it detects Vercel, but the
pooled endpoint is what makes that safe.

**First request after idle is slow.** Free-tier Vercel functions sleep, and Neon
pauses the database after inactivity. The first load can take 5–10 seconds; after
that it's fast. This is a free-tier characteristic, not the app.

**Automations stay off.** The scheduler is disabled unless `AUTOMATIONS_ENABLED=true`,
so nothing emails a parent while you're testing. Vercel's serverless model doesn't
run cron inside the app anyway — when we go live we'll use Vercel Cron to call the
automation endpoints on a schedule.

**Schema changes.** `DB_SYNCHRONIZE` is forced off in serverless. If we change the
data model later, you re-run the schema step from your machine, then redeploy.

**This is for testing, not yet production.** Before real parent data goes in:
rotate the secrets, turn on 2FA for staff, add rate limiting on the login
endpoint, and switch from auto-sync to proper migrations. These are listed in
`PROGRESS.md` under production hardening.

---

## If the deploy fails

**Build error mentioning a missing module** — make sure you committed
`package.json` *and* `package-lock.json`.

**`500` on every page, "database" in the Vercel logs** — `DATABASE_URL` is wrong
or isn't set. Check Vercel → Settings → Environment Variables, then redeploy.

**Login returns 401 with the right password** — Step 2 didn't run against the
same database Vercel is using. Confirm both use the identical connection string.

**"too many connections"** — you used the direct Neon string instead of the
pooled one. Swap it in Vercel's environment variables and redeploy.

**A page loads but data doesn't** — open the browser console (F12). A 401 means
the token expired; sign in again.

Send me the error text from Vercel's deployment log and I'll work through it with you.
