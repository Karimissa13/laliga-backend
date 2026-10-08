import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { AppDataSource } from '../database/data-source';
import {
  AgeGroup, Enrolment, EnrolmentStatus, Gender, Guardian, Invoice, InvoiceLineItem,
  Payment, PaymentDirection, PaymentStatus, Player, Season, Term, Wallet,
} from '../database/entities';
import {
  classifyProgramme, guardianKey, mapInvoiceStatus, mapPlayerStatus, normaliseDate,
  normaliseEmail, normaliseMobile, normaliseMoney, normaliseName, normalisePaymentMethod,
  parseAgeCategory,
} from './normalise';
import { makeReference } from '../common/reference.util';
import { deriveAgeGroupCode, placeInCategory } from '../modules/people/age-group.util';

/** The categories the academy runs (2026/27). Gap years play up — see placeInCategory. */
const ACADEMY_CATEGORIES = ['U6', 'U8', 'U9', 'U10', 'U11', 'U12', 'U13', 'U14', 'U16', 'U18'];

dotenv.config();

/**
 * Legacy import.
 *
 *   npm run migrate -- --dir ./legacy-export            (dry run — writes nothing)
 *   npm run migrate -- --dir ./legacy-export --commit   (actually import)
 *
 * Expects CSVs exported from the old admin, named after its screens:
 *   parents.csv   PR NO, Parent Name, Email, Mobile
 *   players.csv   Player No, Parent No, Player Name, DOB, Gender, Category,
 *                 Location, Status, Team, Term/League, Kit Size
 *   invoices.csv  Invoice No, Parent No, Invoice Date, Payment Date,
 *                 Payment Status, Payment Method, Total Amount Including VAT,
 *                 Amount Received Including VAT, VAT Amount, Subscription Details
 *
 * Column names are matched loosely (case/spacing/punctuation-insensitive), so
 * small export differences don't break the run. Anything unmatched is reported
 * rather than silently dropped.
 */

// ------------------------------------------------------------------ CSV
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .filter((r) => r.some((c) => c.trim() !== ''))
    .map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
/** Loose column lookup: pick(row, 'Parent No', 'parentno', 'PR NO') */
function pick(row: Record<string, string>, ...names: string[]): string {
  const keys = Object.keys(row);
  for (const n of names) {
    const target = norm(n);
    const hit = keys.find((k) => norm(k) === target) ?? keys.find((k) => norm(k).includes(target));
    if (hit && row[hit] !== '') return row[hit];
  }
  return '';
}

function readCsv(dir: string, file: string): Record<string, string>[] {
  const p = path.join(dir, file);
  if (!fs.existsSync(p)) return [];
  return parseCsv(fs.readFileSync(p, 'utf8'));
}

// --------------------------------------------------------------- reporting
interface Issue { severity: 'error' | 'warn'; area: string; message: string; row?: any }
const issues: Issue[] = [];
const err = (area: string, message: string, row?: any) => issues.push({ severity: 'error', area, message, row });
const warn = (area: string, message: string, row?: any) => issues.push({ severity: 'warn', area, message, row });

async function run() {
  const args = process.argv.slice(2);
  const dirIdx = args.indexOf('--dir');
  const dir = dirIdx >= 0 ? args[dirIdx + 1] : './legacy-export';
  const commit = args.includes('--commit');
  const deriveAge = args.includes('--derive-age');
  // Age bands are relative to the active season's cut-off.
  const seasonCutoff = process.env.SEASON_CUTOFF || `${new Date().getFullYear()}-12-31`;

  console.log(`\nLegacy import — ${commit ? 'COMMIT (writes to the database)' : 'DRY RUN (writes nothing)'}`);
  console.log(`Source: ${path.resolve(dir)}\n`);

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${path.resolve(dir)}`);
    console.error('Export parents.csv / players.csv / invoices.csv from the old admin into that folder.');
    process.exit(1);
  }

  const parentRows = readCsv(dir, 'parents.csv');
  const playerRows = readCsv(dir, 'players.csv');
  const invoiceRows = readCsv(dir, 'invoices.csv');
  console.log(`Read: ${parentRows.length} parents · ${playerRows.length} players · ${invoiceRows.length} invoices`);
  if (!parentRows.length && !playerRows.length) {
    console.error('Nothing to import — check the file names.');
    process.exit(1);
  }

  // ---------------------------------------------------------- 1. guardians
  const guardians = new Map<string, any>();      // dedupe key -> record
  const legacyParentRef = new Map<string, string>(); // legacy PR NO -> dedupe key
  let dupes = 0;

  for (const r of parentRows) {
    const ref = pick(r, 'PR NO', 'Parent No', 'parentref', 'id');
    const name = normaliseName(pick(r, 'Parent Name', 'Guardian Name', 'name', 'fullname'));
    const email = normaliseEmail(pick(r, 'Email', 'Parent Email', 'guardianemail'));
    const mobile = normaliseMobile(pick(r, 'Mobile', 'Parent Mobile', 'phone', 'guardianmobile'));

    if (!name && !email && !mobile) { err('parents', 'Row has no name, email or mobile — skipped', r); continue; }
    if (!email) warn('parents', `No usable email for "${name || ref}" — matched on mobile/name instead`);

    const key = guardianKey(email, mobile, name);
    if (guardians.has(key)) {
      dupes++;
      const existing = guardians.get(key);
      // keep the richer record
      existing.email = existing.email ?? email;
      existing.mobile = existing.mobile ?? mobile;
      warn('parents', `Duplicate guardian merged: "${name || ref}" → "${existing.name}"`);
    } else {
      guardians.set(key, { key, ref, name: name || '(unnamed)', email, mobile });
    }
    if (ref) legacyParentRef.set(ref, key);
  }

  // ------------------------------------------------------------ 2. players
  const players: any[] = [];
  const ageCodes = new Map<string, number>();
  const programmes = new Map<string, string>();
  let orphanPlayers = 0, missingDob = 0, ageMismatches = 0;

  for (const r of playerRows) {
    const pref = pick(r, 'Player No', 'playerref', 'id');
    const parentRef = pick(r, 'Parent No', 'PR NO', 'parentref');
    const full = normaliseName(pick(r, 'Player Name', 'name', 'fullname'));
    const dob = normaliseDate(pick(r, 'DOB', 'Date Of Birth', 'dateofbirth', 'birthdate'));
    const genderRaw = pick(r, 'Gender', 'sex');
    const category = pick(r, 'Category', 'Age Category', 'agegroup');
    const status = pick(r, 'Status', 'playerstatus');
    const team = pick(r, 'Team');
    const termLabel = pick(r, 'Term/League', 'Term', 'Programme', 'Program');

    if (!full) { err('players', 'Row has no player name — skipped', r); continue; }

    const gkey = legacyParentRef.get(parentRef);
    if (!gkey) { orphanPlayers++; err('players', `"${full}" references parent "${parentRef}" which is not in parents.csv`); continue; }
    if (!dob) { missingDob++; warn('players', `"${full}" has no usable date of birth — age group cannot be derived`); }

    const parsed = parseAgeCategory(category);
    if (parsed.code) ageCodes.set(parsed.code, (ageCodes.get(parsed.code) || 0) + 1);
    else if (category) warn('players', `Could not parse age category "${category}" for "${full}"`);

    let gender: Gender | null = null;
    const g = genderRaw.trim().toLowerCase();
    if (g.startsWith('m')) gender = Gender.MALE;
    else if (g.startsWith('f')) gender = Gender.FEMALE;
    else if (parsed.gender) gender = parsed.gender;   // recovered from "Girl U-15"
    if (!gender) { gender = Gender.MALE; warn('players', `No gender for "${full}" — defaulted to MALE, please review`); }

    // Reconcile the legacy age label against the date of birth. The audit found
    // these were typed by hand and frequently wrong; surface every disagreement
    // rather than importing a bad band silently.
    let derivedCode: string | null = null;
    if (dob) {
      // Same play-up rule as live registration, so imported and new children agree.
      derivedCode = placeInCategory(deriveAgeGroupCode(dob, seasonCutoff), ACADEMY_CATEGORIES).code;
      if (parsed.code && derivedCode !== parsed.code) {
        ageMismatches++;
        warn('players', `"${full}" — legacy category "${category}" but date of birth ${dob} implies ${derivedCode}` +
          (deriveAge ? ` (using ${derivedCode})` : ` (keeping ${parsed.code}; re-run with --derive-age to trust the DOB)`));
      }
    }

    if (termLabel) programmes.set(termLabel, classifyProgramme(termLabel));

    const [firstName, ...rest] = full.split(' ');
    players.push({
      ref: pref, gkey, firstName, lastName: rest.join(' ') || firstName,
      gender, dob, ageCode: parsed.code, level: parsed.level,
      derivedCode,
      status: mapPlayerStatus(status), team, termLabel,
      kitSize: pick(r, 'Kit Size', 'kitsize') || null,
    });
  }

  // ----------------------------------------------------------- 3. invoices
  const invoices: any[] = [];
  let invOrphans = 0, unmatchedMethod = 0, reconciled = 0, mismatched = 0;

  for (const r of invoiceRows) {
    const num = pick(r, 'Invoice No', 'invoiceno', 'number');
    const parentRef = pick(r, 'Parent No', 'PR NO', 'parentref');
    const gkey = legacyParentRef.get(parentRef);
    if (!gkey) { invOrphans++; err('invoices', `Invoice "${num}" references parent "${parentRef}" which is not in parents.csv`); continue; }

    const total = normaliseMoney(pick(r, 'Total Amount Including VAT', 'totalinclvat', 'total', 'amount'));
    const received = normaliseMoney(pick(r, 'Amount Received Including VAT', 'amountreceived', 'paid')) ?? 0;
    const vat = normaliseMoney(pick(r, 'VAT Amount', 'vat')) ?? 0;
    const methodRaw = pick(r, 'Payment Method', 'method');
    const method = normalisePaymentMethod(methodRaw);
    if (methodRaw && !method) { unmatchedMethod++; warn('invoices', `Unrecognised payment method "${methodRaw}" on ${num}`); }

    if (total == null) { err('invoices', `Invoice "${num}" has no total — skipped`, r); continue; }

    const declared = mapInvoiceStatus(pick(r, 'Payment Status', 'status'));
    // Reconciliation: does the declared status agree with the money?
    const impliedPaid = received >= total - 0.05;
    if ((declared === 'PAID') !== impliedPaid && declared !== 'SPONSORED' && declared !== 'CANCELLED') {
      mismatched++;
      warn('invoices', `${num}: legacy status "${declared}" disagrees with amounts (received ${received} of ${total}) — status will be recomputed from payments`);
    } else reconciled++;

    invoices.push({
      number: num, gkey, total, received, vat, method,
      issueDate: normaliseDate(pick(r, 'Invoice Date', 'invoicedate', 'date')),
      paymentDate: normaliseDate(pick(r, 'Payment Date', 'paymentdate')),
      description: pick(r, 'Subscription Details', 'description', 'details') || 'Legacy invoice',
      declared,
    });
  }

  // ------------------------------------------------------------- 4. report
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warn');

  console.log('\n─────────────── Migration report ───────────────');
  console.log(`Guardians      ${guardians.size} unique  (${dupes} duplicate row(s) merged)`);
  console.log(`Players        ${players.length} importable  (${orphanPlayers} orphaned, ${missingDob} without DOB)`);
  console.log(`               ${ageMismatches} legacy age label(s) disagree with the date of birth` +
    (ageMismatches ? (deriveAge ? ' — using the DOB' : ' — keeping the legacy label (--derive-age to override)') : ''));
  console.log(`Invoices       ${invoices.length} importable  (${invOrphans} orphaned)`);
  console.log(`               ${reconciled} reconcile cleanly, ${mismatched} status/amount mismatches`);
  if (ageCodes.size) {
    console.log(`Age groups     ${[...ageCodes.entries()].sort().map(([c, n]) => `${c}(${n})`).join(' ')}`);
  }
  if (programmes.size) {
    const byType: Record<string, string[]> = {};
    programmes.forEach((t, name) => (byType[t] = byType[t] || []).push(name));
    console.log('Programmes split out of the legacy "term" field:');
    Object.entries(byType).forEach(([t, names]) =>
      console.log(`   ${t.padEnd(6)} ${names.length}  e.g. ${names.slice(0, 3).join(' | ')}`));
  }
  console.log(`\nErrors ${errors.length} · Warnings ${warnings.length}`);
  const show = (list: Issue[], n: number) =>
    list.slice(0, n).forEach((i) => console.log(`   [${i.area}] ${i.message}`));
  if (errors.length) { console.log('\nErrors (these rows will NOT import):'); show(errors, 15);
    if (errors.length > 15) console.log(`   … and ${errors.length - 15} more`); }
  if (warnings.length) { console.log('\nWarnings (imported, but review):'); show(warnings, 15);
    if (warnings.length > 15) console.log(`   … and ${warnings.length - 15} more`); }

  const reportPath = path.join(dir, 'migration-report.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    generatedAt: new Date().toISOString(), mode: commit ? 'commit' : 'dry-run',
    counts: { guardians: guardians.size, duplicatesMerged: dupes, players: players.length,
      orphanPlayers, missingDob, ageMismatches, invoices: invoices.length, invOrphans, reconciled, mismatched },
    ageGroups: Object.fromEntries(ageCodes), programmes: Object.fromEntries(programmes), issues,
  }, null, 2));
  console.log(`\nFull report written to ${reportPath}`);

  if (!commit) {
    console.log('\nDRY RUN — nothing was written. Re-run with --commit once the report looks right.\n');
    return;
  }
  if (errors.length) {
    console.log(`\n${errors.length} error(s) present. Fix the source data, or re-run with --commit --force to import the valid rows only.`);
    if (!process.argv.includes('--force')) return;
  }

  // ------------------------------------------------------------- 5. commit
  const ds = await AppDataSource.initialize();
  console.log('\nImporting…');
  const gRepo = ds.getRepository(Guardian);
  const pRepo = ds.getRepository(Player);
  const wRepo = ds.getRepository(Wallet);
  const agRepo = ds.getRepository(AgeGroup);
  const invRepo = ds.getRepository(Invoice);
  const lineRepo = ds.getRepository(InvoiceLineItem);
  const payRepo = ds.getRepository(Payment);

  const ageByCode = new Map((await agRepo.find()).map((a) => [a.code, a]));
  const gIdByKey = new Map<string, string>();

  let prSeq = (await gRepo.count()) + 1;
  for (const g of guardians.values()) {
    // Match an already-present guardian on email first, then mobile — the legacy
    // export often carries a different address for the same family.
    let existing = g.email ? await gRepo.findOne({ where: { email: g.email } }) : null;
    if (!existing && g.mobile) existing = await gRepo.findOne({ where: { mobile: g.mobile } });
    if (existing) warn('parents', `"${g.name}" matched an existing record (${existing.reference}) — reused, not duplicated`);
    if (existing) { gIdByKey.set(g.key, existing.id); continue; }
    const saved = await gRepo.save(gRepo.create({
      reference: makeReference('PR', prSeq++), fullName: g.name,
      email: g.email ?? `legacy-${prSeq}@import.local`,
      mobile: g.mobile ?? '', emirate: 'Abu Dhabi',
    }));
    await wRepo.save(wRepo.create({ guardianId: saved.id, balance: '0' }));
    gIdByKey.set(g.key, saved.id);
  }
  console.log(`   guardians: ${gIdByKey.size}`);

  let plSeq = (await pRepo.count()) + 1;
  let playersSaved = 0;
  for (const p of players) {
    const guardianId = gIdByKey.get(p.gkey);
    if (!guardianId) continue;
    await pRepo.save(pRepo.create({
      reference: makeReference('PL', plSeq++), guardianId,
      firstName: p.firstName, lastName: p.lastName, gender: p.gender,
      dateOfBirth: p.dob ?? '2015-01-01',
      status: p.status, kitSize: p.kitSize ?? undefined,
      ageGroupId: (() => {
        const code = deriveAge ? (p.derivedCode ?? p.ageCode) : (p.ageCode ?? p.derivedCode);
        return code ? ageByCode.get(code)?.id : undefined;
      })(),
      // Only a legacy label that contradicts the DOB counts as a manual override.
      ageGroupOverride: !deriveAge && !!p.ageCode && p.ageCode !== p.derivedCode,
    }));
    playersSaved++;
  }
  console.log(`   players: ${playersSaved}`);

  let laSeq = (await invRepo.count()) + 1;
  let invSaved = 0;
  for (const i of invoices) {
    const guardianId = gIdByKey.get(i.gkey);
    if (!guardianId) continue;
    const net = Math.round((i.total - i.vat) * 100) / 100;
    const inv = await invRepo.save(invRepo.create({
      number: i.number || makeReference('LA', laSeq++, 4),
      guardianId, status: i.declared,
      issueDate: i.issueDate ?? undefined, dueDate: i.issueDate ?? undefined,
      subtotal: net.toFixed(2), vatTotal: i.vat.toFixed(2), total: i.total.toFixed(2),
      notes: 'Imported from the legacy system',
    }));
    await lineRepo.save(lineRepo.create({
      invoiceId: inv.id, description: i.description,
      unitAmount: net.toFixed(2), vatRate: '5.00', lineTotal: net.toFixed(2),
    }));
    if (i.received > 0) {
      await payRepo.save(payRepo.create({
        invoiceId: inv.id, direction: PaymentDirection.INBOUND,
        amount: i.received.toFixed(2), method: i.method ?? 'BANK_TRANSFER' as any,
        status: PaymentStatus.COMPLETED,
        paidAt: i.paymentDate ? new Date(i.paymentDate) : new Date(),
        notes: 'Imported from the legacy system',
      }));
      await invRepo.update(inv.id, { amountPaid: i.received.toFixed(2) });
    }
    invSaved++;
  }
  console.log(`   invoices: ${invSaved} (statuses will be recomputed from the ledger)`);

  await ds.query(`SELECT setval('guardian_ref_seq', ${prSeq - 1}, true)`).catch(() => {});
  await ds.query(`SELECT setval('player_ref_seq', ${plSeq - 1}, true)`).catch(() => {});
  await ds.destroy();
  console.log('\nImport complete. Historical records preserved; nothing was overwritten.\n');
}

run().catch((e) => { console.error(e); process.exit(1); });
