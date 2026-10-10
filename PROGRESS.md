# Development Checklist

Living status of the backend build. Updated each phase.

## ✅ Completed — Phase 1: Foundation, Auth, RBAC, People, Dashboard

- [x] **Project architecture** — NestJS modular app, config, Swagger, Helmet, global error filter, URI versioning (`/api/v1`)
- [x] **Database schema** — full normalized model (25+ tables) as TypeORM entities; history-preserving (enrolments, ledger, evaluations, audit)
- [x] **Reference codes** — gap-free PR-/PL-/TR-/LA- via Postgres sequences
- [x] **Authentication** — JWT access + rotating refresh, bcrypt, login/refresh/logout/me, 2FA fields reserved
- [x] **RBAC** — 92 permissions (`module.action`), 7 system roles, custom roles, global permission guard
- [x] **Audit log** — immutable, `@Audit` interceptor, queryable; sensitive actions covered
- [x] **People module** — Guardians (auto-wallet, siblings) + Players (age-group auto-derivation, status, comments, enrolment history)
- [x] **Dashboard** — KPIs, pending actions, recent activity (role-aware ready)
- [x] **Staff users & roles management** — CRUD + role assignment + custom-role builder
- [x] **Seed** — permissions, roles, super admins, reference data, and the academy as it runs in 2026/27 (21 teams at Active Al Maryah, 7 coaches without logins, one test family). Volume demo data now lives only in `test/fixtures` for the e2e suite.
- [x] **Tests** — 5 unit + 11 e2e (auth, RBAC enforcement, registration workflow, validation, audit) — all green
- [x] **Docs** — README (run/test), ERD reference, this checklist, Swagger

## ✅ Completed — Phase 2: Registration & Trials, Teams & Coaches, Structure

- [x] **Structure config** — Seasons (single-active), Terms (with Term/Camp/Event/League type), Locations & Venues, Age Groups — full CRUD
- [x] **Teams** — real entities: capacity, age group, season, head coach, location; roster view with capacity usage; soft-deactivate
- [x] **Coaches** — coach profiles attached to staff users, certification
- [x] **Player transfers** — move between teams with capacity enforcement; **writes enrolment history** (old → TRANSFERRED, new → ACTIVE), never destroys prior data
- [x] **Leads / trials pipeline** — merged (legacy Popup Signups + Enquiries → one pipeline), TR- references, status transitions, assignment, **funnel + conversion rate**
- [x] **Lead → player conversion** — creates/links guardian + player, marks lead REGISTERED, one-way guard against double-convert
- [x] **One-flow registration** — `POST /register`: identify/create guardian → create player (age auto-derived) → optional enrol, in a single call
- [x] **Enrolment & renewals** — enrol into term/team with **auto-waitlist when full**; renew into a new term; duplicate-enrolment guard
- [x] **Tests** — +7 e2e (registration, capacity/waitlist, lead pipeline & convert, transfer history) → **23 tests total, all green**; 69 routes mapped


## ✅ Completed — Phase 3: Scheduling & Attendance

- [x] **Calendar** — dated sessions (training / match / trial / camp / event) with team, venue, coach, term
- [x] **Conflict detection** — venue, coach and team double-bookings rejected (`ScheduleConflict`), with an explicit `force` override
- [x] **Bulk generation** — generate a whole term's recurring sessions from weekdays + times, skipping clashes
- [x] **Digital attendance register** — full roster per session, tap-to-mark, bulk submit (replaces Excel import/export)
- [x] **Attendance intelligence** — per-player rate, team summaries, low-attendance alerts, unsubmitted registers

## ✅ Completed — Phase 4: Finance

- [x] **Fees catalog** — price per term × age group × location, VAT rate per row
- [x] **Discount rule engine** — SIBLING / RETURNING / EARLY_BIRD evaluate themselves and explain *why* they applied; configurable via `params` without code changes
- [x] **Invoice generation** — from enrolments, with line items, auto-discounts and correct UAE VAT
- [x] **Payments ledger** — status is *computed* from payments (never hand-set); part-payment, refund, write-off, sponsorship
- [x] **Settlement tolerance** — sub-cent rounding residue no longer strands invoices in PART_PAID
- [x] **Wallet** — overpayments auto-credit; pay-from-wallet; refund-to-wallet
- [x] **Outstanding report** — accurate balances and overdue totals (fixes the legacy "Not Paid 0" bug)
- [x] **Gateway boundary** — `PaymentGatewayDriver` interface + webhook auto-reconciliation, mock driver until credentials exist

## ✅ Completed — Phase 5: Communications & Automations

- [x] **Channels** — email / SMS / WhatsApp / push behind one driver interface (mock drivers pending credentials)
- [x] **Templates** — `{{variable}}` rendering, per-channel
- [x] **Targeted audiences** — by team, age group, player status, outstanding balance, or everyone; preview recipients before sending
- [x] **Communication history** — every send recorded against the guardian
- [x] **Automations** — payment reminders, trial confirmations, renewal nudges, registration welcome; all support `dryRun` preview

## ✅ Completed — Phase 6: Analytics & Player Development

- [x] **Analytics** — enrolment, revenue (billed/collected/outstanding + monthly trend), capacity, coach workload, venue utilisation, attendance, trial conversion by source
- [x] **Player Passport** — surfaced Evaluations: development trend across the four pillars, attendance, enrolment history, document completeness
- [x] **Documents** — typed, with expiry tracking and an expiring-soon alert
- [x] **Dashboard rebuilt** — real KPIs + an actionable work queue where every tile links to where to act

## ✅ Completed — Admin UI

- [x] **Full admin interface** served by the backend at `/` — dashboard, players (with passport drawer), guardians + wallets, leads pipeline with funnel, teams + rosters, schedule, attendance, invoices (with payment recording), discount rule tester, communications + automation runner, development, activity log
- [x] **Permission-aware** — navigation and actions reflect the signed-in role (a Coach sees 6 modules, a Super Admin sees 13)
- [x] **Strict CSP** — `script-src 'self'` with event delegation (no inline handlers); fixes the audit's missing-security-headers finding
- [x] **Light + dark themes**, responsive, keyboard-accessible

## 📊 Verified

- **61 automated tests pass** (24 unit + 37 e2e) across auth, RBAC, registration, capacity/waitlist, transfers, scheduling conflicts, attendance, finance ledger, automations, analytics and the passport
- **API routes**: see `/api/docs`. Test suite: 53 unit + 60 e2e. Volume test data (33 players, 27 invoices, 69 sessions, 48 evaluations) is loaded into the TEST database only, by `npm run test:fixtures`.

## ✅ Completed — Automation scheduler

- [x] **Cron scheduler** for all four automations, evaluated in **Asia/Dubai**
- [x] **Disabled by default** — nothing emails parents until deliberately enabled (`AUTOMATIONS_ENABLED=true`, or per-job via the API)
- [x] Enable/disable, **change the cron at runtime**, and "run now" — each run recorded to the audit log with candidates/sent
- [x] Job status endpoint exposes cron, enabled state, last run, last result, last error and next run time

## ✅ Completed — Legacy migration toolkit

- [x] **`npm run migrate -- --dir ./legacy-export`** — dry run by default, writes nothing, produces a full report
- [x] **Cleans as it moves**, targeting the exact problems the audit found:
  - age categories normalised (`U15` / `U-15` / `Girl U-15` / `HPC U19` → one code, gender and level extracted)
  - duplicate `Transfer` payment method collapsed; unrecognised methods reported
  - the overloaded "term" split into **Term / Camp / Event / League**
  - seven legacy payment statuses folded onto the new lifecycle, then **recomputed from the ledger**
  - UAE mobile formats (`05x`, `00971`, `+971`) and `dd/mm/yyyy` dates canonicalised
- [x] **Duplicate families merged** on email → mobile → name; existing records reused, never duplicated
- [x] **Reconciliation** — flags invoices whose legacy status disagrees with the money, and **age labels that contradict the date of birth** (`--derive-age` to trust the DOB)
- [x] Orphaned rows (players/invoices pointing at missing parents) reported and excluded; `--force` imports the valid remainder
- [x] Machine-readable `migration-report.json` written next to the source files
- [x] **19 unit tests** covering every normaliser

## 🔜 Remaining

- [ ] Parent-facing portal (schema + API ready; UI not built)
- [ ] File upload endpoint wired to object storage (metadata layer done)

## 🚧 Blocked / requires configuration (not blocking the build)

- [ ] **Payment gateway** — needs a provider + API credentials (Stripe/Telr/Network Intl.). Structure & `payments.gatewayId` ready; wire in Phase 4.
- [ ] **Email / SMS / WhatsApp** — needs provider credentials (e.g. SES/SendGrid, Twilio/WhatsApp Business). Schema (`communications`, templates) ready.
- [ ] **Object storage** — needs S3-compatible bucket + keys for the Documents module.

## ❓ Requires your decision (later, not now)

- [ ] Payment gateway provider (UAE options: Telr, Network International, Stripe, PayTabs)
- [ ] Messaging providers (esp. WhatsApp Business API vendor)
- [ ] Whether the parent-facing portal is part of this backend's scope now or a later track
- [ ] Data migration window from the legacy system (see the blueprint's Migration Strategy)

## ⚙️ Production hardening (before go-live)

- [ ] Switch `DB_SYNCHRONIZE=false` and adopt generated TypeORM migrations
- [ ] Rotate all secrets; enable staff 2FA
- [ ] Add rate limiting on auth endpoints; structured request logging + error monitoring (Sentry)
- [ ] Automated DB backups + tested restore

## ✅ Completed — Dashboard (stage 1) and 2026/27 pricing — Oct 2026

- [x] **Dashboard** rebuilt to the approved mock-up: location and season filters, wallet balance; registered players with weekly trend and sparkline; coaches (full/part-time, featured); attendance donut with per-category bars; academy schedule timeline (terms, pitch bookings, matches/events, breaks; add/remove entries); total revenue stacked by stream (collected + pending, monthly or by term); kit sales by piece; payment status donut, unpaid players/invoices, total unpaid and % of revenue, aging 0–30 / 31–60 / 60+ days. One endpoint: `GET /api/v1/dashboard/overview?seasonId&locationId`. Money is hidden from roles without `invoice.view`.
- [x] **Price list 2026/27** (VAT inclusive) — 1, 2 and 3 sessions a week × category × Term 1, Term 2, Term 3, Terms 1 & 2, Terms 2 & 3, Full season. Editable on *Price list & products*. VAT is split as the remainder so every invoice totals the advertised price exactly.
- [x] **Register a child / Add term** — term options, sessions a week (Development 1–2, Advanced 2–3, HPC 3), U6/U8 1 h vs 1½ h shown, optional Development kit (350), Advanced kit (550, training + home kit), Man City League (600). A multi-term purchase is one enrolment per term and one invoice line. Sibling discount applies to the term fee only.
- [x] **User term** — add kits, a league, a tournament or a custom charge to an already-registered child on its own invoice (`POST /players/:id/items`).
- [x] **Revenue streams** on every invoice line (LALIGA Academy, Kits, Man City League, Abu Dhabi Cup, Ramadan Cup, Salou Cup, Other) and kit pieces recorded at sale.
- [x] **Season calendar** seeded from the academy calendar (breaks, Eids, Ramadan, trials week) + pitch bookings per term.
- [x] Fixes: a child already on a team is no longer counted against its capacity when renewing; sibling credits are made once per invoice (not once per term of a package) and only on the term-fee line.
- [x] **Tests** — 58 unit + 80 e2e, all green.

## ✅ Completed — Payment Report, invoices, parent sign-in, inventory — Oct 2026

- [x] **Payment Report** (Finance → Payment Report): one row per payment — SL, Date (DD/MM/YYYY), Payment Method, Merchant, Merchant ID, Payment Reference, Location, Player No. (links to the player), Invoice# (opens the invoice), Received, Wallet, Balance. Drag-to-resize columns (double-click to fit), filters, totals, Export Excel. **Received = direct money only** (cash, credit card, payment link, bank transfer, cheque); wallet use is its own column; write-offs are never received. The dashboard's "collected" follows the same rule.
- [x] **Merchants** (Network 13435, Payfort 90571) chosen when recording a payment; name and MID copied onto the payment.
- [x] **Invoices screen** rebuilt on the legacy screen's search (keyword, LA / PL / PR numbers, payment status, method, additional, custom, category, location, term, invoice dates, payment dates, amounts) with the legacy columns plus received / wallet split, emailed date, totals bar, all-columns VAT view, resizable columns, Export Excel; invoice drawer with PDF preview / download / email, payment form with merchant + reference + date, write-off.
- [x] **Designed tax invoice PDF** (matching INVAB-19328960): header, bill-to, programme details (terms, category, team, weeks, sessions, classes), extras, discounts, bank details, totals with paid / balance due, terms page, company footer. Company, bank and T&Cs editable under Settings.
- [x] **Emails**: welcome with a temporary password when a child is registered; invoice with the PDF attached when issued; resend from the invoice / email log. SMTP via `laliga-mail.env`; recorded but not sent until connected. Temporary passwords are never stored readable.
- [x] **Parent sign-in** at `/parent/`: temporary password must be changed at first sign-in, expires after 7 days, 5-attempt lockout, own signing key (parent tokens never open staff routes), sees children, terms and invoices with PDF download. Staff "Send sign-in details" issues a fresh temporary password.
- [x] **Inventory** (Operations → Inventory): unified number per item and size (SKU, e.g. LL-004-M), LaLiga / ADSC kept apart, stock in / stock out (who to, why, reference) / stock take, several items per entry, full movement history with balance after, low / out-of-stock, summary by item, exports. The AUH store file (110 SKUs, 1,600 units) is loaded as opening stock.
- [x] **Tests** — 58 unit + 94 e2e, all green.

## ✅ Completed — Trials & Leads and season attendance — Oct 2026

- [x] **Trials & Leads** rebuilt as the sales desk. Every enquiry is one lead worked through New → Contacted → Trial booked → Trial done → Awaiting decision → Joined, or Not joining (a reason is required).
  - Counters: follow-ups due today, new and not contacted yet, trials in the next 7 days, and how many of the last 30 days' enquiries joined.
  - Stage tabs with counts. The legacy filters are kept: keyword (name, mobile, email, TR number), source, team member, category, received dates, trial dates and comments yes/no. Columns are resizable and the list exports to Excel.
  - The lead drawer: call / WhatsApp buttons and a comments timeline. One click logs a call (answered, no answer, busy, wrong number); the first contact moves a New lead to Contacted.
  - Next follow-up has quick picks (tomorrow, 3 days, next week). A no-answer call sets tomorrow automatically.
  - Ready-made messages (first reply, tried to call, trial confirmation, reminder, after the trial) fill in the parent's and child's names and the trial day, time, team and venue. They are sent through WhatsApp (opens with the text ready, logged as a contact) or by email. Templates are editable.
  - Repeat enquiries (same mobile or email) and families already registered are flagged. You can assign a lead to a team member and edit its details.
- [x] **Trials booked into real training sessions.** You pick from the next three weeks' sessions of the teams that take the child's category. The child appears on that session's register so the coach can mark "came / didn't come". Coach feedback and the recommended level are saved on the lead.
- [x] **Convert to registration.** "Register" opens Register a child with the details filled in from the lead: parent (matched to an existing family by mobile), child, date of birth, category, recommended level and trial team.
  - Confirming marks the lead **Joined** and links it to the new player.
  - For enquiries about two children, "Register a sibling" stays linked to the same enquiry.
- [x] **Website intake:** `POST /api/v1/public/trial-requests` takes the pop-up's fields with email optional and DOB as DD/MM/YYYY. It has a honeypot and a rate limit. See RUNNING.md.
- [x] **Season sessions:** every team's training sessions from 31 Aug 2026 to 11 Jun 2027 (1,701 for the 21 teams), from each team's days and times.
  - Sessions follow the term dates. There is no training on National Day, winter break, Eid al-Fitr, spring break, Eid al-Adha or summer break. Mid-term breaks and Ramadan keep training.
  - Re-running adds only what's missing. "Re-plan future sessions" follows a change of days or times and keeps any session that already has a register.
  - A coach change moves the team's upcoming sessions to the new coach.
- [x] **Attendance:**
  - Registers you can mark: P / L / A / E per child, "Everyone present", save; trial children listed below. A session can be called off with a reason (it doesn't count against anyone) and reinstated. Future sessions can't be marked.
  - **Team registers** grid: one month per screen, children × sessions. Click a square to change it, click a date for the full register. Shows month and season rates, flags registers not yet complete and shades cancelled days.
  - The Attendance page lists the day's registers (previous / next day).
- [x] **Tests** — 63 unit + 108 e2e, all green.

### Still open from this round
- [ ] Import the 3,681 legacy pop-up sign-ups and enquiries (needs the legacy "Export to Excel" file).
- [ ] reCAPTCHA check on the public form (needs the site's secret key).
- [ ] Point the website pop-up at the new endpoint once the backend is hosted.

## ✅ Completed — Guardians, trials sheet, coach access, packages — Oct 2026

- [x] **Guardians screen**
  - Search bar: parent or child name, main or additional email, mobile, PR number. Filters for children, emirate, parent sign-in and additional email.
  - One row per family showing the children (linked), wallet and sign-in state.
  - **Edit** for the parent's details.
  - **Additional email** for another family member, with whose it is. Invoice emails are copied to it; sign-in details stay with the main email.
- [x] **Trials & Leads — lead window**
  - Comments as written, each with its date and who wrote it. The system timeline is gone.
  - **Log contact**: pick spoke to them / no answer / busy / WhatsApp sent / email sent / wrong number (animated selection), add a standard quick note or a comment, or none, then **Save**. A no-answer or busy call sets tomorrow's follow-up.
- [x] **Trials sheet** (from the academy's live sheet)
  - Trials by date and Development / Advanced type. Each row shows the parent's confirmation, the coach (defaults to the team's coach), parent contact with WhatsApp, attended (Yes / No / Another trial), evaluation (Development / Advanced / HPC / Advanced invitation / Not ready), follow-up by, follow-up outcome from the standard list, and the last comment.
  - Saves as you change it. Week tabs and filters, including "needs the coach's evaluation" and "needs a follow-up", plus counters and Export Excel.
  - Marking a child as came moves the lead to Trial done and sets a follow-up for the next day.
- [x] **Coach evaluations**
  - Where they should play, 1–5 ratings (technical, tactical, physical, attitude), strengths, what to work on, recommended team, and "see them again".
  - Saving records that the child came, sets the level and shows on the lead and the sheet.
- [x] **Coach role**: players, trials & leads (view), attendance, schedule and teams, and writing evaluations.
  - No fees, invoices, balances, wallets or payment status anywhere; the API strips them too.
  - Coach logins are switched on from Settings → Staff accounts.
- [x] **Staff accounts** (Settings)
  - Role, active, and set a password for each person; add new staff.
  - Everyone can change their own password ("Password" under their name).
  - **michel@inspirat.us** added as super admin. Karim sets his first password.
  - The lead "Team member" list is Karim and Michel; the built-in admin account is no longer offered.
- [x] **Teams**
  - New **U10 Development 2** (Tue & Thu 7:30–9:00 pm; the first is now U10 Development 1).
  - New **U8 Advanced** (Tue & Thu 6:00–7:30 pm).
  - Capacities from the Oct 2026 list: 12 for U6–U11, 14 for U12–U14, 16 for U16, 20 for U16/18 Development and 22 for U18 Advanced. They are applied once; later edits in the app are kept.
  - New teams get their sessions from today.
- [x] **The package bought shows everywhere.** A Full season (or Terms 1 & 2…) is shown as such on the player page (with the term in progress), in the players list and on the parent portal. Previously it showed whichever term sorted first, e.g. "Term 3".
- [x] **No term option is preselected.** The desk always chooses one; the server refuses a purchase without one.
- [x] **Manual discounts as percentages**: Early bird 10%, 10%, 15%, 25%, 50%, Sponsored 100%.
  - They come off the season package (training fee) only and replace the sibling discount.
  - Kits, the league and tournaments are always charged, so a sponsored child still pays for kit.
  - Shown in the price quote before confirming.
- [x] **Tests** — 63 unit + 120 e2e, all green.

## ✅ Completed — Siblings on one invoice, and the Development / Advanced term reports — Oct 2026

- [x] **Siblings registered together.** In Register a child, "+ Add a brother or sister" keeps the same parent and starts the next child.
  - Each child chooses their own team, term option and extras.
  - A **family table** shows each child's place on the sibling ladder (1st full price, 2nd 15% …), the discount, extras and the family total, before anything is saved.
  - Confirm creates the parent and every child, then **one family invoice** with a line per child. The sibling discount is applied across the family; a manual discount replaces it for that child only. The parent gets one welcome email naming all the children.
  - API: `POST /registration/family-quote`, `POST /guardians/:id/terms`.
- [x] **Term reports** (Player development), modelled on the old admin.
  - **Development report** for Development squads, built on the old evaluation form:
    - Technical (7 items), Tactical (3), Physical & psychomotor (7), Cognitive (4) and Attitude (4), each scored 1–5.
    - Two positions on a pitch, and the coach's observations.
    - The PDF adds area averages, attendance for the term and the change since the last report.
  - **Advanced report** for Advanced and HPC squads. The old admin only took an uploaded PDF for these; it is now written in the app:
    - Photo, shirt number, position and a general comment.
    - Technical–tactical and Conditional areas that depend on the position: Defender, Midfielder and Striker items come from the academy's own reports; the Goalkeeper items are a proposal.
    - A Psychological area the same for everyone.
    - Every item is scored 0–5, with the coach's comment beside each area.
  - **Worklist** per term: every enrolled child by team, the report their squad needs, and whether it is not started, a draft, final or sent. It also shows the overall score and who wrote it.
  - **Lifecycle**: coaches write with autosave, then **Make final** checks that every item is scored and the comments are written. Super admins can reopen a report and **Send to parent**, which emails the PDF (copied to the additional email) and adds it to the parent's sign-in page. There is also "Send all final reports in this list".
  - Shown on the player page (Term reports). The older four-pillar scorecards are kept.
- [x] **Tests** — 63 unit + 128 e2e, all green.


## ✅ Completed — Start date with proration, any-percentage discount, adjusting unpaid invoices — Oct 2026

- [x] **Start date.** Register a child, Add term and each brother or sister on a family registration have a **Start date**.
  - Choosing an option that is already under way fills in today; an option that hasn't started stays empty (full price). "Charge from the first day" clears it.
  - The training fee is **prorated by sessions left**: price × sessions from the start date ÷ sessions in the option, counted from the team's season plan (holidays and closures already left out). Without a team, the team's training days on the calendar are counted. Kits, the league and tournaments are never prorated.
  - The quote, the invoice line ("from 12/10/2026 (17 of 29 sessions)") and the invoice PDF (Start Date, "No of Sessions 21 of 30 (prorated …)") show it. Stored on `enrolments.startDate`.
- [x] **Manual discount of any percentage** (e.g. 12.5%), next to the preset buttons. It still comes off the training fee only.
  - **Extra discount on the first child (Karim, Oct 2026):** on the full-price child it is an extra discount; on a brother or sister it *replaces* the sibling discount (one discount per sibling).
- [x] **Family table like the old "Generate Invoice" screen**: start date, terms, amount, special (sibling) discount, discount, net amount, per child. A child already added can be edited there (start date, discount) before confirming.
- [x] **Invoice drawer → Training fees.** Each child's start date, amount, special discount, discount and net. **Adjust** changes a child's start date or manual discount and re-prices the training lines **on the same invoice number**; kits and league lines are kept. Only before any payment, write-off or sponsorship.
  - API: `GET /invoices/:id/training`, `POST /invoices/:id/adjust`. Quotes accept `startDate` and `manualPercent`; term/family purchases accept `startDate` and `manualDiscount.percent`.
- [x] **Tests** — 66 unit + 133 e2e, all green on a fresh database (two older tests no longer depend on demo data).

## ✅ Completed — Instalments, payment links and the invoice Action column — Oct 2026

- [x] **Instalments (manual, set by the academy).** 2 to 5 instalments; staff type each one's **percentage** of the invoice total and its **due date**. "Split evenly" fills the percentages; they must add up to 100%.
  - Set when registering (one child or a family invoice), in Add term, or later from the invoice drawer ("Pay in instalments…", "Change plan", "Remove plan").
  - Staff only: the parent doesn't see the schedule (Karim, Oct 2026); they receive a payment link per instalment.
  - Each instalment shows its amount, what it received, what's left and a status: Not paid, Ready to pay, Due today, Part paid, Overdue, Paid, Waived.
  - Payments taken "for instalment 2" go to instalment 2 first; other payments fill the instalments in order. Refunds and general write-offs come off the last instalments.
  - A plan can be changed any time before the invoice is settled, but an instalment can never drop below what it has received. **Waive** forgives what's left of an instalment (written off on the invoice, with the reason); **Undo waiver** brings it back.
  - Re-pricing an unpaid invoice (start date / discount) keeps the percentages and moves the amounts. The invoice's due date follows the first instalment. The Invoices register counts instalments from the plan.
  - API: `GET/PUT /invoices/:id/instalments`, `POST /invoices/:id/instalments/:seq/ready|waive|unwaive`; `instalments: [{percent, dueDate}]` on `POST /players/:id/terms` and `POST /guardians/:id/terms`; `instalmentSeq` on recorded payments.
- [x] **Payment links (made by the system; the card gateway comes later).** `POST /invoices/:id/payment-link` (copy) and `/payment-link/send` (email, copied to the additional email, in the Email log as "payment_link"). On a plan the link is for the "ready to pay" instalment, else the next unpaid one; `balance: true` asks for the whole balance.
  - The parent opens `/pay/#<token>` (no sign-in; the token is in the fragment so it never reaches logs). It shows the academy, invoice number, first names, the amount and — until Payfort/Network is connected — the bank-transfer details. Once a gateway is set up, "Pay by card" opens its checkout and the webhook records the payment against the instalment.
  - A link is reused while the amount is unchanged and replaced when it changes; valid 30 days. The email reads as a reminder once the instalment or invoice is past due.
  - **Security:** the payment webhook no longer accepts anything while the mock gateway is in use (it could have marked any invoice paid).
- [x] **Invoice Action column** (Invoices list): Open, PDF and an **Actions ▾** menu with Record a payment, Instalments, Copy payment link, Send payment link, Preview/Download PDF, Resend (or Email/Issue) invoice, and Write off, refund or cancel.
  - Left out on purpose: Delete invoice (financial records are cancelled, not deleted), Edit payment method (each payment keeps its own method), and a separate Send payment reminder (the payment-link email is the reminder once it's due).
  - The drawer gained Copy/Send payment link, **Partial refund** (pay back or credit the wallet) and **Cancel invoice** (only before any payment, with a confirm step).
- [x] **Tests** — 71 unit + 141 e2e, all green on a fresh database.

## ✅ Completed — Inventory reset, migrations and live-mode groundwork (build 14) — Oct 2026

- [x] **Inventory starts clean.** A fresh install has one practice item, `LL-TEST-M` (10 pieces); the old AUH store list is no longer loaded. A super admin's **Start again…** on Inventory removes every item and movement after typing `CLEAR INVENTORY` and leaves the practice item (`POST /inventory/reset`, audited).
- [x] **Migrations instead of auto-sync for the live system:** baseline migration in `src/database/migrations/`, `npm run db:migrate`, `db:migration:generate`, `db:migration:check`.
- [x] **Live mode** (`LALIGA_LIVE=true`): no generic admin, no Sergio test login, no test family; the first super-admin password must come from `SEED_OWNER_PASSWORD` (12+); the app refuses to start without two strong JWT secrets.
- [x] **Vercel:** `api/index.js` hands over to `src/serverless.ts` (compiled by `nest build`); `vercel.json` serves `public/` statically, sends `/api/*` to the function, adds security headers; `npm run vercel-build` = build → migrate → setup.
- [x] **CLAUDE.md** hand-over for Claude Code.
- [x] **Tests** — 71 unit + 141 e2e green on a migration-built database.

## ✅ Completed — Hand-over to Claude Code and live-password check — 8 Oct 2026

- [x] **Hand-over checked.** Build 14 moved to `C:\Users\karim\Projects\laliga-backend` and put under git (first commit = build 14 as delivered; `.env` and `laliga-mail.env` ignored). Re-verified on a fresh PostgreSQL 16: `npm ci`, build, migrate, both seeds, `db:migration:check` clean, 71 unit + 141 e2e green.
- [x] **Live mode refuses the demo passwords.** `LaLiga@2026!` (exactly 12 characters) passed the old length-only rule, and it is written in `docker-compose.yml` and `.env.example`, which go to GitHub. With `LALIGA_LIVE=true` the seed now refuses `SEED_OWNER_PASSWORD` if it is under 12 characters or one of the repo's demo passwords (`src/config/live-passwords.ts`). The same rule now applies to `SEED_ADMIN_PASSWORD` if someone sets `SEED_ADMIN_EMAIL` on the live system (before, it fell back to `Admin@12345`).
- [x] **Tests** — 74 unit (3 new) green; the live seed was checked against a scratch database: demo owner password refused, admin email without a password refused, a proper password accepted.
- [x] **Vercel can't run outside live mode.** Every deploy runs the seeds; without `LALIGA_LIVE=true` (e.g. a preview deploy, or a deploy between connecting Neon and typing the variables) they would have created the demo logins and the test family on an internet-facing database. On Vercel (`VERCEL=1`) both seeds and the app now stop with a clear message unless live mode is on (`src/config/vercel-guard.ts`).
- [x] **Node 24** pinned (`engines.node: 24.x`, which Vercel follows) — Node 20 reached end of life in April 2026. **Functions run in Frankfurt** (`regions: ["fra1"]` in `vercel.json`), next to the Neon database, instead of Vercel's default Washington DC.
- [x] **Tests** — 77 unit + 141 e2e green on Node 24 and a fresh PostgreSQL 16 (migrate, both seeds, migration check clean).

## ✅ Completed — Stage 1 live on Vercel + Neon — 9 Oct 2026

- [x] **Live:** GitHub `Karimissa13/laliga-backend` (private) → Vercel project `laliga-backend` (Hobby, functions in Frankfurt) → Neon `laliga-academy` (Frankfurt, **PostgreSQL 18** — the full suite also passes on 18), connected with the Neon integration (it manages `DATABASE_URL` / `DATABASE_URL_UNPOOLED` for Production). First deploy: baseline migration, live seed — Karim's super-admin, Michel (no usable password yet), coaches disabled, no test family, no generic admin.
- [x] **Fixed on the way:** `vercel.json` header pattern Vercel rejected; `npm ci --include=dev` (with `NODE_ENV=production` the build tools were skipped); the rewrite's `?path=` copy that every list screen would have refused (400); live CORS answered any website (now its own site until `CORS_ORIGINS`); the settings check names paste mistakes (spaces, quotes, backticks, `KEY=`) and which JWT rule fails, by length only; a one-time **owner password reset** (`OWNER_PASSWORD_RESET`, applied at deploy, audited, signs the owner out everywhere).
- [x] Karim signed in; `SEED_OWNER_PASSWORD` and the reset setting were deleted from Vercel afterwards. No passwords remain in the hosting settings.
- [ ] **Still to do for Stage 1:** custom domain `app.laligaacademyabudhabi.com` (CNAME at GoDaddy → `1c41524825f0306e.vercel-dns-017.com`; domain already attached in Vercel) — Karim asked to do it once everything is tested on Vercel. `DEPLOY-VERCEL.md` rewrite.
- **Hosting plans:** Neon Free + Vercel Hobby for now (Karim, 9 Oct). Move to Neon paid + Vercel Pro **before the Term 2 import** (Hobby is non-commercial only; Hobby cron runs at most daily).

## ✅ Completed — Post-move check, invoice enhancements, tax credit notes — 10 Oct 2026

- [x] **Post-move check:** all 21 admin pages clicked through on a migration-built copy with test data. Two bugs from the Cowork builds fixed: **Player development** failed (400) after changing a filter or reopening the page; the **admin session ended after 15 minutes** ("Invalid or expired token") because the refresh token was never used — it now renews silently, survives a reload, PDF/CSV downloads renew too, and sign-out revokes the session on the server.
- [x] **Already in place from builds 10–14** (checked against Karim's spec and mock-up): the dashboard (filters, wallet, players + sparkline, coaches full/part-time, attendance by age group — kept per age group, Karim 10 Oct — term timeline, revenue Sep–Jul by six streams, kits by type, payment status + unpaid + aging); the Payment Report (Player No., Wallet column, drag-to-resize, Received = direct money only); the welcome email with login and forced password change; the invoice email with the PDF; inventory with unified item numbers. The live dashboard is empty only because the live database has no families yet.
- [x] **Old invoice section reviewed (read-only, Karim's Chrome):** 17 filters, 27 columns, 11 row actions. The new screen already had every filter, every column (merged in three places) and every action except Delete (cancel instead — by rule).
- [x] **Invoices (Karim, 10 Oct):** sortable columns across all pages (whitelisted sort keys); quick filters (Overdue, Unpaid this term, Due in the next 7 days, Paid this week, Has instalments); **bulk actions** — tick invoices or select all in the search, then email the invoices or send payment links (batches of 25 with progress and a per-invoice result list; each logged in the Email log and activity log) or export the selection; the all-columns view now matches the old screen (Players Count, separate refund / write-off reasons, Total / Paid / Pending instalments).
- [x] **Tax credit notes (Karim, 10 Oct: build now):** `CN-000001…`, own sequence, PDF in the invoice layout (credited amount, VAT reversed, against which tax invoice, why). Issued automatically for every **refund** and for **cancelling an issued invoice** (credits what hasn't been credited yet, so credits never exceed the invoice); for **write-offs and instalment waivers** a tick-box (on by default) — untick for a **bad debt**, which VAT treats as bad-debt relief rather than a credit note. A waiver with a credit note can't be undone. Credit notes are records: the database refuses UPDATE and DELETE (trigger, migration `CreditNotes1791610817302`). Drawer section with PDF, register API and CSV ("Credit notes (Excel)" on Invoices). **To confirm with the accountant:** credit-note wording and the write-off vs bad-debt rule.
- [x] **Write-offs are now checked:** only on an invoice that is still owed, and never more than what is owed (before, any amount was accepted).
- [x] **Invoice PDF uses the real logo** (red + white on-dark artwork from `LaLiga Abu Dhabi Logos.zip`, now `public/brand/logo-on-dark.png`).
- [x] **Tests** — 92 unit + 141 e2e green on Node 24 and a fresh PostgreSQL 18 (both migrations, seeds, migration check clean); credit-note paths and the invoice-list additions tested end to end on a local copy.
