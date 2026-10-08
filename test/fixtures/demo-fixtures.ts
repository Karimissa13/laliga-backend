import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as bcrypt from 'bcryptjs';
import { AppDataSource } from '../../src/database/data-source';
import {
  AgeGroup, AppliedDiscount, Attendance, AttendanceStatus, Coach, Communication,
  CommunicationChannel, CommunicationTemplate, Discount, DiscountKind, DiscountRule,
  Document, DocumentType, Enrolment, EnrolmentStatus, Evaluation, Fee, Gender, Guardian,
  Invoice, InvoiceLineItem, InvoiceStatus, Lead, LeadSource, LeadStatus, Location,
  Payment, PaymentDirection, PaymentMethod, PaymentStatus, Player, PlayerStatus,
  ProgramType, Role, Season, Session, SessionType, Team, Term, User, Venue, Wallet,
} from '../../src/database/entities';
import { deriveAgeGroupCode } from '../../src/modules/people/age-group.util';
import { makeReference } from '../../src/common/reference.util';

dotenv.config();

/**
 * TEST FIXTURES ONLY — never loaded into a real academy database.
 *
 * Volume data (families, invoices, sessions, attendance, evaluations) that the
 * phase 3–6 e2e suite exercises. It used to ship as the system's demo data; the
 * academy now starts clean with its real structure (see seed-academy.ts), so this
 * lives with the tests. Run with `npm run test:fixtures` against a TEST database.
 */

const FIRST_M = ['Yousef', 'Omar', 'Zayd', 'Bilal', 'Adam', 'Karim', 'Hamza', 'Diego', 'Marc', 'Pau', 'Rayan', 'Idris', 'Noah', 'Sami', 'Tariq', 'Yahya', 'Ali', 'Faris', 'Jad', 'Nour'];
const FIRST_F = ['Sara', 'Mia', 'Lina', 'Yara', 'Aisha', 'Layla', 'Nadia', 'Zara', 'Hana', 'Salma'];
const LAST = ['Al Mansoori', 'Garcia', 'Haddad', 'Khan', 'Al Blooshi', 'Fernandez', 'Rahman', 'Saeed', 'Martinez', 'Al Suwaidi', 'Iqbal', 'Nasser', 'Lopez', 'Yousif', 'Baig'];

function pick<T>(arr: T[], i: number): T { return arr[i % arr.length]; }
const money = (n: number) => Math.round(n * 100) / 100;

async function run() {
  const ds = await AppDataSource.initialize();
  console.log('Test fixtures — connected.');

  const playerRepo = ds.getRepository(Player);
  if ((await playerRepo.count()) > 12) {
    console.log('Demo data already present — skipping.');
    await ds.destroy();
    return;
  }

  const seasonRepo = ds.getRepository(Season);
  const termRepo = ds.getRepository(Term);
  const locRepo = ds.getRepository(Location);
  const venueRepo = ds.getRepository(Venue);
  const agRepo = ds.getRepository(AgeGroup);
  const teamRepo = ds.getRepository(Team);
  const coachRepo = ds.getRepository(Coach);
  const userRepo = ds.getRepository(User);
  const roleRepo = ds.getRepository(Role);
  const gRepo = ds.getRepository(Guardian);
  const walletRepo = ds.getRepository(Wallet);
  const enrolRepo = ds.getRepository(Enrolment);
  const feeRepo = ds.getRepository(Fee);
  const discRepo = ds.getRepository(Discount);
  const invRepo = ds.getRepository(Invoice);
  const lineRepo = ds.getRepository(InvoiceLineItem);
  const appliedRepo = ds.getRepository(AppliedDiscount);
  const payRepo = ds.getRepository(Payment);
  const leadRepo = ds.getRepository(Lead);
  const sessionRepo = ds.getRepository(Session);
  const attRepo = ds.getRepository(Attendance);
  const evalRepo = ds.getRepository(Evaluation);
  const docRepo = ds.getRepository(Document);
  const tplRepo = ds.getRepository(CommunicationTemplate);

  const season = (await seasonRepo.findOne({ where: { isActive: true } }))!;
  const terms = await termRepo.find({ where: { seasonId: season.id }, order: { startDate: 'ASC' } });
  const term1 = terms[0];
  const locations = await locRepo.find();
  const activeAlMaryah = locations.find((l) => l.name.includes('Maryah')) ?? locations[0];
  const zsc = locations.find((l) => l.name.includes('Zayed')) ?? locations[0];
  const ageGroups = await agRepo.find();
  const agByCode = new Map(ageGroups.map((a) => [a.code, a]));

  // ---------------------------------------------------------------- venues
  const venues: Venue[] = [];
  for (const [loc, names] of [[activeAlMaryah, ['Grass Pitch', 'Astro Turf', 'The Dome']], [zsc, ['Pitch 1', 'Pitch 2']]] as const) {
    for (const n of names) {
      let v = await venueRepo.findOne({ where: { locationId: loc.id, name: n } });
      if (!v) v = await venueRepo.save(venueRepo.create({ locationId: loc.id, name: n }));
      venues.push(v);
    }
  }
  console.log(`  venues: ${venues.length}`);

  // ---------------------------------------------------------------- coaches
  const coachRole = (await roleRepo.findOne({ where: { slug: 'coach' } }))!;
  const coachDefs = [
    ['Sergio', 'sergio@laligaacademy.local', 'UEFA A Pro'],
    ['Pol', 'pol@laligaacademy.local', 'UEFA A Pro'],
    ['Guillem', 'guillem@laligaacademy.local', 'UEFA A'],
    ['Francisco', 'francisco@laligaacademy.local', 'UEFA B'],
  ];
  const coaches: Coach[] = [];
  for (const [name, email, cert] of coachDefs) {
    let u = await userRepo.findOne({ where: { email } });
    if (!u) {
      u = await userRepo.save(userRepo.create({
        fullName: name, email, roleId: coachRole.id,
        passwordHash: await bcrypt.hash('Coach@12345', 10),
      }));
    }
    let c = await coachRepo.findOne({ where: { userId: u.id } });
    if (!c) c = await coachRepo.save(coachRepo.create({ userId: u.id, certification: cert }));
    coaches.push(c);
  }
  console.log(`  coaches: ${coaches.length}`);

  // ------------------------------------------------------------------ teams
  const teamDefs = [
    ['Development Blue', 'U8', activeAlMaryah, 16, 0],
    ['Development Red', 'U10', activeAlMaryah, 16, 1],
    ['Advanced Black', 'U12', activeAlMaryah, 14, 0],
    ['Advanced White', 'U14', activeAlMaryah, 14, 2],
    ['High Performance', 'U16', activeAlMaryah, 12, 1],
    ['ZSC Development', 'U10', zsc, 14, 3],
  ] as const;
  const teams: Team[] = [];
  for (const [name, agCode, loc, cap, coachIdx] of teamDefs) {
    let t = await teamRepo.findOne({ where: { name } });
    if (!t) {
      t = await teamRepo.save(teamRepo.create({
        name, seasonId: season.id, ageGroupId: agByCode.get(agCode)?.id,
        locationId: loc.id, headCoachId: coaches[coachIdx].id, capacity: cap,
      }));
    }
    teams.push(t);
  }
  console.log(`  teams: ${teams.length}`);

  // ------------------------------------------------------------------- fees
  // U6 and U8 sit in the lower bracket; U10 and up are full price.
  // Placeholder figures until operations supplies the real 2026/27 fee card.
  const feeDefs = [
    [term1.id, 'U6', 2400], [term1.id, 'U8', 2400],
    [term1.id, 'U10', 3801], [term1.id, 'U12', 3801],
    [term1.id, 'U14', 3801], [term1.id, 'U16', 4200],
  ] as const;
  for (const [termId, code, amount] of feeDefs) {
    const ag = agByCode.get(code);
    if (!ag) continue;
    const exists = await feeRepo.findOne({ where: { termId, ageGroupId: ag.id } });
    if (!exists) {
      await feeRepo.save(feeRepo.create({
        termId, ageGroupId: ag.id, amount: amount.toFixed(2), vatRate: '5.00',
        programType: ProgramType.TERM,
      }));
    }
  }
  // fallback price for any term without an age-specific row
  for (const t of terms) {
    const any = await feeRepo.findOne({ where: { termId: t.id } });
    if (!any) {
      await feeRepo.save(feeRepo.create({ termId: t.id, amount: '3000.00', vatRate: '5.00' }));
    }
  }
  console.log('  fees: configured');

  // -------------------------------------------------------------- discounts
  // Academy policy: the sibling discount is the ONLY rule that applies by itself.
  // Ladder: 1st child full price, 2nd 15%, 3rd 25%, 4th and beyond 25%.
  // The others stay in the catalogue so an admin can apply one deliberately.
  const discDefs: Array<Partial<Discount>> = [
    {
      name: 'Sibling discount', kind: DiscountKind.PERCENTAGE, value: '15.00',
      rule: DiscountRule.SIBLING, params: { tiers: [15, 25], beyond: 25 },
      isAutomatic: true,
    },
    { name: 'Returning player 15%', kind: DiscountKind.PERCENTAGE, value: '15.00', rule: DiscountRule.RETURNING, params: {}, isAutomatic: false },
    { name: 'Early bird 10%', kind: DiscountKind.PERCENTAGE, value: '10.00', rule: DiscountRule.EARLY_BIRD, params: { cutoffDate: '2027-09-14' }, isAutomatic: false },
    { name: 'Special 25%', kind: DiscountKind.PERCENTAGE, value: '25.00', rule: DiscountRule.MANUAL, params: {}, isAutomatic: false },
  ];
  for (const d of discDefs) {
    const existing = await discRepo.findOne({ where: { name: d.name } });
    if (!existing) { await discRepo.save(discRepo.create(d)); continue; }
    // Correct rows written by the earlier version, which made every rule automatic.
    await discRepo.update(existing.id, { isAutomatic: d.isAutomatic ?? false, params: d.params });
  }
  // The pre-correction row name, if this database still has it.
  const stale = await discRepo.findOne({ where: { name: 'Sibling discount 10%' } });
  if (stale) await discRepo.update(stale.id, { isActive: false, isAutomatic: false });
  console.log(`  discount rules: ${discDefs.length}`);

  // ------------------------------------------------- guardians + players
  let prSeq = (await gRepo.count()) + 1;
  let plSeq = (await playerRepo.count()) + 1;
  const players: Player[] = [];
  const guardians: Guardian[] = [];

  const FAMILIES = 26;
  for (let i = 0; i < FAMILIES; i++) {
    const last = pick(LAST, i);
    const gName = `${pick(['Ahmed', 'Maria', 'Khalid', 'Sofia', 'Rashid', 'Elena', 'Yusuf', 'Amina'], i)} ${last}`;
    const email = `family${i + 1}@example.com`;
    let g = await gRepo.findOne({ where: { email } });
    if (!g) {
      g = await gRepo.save(gRepo.create({
        reference: makeReference('PR', prSeq++), fullName: gName, email,
        mobile: `+9715${String(10000000 + i * 137).slice(0, 8)}`,
        relationship: i % 2 ? 'Mother' : 'Father', emirate: 'Abu Dhabi',
        marketingConsent: i % 3 !== 0,
        howHeard: [LeadSource.SOCIAL_MEDIA, LeadSource.REFERRAL, LeadSource.WEBSITE, LeadSource.SCHOOL][i % 4],
      }));
      await walletRepo.save(walletRepo.create({ guardianId: g.id, balance: '0' }));
    }
    guardians.push(g);

    // 1–2 children per family (siblings exercise the sibling discount rule)
    const kids = i % 4 === 0 ? 2 : 1;
    for (let k = 0; k < kids; k++) {
      const isGirl = (i + k) % 7 === 0;
      const first = isGirl ? pick(FIRST_F, i + k) : pick(FIRST_M, i * 2 + k);
      // Birth years chosen so players land in the age groups that have teams
      // (cutoff 2026-12-31 → U8=2019, U10=2017, U12=2015, U14=2013, U16=2011).
      const year = [2019, 2017, 2015, 2013, 2011][(i + k * 2) % 5];
      const dob = `${year}-${String(((i + k) % 12) + 1).padStart(2, '0')}-${String(((i * 3 + k) % 27) + 1).padStart(2, '0')}`;
      const code = deriveAgeGroupCode(dob, season.cutoffDate);
      const ag = agByCode.get(code);
      const team = teams.find((t) => t.ageGroupId === ag?.id);

      const status = i >= FAMILIES - 3 ? PlayerStatus.TRIAL
        : i >= FAMILIES - 5 ? PlayerStatus.WAITLISTED
        : PlayerStatus.ACTIVE;

      const p = await playerRepo.save(playerRepo.create({
        reference: makeReference('PL', plSeq++), guardianId: g.id,
        firstName: first, lastName: last,
        gender: isGirl ? Gender.FEMALE : Gender.MALE,
        dateOfBirth: dob, status,
        ageGroupId: ag?.id,
        currentTeamId: status === PlayerStatus.ACTIVE ? team?.id : undefined,
        kitSize: pick(['128', '140', '152', '164', 'S', 'M'], i + k),
        emergencyContactName: gName,
        emergencyContactPhone: g.mobile,
      }));
      players.push(p);

      // enrolment history for active players
      if (status === PlayerStatus.ACTIVE && team) {
        await enrolRepo.save(enrolRepo.create({
          playerId: p.id, seasonId: season.id, termId: term1.id, teamId: team.id,
          status: EnrolmentStatus.ACTIVE,
        }));
      }
    }
  }
  await ds.query(`SELECT setval('guardian_ref_seq', ${prSeq - 1}, true)`).catch(() => {});
  await ds.query(`SELECT setval('player_ref_seq', ${plSeq - 1}, true)`).catch(() => {});
  console.log(`  guardians: ${guardians.length}, players: ${players.length}`);

  // ------------------------------------------------------------- invoices
  const enrolments = await enrolRepo.find({ relations: { player: { ageGroup: true }, term: true } });
  let laSeq = 1;
  let invCount = 0, payCount = 0;
  for (const [idx, e] of enrolments.entries()) {
    const fee = await feeRepo.findOne({ where: { termId: e.termId, ageGroupId: e.player.ageGroupId ?? undefined } })
      ?? await feeRepo.findOne({ where: { termId: e.termId } });
    if (!fee) continue;

    const unit = Number(fee.amount);
    // simple deterministic discount mix so the data looks real
    const discPct = idx % 5 === 0 ? 15 : idx % 7 === 0 ? 10 : 0;
    const discAmt = money(unit * (discPct / 100));
    const net = money(unit - discAmt);
    const vat = money(net * 0.05);
    const total = money(net + vat);

    const issued = new Date(); issued.setDate(issued.getDate() - (60 - (idx % 60)));
    const due = new Date(issued); due.setDate(due.getDate() + 14);

    const inv = await invRepo.save(invRepo.create({
      number: makeReference('LA', laSeq++, 4),
      guardianId: e.player.guardianId,
      status: InvoiceStatus.ISSUED,
      issueDate: issued.toISOString().slice(0, 10),
      dueDate: due.toISOString().slice(0, 10),
      subtotal: net.toFixed(2), discountTotal: discAmt.toFixed(2),
      vatTotal: vat.toFixed(2), total: total.toFixed(2),
    }));
    await lineRepo.save(lineRepo.create({
      invoiceId: inv.id, playerId: e.playerId,
      description: `${e.player.firstName} ${e.player.lastName} — ${e.term?.name}`,
      unitAmount: unit.toFixed(2), vatRate: '5.00', lineTotal: net.toFixed(2),
    }));
    if (discPct) {
      await appliedRepo.save(appliedRepo.create({
        invoiceId: inv.id, label: discPct === 15 ? 'Returning player 15%' : 'Sibling discount 10%',
        rule: discPct === 15 ? DiscountRule.RETURNING : DiscountRule.SIBLING,
        amount: discAmt.toFixed(2),
      }));
    }
    await enrolRepo.update(e.id, { invoiceId: inv.id });
    invCount++;

    // payment behaviour: ~60% paid, ~15% part-paid, ~25% unpaid (some overdue)
    const mod = idx % 20;
    if (mod < 12) {
      await payRepo.save(payRepo.create({
        invoiceId: inv.id, direction: PaymentDirection.INBOUND, amount: total.toFixed(2),
        method: pick([PaymentMethod.CARD, PaymentMethod.BANK_TRANSFER, PaymentMethod.CASH, PaymentMethod.ONLINE], idx),
        status: PaymentStatus.COMPLETED, paidAt: new Date(issued.getTime() + 3 * 86400000),
      }));
      await invRepo.update(inv.id, { amountPaid: total.toFixed(2), status: InvoiceStatus.PAID });
      payCount++;
    } else if (mod < 15) {
      const part = money(total / 2);
      await payRepo.save(payRepo.create({
        invoiceId: inv.id, direction: PaymentDirection.INBOUND, amount: part.toFixed(2),
        method: PaymentMethod.BANK_TRANSFER, status: PaymentStatus.COMPLETED,
        paidAt: new Date(issued.getTime() + 5 * 86400000),
      }));
      await invRepo.update(inv.id, { amountPaid: part.toFixed(2), status: InvoiceStatus.PART_PAID });
      payCount++;
    }
  }
  await ds.query(`SELECT setval('invoice_ref_seq', ${laSeq - 1}, true)`).catch(() => {});
  console.log(`  invoices: ${invCount}, payments: ${payCount}`);

  // ----------------------------------------------------------------- leads
  const leadStatuses = [
    LeadStatus.NEW, LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.TRIAL_BOOKED,
    LeadStatus.TRIAL_BOOKED, LeadStatus.TRIAL_ATTENDED, LeadStatus.OFFER_MADE,
    LeadStatus.REGISTERED, LeadStatus.REGISTERED, LeadStatus.LOST,
  ];
  let trSeq = 1;
  for (let i = 0; i < 22; i++) {
    const last = pick(LAST, i + 5);
    const status = pick(leadStatuses, i);
    const trialDate = new Date();
    trialDate.setDate(trialDate.getDate() + ((i % 9) - 2)); // some past, some upcoming
    await leadRepo.save(leadRepo.create({
      reference: makeReference('TR', trSeq++),
      guardianName: `${pick(['Hassan', 'Nadia', 'Omar', 'Layla', 'Samir'], i)} ${last}`,
      guardianEmail: `lead${i + 1}@example.com`,
      guardianMobile: `+9715${String(20000000 + i * 311).slice(0, 8)}`,
      playerName: `${pick(FIRST_M, i + 3)} ${last}`,
      playerDob: `${2012 + (i % 8)}-0${(i % 9) + 1}-1${i % 9}`,
      source: pick([LeadSource.POPUP, LeadSource.ENQUIRY, LeadSource.WEBSITE, LeadSource.REFERRAL, LeadSource.SOCIAL_MEDIA], i),
      status,
      trialDate: [LeadStatus.TRIAL_BOOKED, LeadStatus.TRIAL_ATTENDED].includes(status) ? trialDate : undefined,
      venueLabel: i % 2 ? 'Active Al Maryah — Grass Pitch' : 'Zayed Sports City — Pitch 1',
    }));
  }
  await ds.query(`SELECT setval('lead_ref_seq', ${trSeq - 1}, true)`).catch(() => {});
  console.log('  leads: 22');

  // -------------------------------------------------------------- sessions
  const now = new Date();
  let sessCount = 0;
  for (const [ti, team] of teams.entries()) {
    const venue = venues.find((v) => v.locationId === team.locationId) ?? venues[0];
    // 3 past weeks + 2 upcoming weeks, 2 sessions per week
    for (let d = -18; d <= 12; d += 3) {
      const start = new Date(now); start.setDate(start.getDate() + d);
      start.setHours(17 + (ti % 3), 0, 0, 0);
      const end = new Date(start); end.setHours(start.getHours() + 1, 30);
      const s = await sessionRepo.save(sessionRepo.create({
        title: `${team.name} training`, type: SessionType.TRAINING,
        termId: term1.id, teamId: team.id, locationId: team.locationId,
        venueId: venue.id, coachId: team.headCoachId, startsAt: start, endsAt: end,
      }));
      sessCount++;

      // attendance for past sessions only
      if (d < 0) {
        const roster = players.filter((p) => p.currentTeamId === team.id);
        for (const [pi, p] of roster.entries()) {
          const r = (pi + Math.abs(d)) % 10;
          const status = r === 0 ? AttendanceStatus.ABSENT
            : r === 1 ? AttendanceStatus.EXCUSED
            : r === 2 ? AttendanceStatus.LATE
            : AttendanceStatus.PRESENT;
          await attRepo.save(attRepo.create({
            sessionId: s.id, playerId: p.id, status,
            reason: status === AttendanceStatus.EXCUSED ? 'Family travel' : undefined,
          }));
        }
      }
    }
  }
  // a couple of matches
  for (let i = 0; i < 3; i++) {
    const start = new Date(now); start.setDate(start.getDate() + 4 + i * 7); start.setHours(9, 0, 0, 0);
    const end = new Date(start); end.setHours(11, 0, 0, 0);
    await sessionRepo.save(sessionRepo.create({
      title: `Friendly vs ${pick(['Man City Academy', 'Al Jazira', 'ADNOC FC'], i)}`,
      type: SessionType.MATCH, termId: term1.id, teamId: teams[2 + (i % 3)].id,
      locationId: activeAlMaryah.id, venueId: venues[0].id,
      coachId: coaches[i % coaches.length].id, startsAt: start, endsAt: end,
    }));
    sessCount++;
  }
  console.log(`  sessions: ${sessCount} (+ attendance for past ones)`);

  // ----------------------------------------------------------- evaluations
  let evalCount = 0;
  for (const p of players.filter((x) => x.status === PlayerStatus.ACTIVE).slice(0, 24)) {
    const team = teams.find((t) => t.id === p.currentTeamId);
    for (let n = 0; n < 2; n++) {
      const base = 3 + ((p.reference.charCodeAt(p.reference.length - 1) + n) % 3) * 0.5;
      await evalRepo.save(evalRepo.create({
        playerId: p.id, termId: term1.id, coachId: team?.headCoachId,
        scores: {
          technical: Math.min(5, Math.round(base + (n ? 0.5 : 0))),
          tactical: Math.min(5, Math.round(base)),
          physical: Math.min(5, Math.round(base + 0.5)),
          social: Math.min(5, Math.round(base + (n ? 1 : 0))),
        },
        notes: n === 0 ? 'Baseline assessment for the term.' : 'Good progression — improved decision-making under pressure.',
      }));
      evalCount++;
    }
  }
  console.log(`  evaluations: ${evalCount}`);

  // ------------------------------------------------------------- documents
  let docCount = 0;
  for (const [i, p] of players.slice(0, 20).entries()) {
    const expires = new Date(); expires.setDate(expires.getDate() + (i % 5 === 0 ? 12 : 200));
    await docRepo.save(docRepo.create({
      type: DocumentType.MEDICAL_INSURANCE, fileName: `insurance-${p.reference}.pdf`,
      storageKey: `documents/${p.id}/insurance.pdf`, mimeType: 'application/pdf',
      playerId: p.id, expiresAt: expires,
    }));
    docCount++;
    if (i % 2 === 0) {
      await docRepo.save(docRepo.create({
        type: DocumentType.PHOTO, fileName: `photo-${p.reference}.jpg`,
        storageKey: `documents/${p.id}/photo.jpg`, mimeType: 'image/jpeg', playerId: p.id,
      }));
      docCount++;
    }
  }
  console.log(`  documents: ${docCount}`);

  // -------------------------------------------------------------- templates
  const templates = [
    { name: 'payment-reminder', channel: CommunicationChannel.EMAIL, subject: 'Payment reminder — {{invoice}}', body: 'Dear {{guardian.fullName}},\n\nInvoice {{invoice}} has an outstanding balance of AED {{balance}}.\n\nLaLiga Academy Abu Dhabi' },
    { name: 'trial-confirmation', channel: CommunicationChannel.EMAIL, subject: 'Your trial is confirmed', body: 'Dear {{guardian.fullName}},\n\n{{player}} is confirmed for {{date}}.\n\nLaLiga Academy Abu Dhabi' },
    { name: 'welcome', channel: CommunicationChannel.EMAIL, subject: 'Welcome to LaLiga Academy', body: 'Dear {{guardian.fullName}},\n\n{{player}} is registered in {{ageGroup}}.\n\nLaLiga Academy Abu Dhabi' },
    { name: 'term-announcement', channel: CommunicationChannel.WHATSAPP, body: 'LaLiga Academy: {{message}}' },
  ];
  for (const t of templates) {
    if (!(await tplRepo.findOne({ where: { name: t.name } }))) await tplRepo.save(tplRepo.create(t));
  }
  console.log(`  templates: ${templates.length}`);

  await ds.destroy();
  console.log('Test fixtures complete.');
}

run().catch((e) => { console.error(e); process.exit(1); });
