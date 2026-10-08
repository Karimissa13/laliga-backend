import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { AppDataSource } from './data-source';
import {
  AcademyEvent, AcademyEventKind, AgeGroup, Coach, CommunicationChannel, CommunicationTemplate, Discount,
  DiscountKind, DiscountRule, Gender, Guardian, KitType, Location, Player, PriceListEntry, Product,
  RevenueStream, Role, Season, Squad, Team, TeamLevel, Term, TermPackage, User, Weekday,
  Merchant, PaymentMethod, InventoryItem, InventoryMovement, StockMovementType, InventoryProgramme,
  Session, SessionType,
} from './entities';
import { TEST_ITEM } from '../modules/inventory/practice-item';
import { teamLabel } from '../modules/teams/team-label';

dotenv.config();

/**
 * The academy as it actually runs in 2026/27 — confirmed by operations, Oct 2026.
 *
 *  - 21 teams at Abu Dhabi — Active Al Maryah, with levels and training slots
 *  - 7 coach profiles, no login credentials yet (credentials are deferred)
 *  - the 2026/27 price list (Academy Price List sheet, Oct 2026, VAT inclusive)
 *  - kits and the Man City league as optional extras
 *  - the season calendar (holidays, breaks, pitch bookings) for the dashboard
 *  - discount catalogue (sibling ladder automatic, the rest manual)
 *  - ONE test family, created through the real services
 *
 * Runs after seed.ts. Idempotent: everything is looked up before it is created,
 * so it is safe on every boot. It never deletes anything — to start clean, use
 * `npm run db:fresh` (development) or RESET-LALIGA.bat (Docker).
 */

const TT = [Weekday.TUE, Weekday.THU];
const MWF = [Weekday.MON, Weekday.WED, Weekday.FRI];
const EARLY = ['18:00', '19:30'] as const;
const LATE = ['19:30', '21:00'] as const;

type TeamDef = {
  ages: string[]; level: TeamLevel; squad?: Squad; n?: number;
  days: Weekday[]; slot: readonly [string, string];
  /** Places on the team (Oct 2026 list). */
  cap: number;
  /** The team's earlier name, so a renamed team is updated rather than duplicated. */
  was?: string;
};

const D = TeamLevel.DEVELOPMENT, A = TeamLevel.ADVANCED, H = TeamLevel.HPC;
const W = Squad.WHITE, B = Squad.BLUE;

export const ACADEMY_TEAMS: TeamDef[] = [
  // Tuesday & Thursday, 6:00–7:30 pm
  { ages: ['U6'], level: D, days: TT, slot: EARLY, cap: 12 },
  { ages: ['U8'], level: D, n: 1, days: TT, slot: EARLY, cap: 12 },
  { ages: ['U8'], level: D, n: 2, days: TT, slot: EARLY, cap: 12 },
  { ages: ['U8'], level: A, days: TT, slot: EARLY, cap: 12 },                       // new, Oct 2026
  { ages: ['U10'], level: D, n: 1, days: TT, slot: EARLY, cap: 12, was: 'U10 Development' },
  { ages: ['U9'], level: A, days: TT, slot: EARLY, cap: 12 },
  { ages: ['U12'], level: A, squad: W, days: TT, slot: EARLY, cap: 14 },
  // Tuesday & Thursday, 7:30–9:00 pm
  { ages: ['U13'], level: A, squad: W, days: TT, slot: LATE, cap: 14 },
  { ages: ['U10'], level: D, n: 2, days: TT, slot: LATE, cap: 12 },                 // new, Oct 2026
  { ages: ['U12'], level: D, days: TT, slot: LATE, cap: 14 },
  { ages: ['U13'], level: D, days: TT, slot: LATE, cap: 14 },
  { ages: ['U14'], level: A, squad: B, days: TT, slot: LATE, cap: 14 },
  { ages: ['U14'], level: D, days: TT, slot: LATE, cap: 14 },
  { ages: ['U16', 'U18'], level: D, days: TT, slot: LATE, cap: 20 },
  // Monday, Wednesday & Friday, 6:00–7:30 pm
  { ages: ['U12'], level: H, days: MWF, slot: EARLY, cap: 14 },
  { ages: ['U11'], level: A, days: MWF, slot: EARLY, cap: 12 },
  { ages: ['U13'], level: H, days: MWF, slot: EARLY, cap: 14 },
  { ages: ['U10'], level: A, days: MWF, slot: EARLY, cap: 12 },
  { ages: ['U16'], level: A, squad: W, days: MWF, slot: EARLY, cap: 16 },
  // Monday, Wednesday & Friday, 7:30–9:00 pm
  { ages: ['U16'], level: H, days: MWF, slot: LATE, cap: 16 },
  { ages: ['U14'], level: H, days: MWF, slot: LATE, cap: 14 },
  { ages: ['U18'], level: A, days: MWF, slot: LATE, cap: 22 },
  { ages: ['U14'], level: A, squad: W, days: MWF, slot: LATE, cap: 14 },
];

/** Bump when the capacities above change, so they are applied once over whatever was there. */
const TEAM_CAPS_VERSION = '2026-10-caps';

/** Coaches on staff (Oct 2026). No logins yet — credentials are deferred. */
const COACHES = ['Sergio', 'Pol', 'Guille', 'Ayoob', 'Cedric', 'Rodrigo', 'Samuel'];

/**
 * ACADEMY PRICE LIST 2026-2027 — all rates inclusive of VAT (sheet received Oct 2026).
 * Order of each price row: Term 1, Term 2, Term 3, Terms 1&2, Terms 2&3, Full season.
 *
 *  - 1 session a week: Development squads
 *  - 2 sessions a week: Development & Advanced squads
 *  - 3 sessions a week: Advanced & HPC squads
 *
 * The sheet lists U6, U8, U10, U12, U14, U16, U18 (and U9 for 3 a week). The
 * categories it does not print — U9/U11/U13 at 1–2 a week, U11/U13 at 3 a week —
 * take the price of the band they sit in, which is the same figure on every row
 * of that band.
 */
type Row = [number, number, number, number, number, number];
const PRICE_SHEET: Array<{ spw: number; codes: string[]; rate: number; prices: Row }> = [
  { spw: 1, codes: ['U6', 'U8'], rate: 171, prices: [2558, 1535, 1194, 3069, 2457, 4263] },
  { spw: 1, codes: ['U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U16', 'U18'], rate: 206, prices: [3086, 1851, 1440, 3703, 2964, 5143] },
  { spw: 1, codes: ['GIRLS'], rate: 133, prices: [1997, 1198, 932, 2396, 1919, 3328] },
  { spw: 2, codes: ['U6', 'U8'], rate: 136.4, prices: [4092, 2455, 1910, 4910, 3930, 6820] },
  { spw: 2, codes: ['U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U16', 'U18'], rate: 187, prices: [5610, 3366, 2618, 6732, 5387, 9350] },
  { spw: 2, codes: ['GIRLS'], rate: 121, prices: [3630, 2178, 1694, 4356, 3488, 6050] },
  { spw: 3, codes: ['U9', 'U10', 'U11', 'U12', 'U13', 'U14'], rate: 187, prices: [8415, 5049, 3927, 10100, 8079, 14027] },
  // As printed. Terms 1&2 (6,732) is below Term 1 alone (8,415) — flagged to operations.
  { spw: 3, codes: ['U16', 'U18'], rate: 187, prices: [8415, 5049, 3927, 6732, 5834, 10659] },
];
const PKG_ORDER = [TermPackage.T1, TermPackage.T2, TermPackage.T3, TermPackage.T1_2, TermPackage.T2_3, TermPackage.FULL];

/** Optional extras (VAT inclusive). The Advanced match kit is the home kit. */
const PRODUCTS: Array<Partial<Product>> = [
  { code: 'KIT-DEV', name: 'Development kit', description: 'One training kit', stream: RevenueStream.KITS,
    priceInclVat: '350.00', levels: [TeamLevel.DEVELOPMENT], kitItems: [{ type: KitType.TRAINING, qty: 1 }],
    offerAtRegistration: true, sortOrder: 10 },
  { code: 'KIT-ADV', name: 'Advanced kit', description: 'Training kit and match kit', stream: RevenueStream.KITS,
    priceInclVat: '550.00', levels: [TeamLevel.ADVANCED, TeamLevel.HPC],
    kitItems: [{ type: KitType.TRAINING, qty: 1 }, { type: KitType.HOME, qty: 1 }],
    offerAtRegistration: true, sortOrder: 20 },
  { code: 'MCL', name: 'Man City League', description: 'Optional league entry', stream: RevenueStream.MAN_CITY_LEAGUE,
    priceInclVat: '600.00', levels: [], kitItems: [], offerAtRegistration: true, sortOrder: 30 },
];

/** Season calendar, from LaLiga_Academy_Calendar_2026-2027.xlsx. */
// noTraining: the season schedule skips these days. Mid-term breaks keep training
// (the price list counts those weeks); Ramadan keeps training at adjusted times.
const CALENDAR: Array<{ kind: AcademyEventKind; title: string; start: string; end: string; notes?: string; noTraining?: boolean }> = [
  { kind: AcademyEventKind.EVENT, title: 'Open trials week', start: '2026-08-24', end: '2026-08-28' },
  { kind: AcademyEventKind.HOLIDAY, title: 'Mid-term break', start: '2026-10-12', end: '2026-10-16', notes: 'Intensive camp / tournaments possible' },
  { kind: AcademyEventKind.HOLIDAY, title: 'Commemoration & National Day', start: '2026-12-02', end: '2026-12-03', notes: 'No training', noTraining: true },
  { kind: AcademyEventKind.HOLIDAY, title: 'Winter break', start: '2026-12-14', end: '2027-01-01', noTraining: true },
  { kind: AcademyEventKind.EVENT, title: 'Ramadan — adjusted schedule', start: '2027-02-08', end: '2027-03-09', notes: 'Evening sessions, reduced intensity' },
  { kind: AcademyEventKind.HOLIDAY, title: 'Mid-term break', start: '2027-02-15', end: '2027-02-19' },
  { kind: AcademyEventKind.HOLIDAY, title: 'Eid al-Fitr', start: '2027-03-09', end: '2027-03-11', notes: 'No training', noTraining: true },
  { kind: AcademyEventKind.HOLIDAY, title: 'Spring break', start: '2027-03-15', end: '2027-04-02', noTraining: true },
  { kind: AcademyEventKind.HOLIDAY, title: 'Eid al-Adha', start: '2027-05-15', end: '2027-05-18', notes: 'No training', noTraining: true },
  { kind: AcademyEventKind.HOLIDAY, title: 'Summer break', start: '2027-06-28', end: '2027-08-27', noTraining: true },
];

const TEST_FAMILY = {
  guardian: {
    fullName: 'Test Parent', email: 'test.parent@example.com', mobile: '+971500000100',
    relationship: 'Father', emirate: 'Abu Dhabi', city: 'Abu Dhabi', marketingConsent: false,
  },
  player: {
    firstName: 'Test', lastName: 'Player', gender: Gender.MALE, dateOfBirth: '2015-03-14',
    kitSize: 'YM', emergencyContactName: 'Test Parent', emergencyContactPhone: '+971500000100',
  },
  /** The test child's team. Sergio is assigned here only so the coach column shows. */
  team: { ages: ['U12'], level: D },
  coach: 'Sergio',
  comment: 'Test account for system testing — safe to edit, invoice or archive.',
};

async function reference() {
  const ds = await AppDataSource.initialize();
  console.log('Academy seed — connected.');

  const season = await ds.getRepository(Season).findOne({ where: { isActive: true } });
  if (!season) throw new Error('No active season — run seed.ts first.');
  const terms = await ds.getRepository(Term).find({ where: { seasonId: season.id }, order: { startDate: 'ASC' } });
  const location = await ds.getRepository(Location).findOne({ where: { name: 'Abu Dhabi - Active Al Maryah' } });
  if (!location) throw new Error('Location "Abu Dhabi - Active Al Maryah" missing — run seed.ts first.');
  const ageGroups = await ds.getRepository(AgeGroup).find({ where: { isActive: true } });
  const ag = new Map(ageGroups.map((a) => [a.code, a]));

  // ---- coaches -----------------------------------------------------------
  const userRepo = ds.getRepository(User);
  const coachRepo = ds.getRepository(Coach);
  const coachRole = await ds.getRepository(Role).findOne({ where: { slug: 'coach' } });
  if (!coachRole) throw new Error('Coach role missing — run seed.ts first.');
  const coachByName = new Map<string, Coach>();
  for (const name of COACHES) {
    const email = `${name.toLowerCase()}@laligaacademy.local`;
    let u = await userRepo.findOne({ where: { email } });
    if (!u) {
      // Sergio keeps the documented test login so the coach view can be checked.
      // Everyone else gets an unguessable password AND a disabled account, so no
      // one can sign in as them until real credentials are issued.
      const isTestLogin = name === 'Sergio' && process.env.LALIGA_LIVE !== 'true';
      u = await userRepo.save(userRepo.create({
        fullName: name, email, roleId: coachRole.id,
        passwordHash: await bcrypt.hash(isTestLogin ? 'Coach@12345' : randomBytes(24).toString('hex'), 10),
        isActive: isTestLogin,
      }));
    }
    let c = await coachRepo.findOne({ where: { userId: u.id } });
    if (!c) c = await coachRepo.save(coachRepo.create({ userId: u.id }));
    coachByName.set(name, c);
  }
  console.log(`  coaches: ${COACHES.length} (${process.env.LALIGA_LIVE === 'true' ? 'logins disabled until a super admin sets each password' : 'logins disabled except the Sergio test login'})`);

  // ---- teams -------------------------------------------------------------
  const teamRepo = ds.getRepository(Team);
  const [capsRow] = await ds.query(`SELECT value FROM app_settings WHERE key = 'teamCapsVersion'`).catch(() => []);
  const capsApplied = capsRow?.value === TEAM_CAPS_VERSION;
  for (const def of ACADEMY_TEAMS) {
    const name = teamLabel({ ageCodes: def.ages, level: def.level, squad: def.squad, squadNumber: def.n });
    const primary = ag.get(def.ages[0]);
    if (!primary) throw new Error(`Age category ${def.ages[0]} missing for team ${name}`);
    const existing = await teamRepo.findOne({ where: { name, seasonId: season.id } })
      ?? (def.was ? await teamRepo.findOne({ where: { name: def.was, seasonId: season.id } }) : null);
    const shape: any = {
      name, seasonId: season.id, ageGroupId: primary.id, locationId: location.id,
      level: def.level, squad: def.squad ?? null, squadNumber: def.n ?? null,
      ageCodes: def.ages, trainingDays: def.days, startTime: def.slot[0], endTime: def.slot[1],
      isActive: true,
    };
    // Capacity is set when a team is created and when the list version changes;
    // otherwise a capacity changed in the app is left alone.
    if (!existing || !capsApplied) shape.capacity = def.cap;
    if (!existing) await teamRepo.save(teamRepo.create(shape));
    else await teamRepo.update(existing.id, shape);   // keeps an assigned coach
  }
  if (!capsApplied) {
    await ds.query(`INSERT INTO app_settings (key, value) VALUES ('teamCapsVersion', $1::jsonb)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(TEAM_CAPS_VERSION)]);
  }
  console.log(`  teams: ${ACADEMY_TEAMS.length} at ${location.name}`);

  // ---- price list ----------------------------------------------------------
  // Rows are created once; after that the Price list screen owns them, so a
  // price changed there is never put back by the next boot.
  const priceRepo = ds.getRepository(PriceListEntry);
  let priceRows = 0;
  for (const band of PRICE_SHEET) {
    for (const category of band.codes) {
      if (category !== 'GIRLS' && !ag.has(category)) continue;
      const exists = await priceRepo.findOne({ where: { seasonId: season.id, sessionsPerWeek: band.spw, category } });
      if (exists) continue;
      const prices: Partial<Record<TermPackage, number>> = {};
      PKG_ORDER.forEach((k, i) => { prices[k] = band.prices[i]; });
      await priceRepo.save(priceRepo.create({
        seasonId: season.id, sessionsPerWeek: band.spw, category, sessionRate: band.rate.toFixed(2),
        prices, vatRate: '5.00',
      }));
      priceRows++;
    }
  }
  console.log(`  price list: ${priceRows} new row(s) (1, 2 and 3 sessions a week, VAT inclusive)`);
  // The price list counts Term 2 as 9 weeks.
  const t2 = terms[1];
  if (t2 && t2.name === 'Term 2' && t2.weeks === 10 && t2.startDate === '2027-01-04') {
    await ds.getRepository(Term).update(t2.id, { weeks: 9 });
  }

  // ---- products: kits and the league ------------------------------------
  const prodRepo = ds.getRepository(Product);
  for (const p of PRODUCTS) {
    if (!(await prodRepo.findOne({ where: { code: p.code! } }))) await prodRepo.save(prodRepo.create(p));
  }
  console.log(`  products: ${PRODUCTS.map((p) => p.name).join(', ')}`);

  // ---- merchants (card terminal and payment link) ---------------------------
  // Merchant IDs as given by operations (Oct 2026); editable under Settings.
  const merchRepo = ds.getRepository(Merchant);
  for (const m of [
    { name: 'Network', merchantNumber: '13435', methods: [PaymentMethod.CARD] },
    { name: 'Payfort', merchantNumber: '90571', methods: [PaymentMethod.ONLINE] },
  ]) {
    if (!(await merchRepo.findOne({ where: { name: m.name } }))) await merchRepo.save(merchRepo.create(m));
  }
  console.log('  merchants: Network (13435), Payfort (90571)');

  // ---- inventory: a fresh store starts with ONE practice item (Karim, Oct 2026:
  // the real stock is added by hand). Existing stores are never touched here.
  const invRepo = ds.getRepository(InventoryItem);
  if ((await invRepo.count()) === 0) {
    const today = new Date().toISOString().slice(0, 10);
    const t = TEST_ITEM, sz = t.sizes[0];
    const item = await invRepo.save(invRepo.create({
      sku: 'LL-TEST-' + sz.size, itemCode: t.itemCode, name: t.name, programme: t.programme, category: t.category,
      size: sz.size, unit: t.unit, condition: t.condition, currentStock: sz.openingQty, notes: t.notes,
    }));
    await ds.getRepository(InventoryMovement).save({
      itemId: item.id, type: StockMovementType.OPENING, quantity: sz.openingQty, balanceAfter: sz.openingQty,
      movedOn: today, reason: 'Opening stock', batch: 'PRACTICE',
    });
    console.log('  inventory: one practice item (LL-TEST-M) — add the real stock by hand');
  }

  // ---- season calendar ------------------------------------------------------
  const evRepo = ds.getRepository(AcademyEvent);
  for (const c of CALENDAR) {
    const found = await evRepo.findOne({ where: { title: c.title, startDate: c.start } });
    if (!found) {
      await evRepo.save(evRepo.create({ seasonId: season.id, kind: c.kind, title: c.title, startDate: c.start, endDate: c.end, notes: c.notes ?? null, noTraining: !!c.noTraining }));
    } else if (c.noTraining && !found.noTraining) {
      await evRepo.update(found.id, { noTraining: true });
    }
  }
  // Pitch bookings: the academy trains at Active Al Maryah every week of each term.
  for (const t of terms) {
    const title = `Training pitches — ${t.name}`;
    if (t.startDate && t.endDate && !(await evRepo.findOne({ where: { title, seasonId: season.id } }))) {
      await evRepo.save(evRepo.create({
        seasonId: season.id, kind: AcademyEventKind.PITCH_BOOKING, title, startDate: t.startDate, endDate: t.endDate,
        locationId: location.id, notes: 'Weekly training slots, from the team schedule. Edit if the booking differs.',
      }));
    }
  }
  console.log(`  calendar: ${CALENDAR.length} dates + pitch bookings for ${terms.length} terms`);

  // ---- the season's training sessions ------------------------------------
  // Every team, on its days and times, every term day except no-training days.
  // Created once; after that Teams → "Season sessions" adds any that are missing, and
  // Team registers → "Re-plan future sessions" follows a change of days or times.
  // A team with no training sessions yet (all of them on a fresh install, or a
  // team opened mid-season, from today) gets its sessions; others are left alone.
  {
    const { planTeamSessions } = await import('../modules/scheduling/season-plan');
    const planTerms = terms.filter((t) => t.type === 'TERM' && t.startDate && t.endDate)
      .map((t) => ({ id: t.id, startDate: t.startDate!, endDate: t.endDate! }));
    const closures = (await evRepo.find({ where: { noTraining: true } })).map((e) => ({ startDate: e.startDate, endDate: e.endDate }));
    const allTeams = await teamRepo.find({ where: { seasonId: season.id, isActive: true } });
    const have: Array<{ teamId: string }> = await ds.query(
      `SELECT DISTINCT s."teamId" FROM sessions s JOIN terms t ON t.id = s."termId"
       WHERE s.type = 'TRAINING' AND t."seasonId" = $1 AND s."teamId" IS NOT NULL`, [season.id]);
    const planned = new Set(have.map((h) => h.teamId));
    let made = 0, teamsPlanned = 0;
    for (const t of allTeams) {
      if (planned.has(t.id)) continue;
      // Fresh install: the whole season. A team opened later: from today onwards.
      const from = planned.size ? new Date(Date.now() + 4 * 3600000).toISOString().slice(0, 10) : undefined;
      const plan = planTeamSessions(t as any, planTerms, closures, { from });
      if (plan.length) {
        await ds.getRepository(Session).insert(plan.map((p) => ({
          type: SessionType.TRAINING, termId: p.termId, teamId: t.id, locationId: t.locationId ?? undefined,
          coachId: t.headCoachId ?? undefined, startsAt: p.startsAt, endsAt: p.endsAt,
        })));
        made += plan.length; teamsPlanned++;
      }
    }
    if (made) console.log(`  sessions: ${made} training sessions for ${teamsPlanned} team(s) (31 Aug 2026 – 11 Jun 2027)`);
    else console.log(`  sessions: every team already has its season`);
  }

  // ---- discounts ---------------------------------------------------------
  const discRepo = ds.getRepository(Discount);
  const discounts: Array<Partial<Discount>> = [
    { name: 'Sibling discount', kind: DiscountKind.PERCENTAGE, value: '15.00', rule: DiscountRule.SIBLING,
      params: { tiers: [15, 25], beyond: 25 }, isAutomatic: true },
    { name: 'Returning player 15%', kind: DiscountKind.PERCENTAGE, value: '15.00', rule: DiscountRule.RETURNING, params: {}, isAutomatic: false },
    { name: 'Early bird 10%', kind: DiscountKind.PERCENTAGE, value: '10.00', rule: DiscountRule.EARLY_BIRD, params: { cutoffDate: '2026-09-14' }, isAutomatic: false },
    { name: 'Special 25%', kind: DiscountKind.PERCENTAGE, value: '25.00', rule: DiscountRule.MANUAL, params: {}, isAutomatic: false },
  ];
  for (const d of discounts) {
    const existing = await discRepo.findOne({ where: { name: d.name } });
    if (!existing) await discRepo.save(discRepo.create(d));
    else await discRepo.update(existing.id, { isAutomatic: d.isAutomatic, params: d.params });
  }
  console.log('  discounts: sibling ladder automatic, 3 manual');

  // ---- message templates --------------------------------------------------
  const tplRepo = ds.getRepository(CommunicationTemplate);
  const templates = [
    { name: 'payment-reminder', channel: CommunicationChannel.EMAIL, subject: 'Payment reminder — {{invoice}}',
      body: 'Dear {{guardian.fullName}},\n\nInvoice {{invoice}} has an outstanding balance of AED {{balance}}.\n\nLaLiga Academy Abu Dhabi' },
    { name: 'trial-confirmation', channel: CommunicationChannel.EMAIL, subject: 'Your trial is confirmed',
      body: 'Dear {{guardian.fullName}},\n\n{{player}} is confirmed for {{date}}.\n\nLaLiga Academy Abu Dhabi' },
    { name: 'welcome', channel: CommunicationChannel.EMAIL, subject: 'Welcome to LaLiga Academy',
      body: 'Dear {{guardian.fullName}},\n\n{{player}} is registered in {{ageGroup}}.\n\nLaLiga Academy Abu Dhabi' },
    { name: 'term-announcement', channel: CommunicationChannel.WHATSAPP, body: 'LaLiga Academy: {{message}}' },
  ];
  for (const t of templates) {
    if (!(await tplRepo.findOne({ where: { name: t.name } }))) await tplRepo.save(tplRepo.create(t));
  }

  const out = {
    seasonId: season.id,
    term1Id: terms[0]?.id,
    guardianExists: !!(await ds.getRepository(Guardian).findOne({ where: { email: TEST_FAMILY.guardian.email } })),
    familyCount: await ds.getRepository(Guardian).count(),
    playerCount: await ds.getRepository(Player).count(),
    coachId: coachByName.get(TEST_FAMILY.coach)!.id,
  };
  await ds.destroy();
  return out;
}

/**
 * The test family goes through the real application services — the same code
 * paths the admin screen uses — so registration, category placement, the sibling
 * rule, VAT and invoice numbering are exercised rather than faked.
 */
async function testFamily(ctx: Awaited<ReturnType<typeof reference>>) {
  if (process.env.LALIGA_LIVE === 'true') { console.log('  test family: not created on the live system'); return; }
  if (ctx.guardianExists) { console.log('  test family: already present'); return; }
  if (ctx.familyCount > 0) {
    console.log(`  test family: skipped — the database already holds ${ctx.familyCount} families`);
    return;
  }
  if (!ctx.term1Id) { console.log('  test family: skipped — no terms'); return; }

  // Late imports: the app module pulls in the whole system.
  const { AppModule } = await import('../app.module');
  const { GuardiansService } = await import('../modules/people/guardians.service');
  const { PlayersService } = await import('../modules/people/players.service');
  const { EnrolmentService } = await import('../modules/registration/enrolment.service');
  const { InvoicesService } = await import('../modules/finance/invoices.service');
  const { DataSource } = await import('typeorm');

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const guardians = app.get(GuardiansService);
    const players = app.get(PlayersService);
    const enrol = app.get(EnrolmentService);
    const invoices = app.get(InvoicesService);
    const ds = app.get(DataSource);

    const team = await ds.getRepository(Team).findOne({
      where: { name: teamLabel({ ageCodes: TEST_FAMILY.team.ages, level: TEST_FAMILY.team.level }), seasonId: ctx.seasonId },
    });
    if (!team) throw new Error('Test team missing');
    if (!team.headCoachId) await ds.getRepository(Team).update(team.id, { headCoachId: ctx.coachId });

    const g = await guardians.create(TEST_FAMILY.guardian);
    const p = await players.create({ guardianId: g.id, ...TEST_FAMILY.player });
    const { enrolment } = await enrol.enrol({ playerId: p.id, termId: ctx.term1Id, teamId: team.id, seasonId: ctx.seasonId });
    const { invoice } = await invoices.generateForEnrolments({ enrolmentIds: [enrolment.id] });
    await invoices.issue(invoice!.id);
    await players.addComment(p.id, TEST_FAMILY.comment);

    console.log(`  test family: ${g.reference} ${g.fullName} → ${p.reference} ${p.firstName} ${p.lastName}, ${team.name}, invoice ${invoice!.number}`);
  } finally {
    await app.close();
  }
}

reference()
  .then(testFamily)
  .then(() => console.log('Academy seed complete.'))
  .catch((e) => { console.error(e); process.exit(1); });
