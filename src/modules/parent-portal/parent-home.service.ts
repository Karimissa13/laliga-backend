import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { summarisePurchases } from '../registration/purchases';
import { InstalmentsService } from '../finance/instalments.service';
import { invoicePurpose } from '../finance/invoice-purpose';
import { invoiceStatusLabel } from '../finance/payment-state';
import { slotLabel } from '../teams/team-label';
import { dubaiWeekday, daysText } from '../player-desk/training-days';
import { dubaiToday } from '../../common/dubai-date';

const r2 = (n: number) => Math.round(n * 100) / 100;

/** What a wallet entry was, in the parent's words (staff notes are never shown). */
const WALLET_WHAT: Record<string, string> = {
  REFUND: 'Refund into your wallet', OVERPAYMENT: 'Overpayment kept as credit', SIBLING: 'Sibling discount credit',
  CREDIT: 'Credit from the academy', DEBIT: 'Adjustment', INVOICE_PAYMENT: 'Used to pay an invoice',
  CANCELLATION: 'Credit cancelled', PAYMENT_REVERSAL: 'Wallet payment returned',
};
/** Emails the parent was sent that are worth listing on Home (never sign-in or password emails). */
const EMAIL_KINDS = ['invoice', 'reminder', 'report', 'payment_link', 'registered'];

/** Document types a parent can upload for a child (as on the old portal). */
export const PARENT_DOC_TYPES = ['PHOTO', 'EMIRATES_ID_FRONT', 'EMIRATES_ID_BACK', 'MEDICAL_INSURANCE'] as const;

/**
 * Everything the parent portal shows, in one call (Karim, 17 Oct 2026): Home (what is owed and
 * when, each child's next training, notifications), Children, Payments (invoices with their
 * instalments inside), wallet history and profile. View only — no bookings, no Pay button yet.
 */
@Injectable()
export class ParentHomeService {
  constructor(private readonly ds: DataSource, private readonly instalments: InstalmentsService) {}

  async home(guardianId: string) {
    const [g] = await this.ds.query(
      `SELECT g.id, g."fullName" AS name, g.reference, g.email, g."secondaryEmail", g."secondaryEmailName", g.mobile,
              g.nationality, g.area, g.address, g.emirate, g.city, COALESCE(w.balance, 0)::float AS wallet, w.id AS "walletId"
       FROM guardians g LEFT JOIN wallets w ON w."guardianId" = g.id WHERE g.id = $1`, [guardianId]);
    if (!g) throw new NotFoundException();
    const today = dubaiToday();

    // ---- children
    const kids: any[] = await this.ds.query(
      `SELECT p.id, p."firstName", p."lastName", p.reference, p."dateOfBirth"::text AS dob, ag.code AS category,
              t.id AS "teamId", t.name AS team, t.level, t."trainingDays"::text[] AS "teamDays", t."startTime"::text AS "startTime", t."endTime"::text AS "endTime",
              l.name AS location, cu."fullName" AS coach
       FROM players p LEFT JOIN age_groups ag ON ag.id = p."ageGroupId" LEFT JOIN teams t ON t.id = p."currentTeamId"
       LEFT JOIN locations l ON l.id = t."locationId" LEFT JOIN coaches c ON c.id = t."headCoachId" LEFT JOIN users cu ON cu.id = c."userId"
       WHERE p."guardianId" = $1 AND p."archivedAt" IS NULL ORDER BY p."dateOfBirth"`, [guardianId]);
    const ids = kids.map((k) => k.id);
    const enrols: any[] = ids.length ? await this.ds.query(
      `SELECT e.id, e."playerId", e."termId", e.status, e."enrolledAt", e."invoiceId", e.package, e."sessionsPerWeek", e."movedFromId",
              e."trainingDays"::text[] AS "trainingDays", e."teamId",
              json_build_object('id', tm.id, 'name', tm.name, 'startDate', tm."startDate"::text, 'endDate', tm."endDate"::text) AS term,
              json_build_object('name', s.name) AS season, json_build_object('name', t.name, 'trainingDays', t."trainingDays"::text[]) AS team
       FROM enrolments e JOIN terms tm ON tm.id = e."termId" JOIN seasons s ON s.id = e."seasonId" LEFT JOIN teams t ON t.id = e."teamId"
       WHERE e."playerId" = ANY($1) AND e.status IN ('ACTIVE', 'PENDING', 'COMPLETED')`, [ids]) : [];
    const sessions: any[] = ids.length ? await this.ds.query(
      `SELECT s."teamId", s."startsAt", s."endsAt", s."termId", COALESCE(v.name, l.name) AS place
       FROM sessions s LEFT JOIN venues v ON v.id = s."venueId" LEFT JOIN locations l ON l.id = s."locationId"
       WHERE s."teamId" = ANY($1) AND s."startsAt" > now() AND s."isCancelled" = false
       ORDER BY s."startsAt" LIMIT 200`, [[...new Set(kids.map((k) => k.teamId).filter(Boolean))]]) : [];
    const reports: any[] = ids.length ? await this.ds.query(
      `SELECT e.id, e."playerId", e."sentAt", e."finalizedAt", tm.name AS term, s.name AS season
       FROM evaluations e LEFT JOIN terms tm ON tm.id = e."termId" LEFT JOIN seasons s ON s.id = tm."seasonId"
       WHERE e."playerId" = ANY($1) AND e."reportType" IS NOT NULL AND e.status = 'FINAL'
       ORDER BY tm."startDate" DESC NULLS LAST`, [ids]) : [];
    const docs: any[] = ids.length ? await this.ds.query(
      `SELECT DISTINCT ON (d."playerId", d.type) d.id, d."playerId", d.type, d."fileName", d."mimeType", d."createdAt"
       FROM documents d WHERE d."playerId" = ANY($1) AND d.type = ANY($2)
       ORDER BY d."playerId", d.type, d."createdAt" DESC`, [ids, [...PARENT_DOC_TYPES]]) : [];

    // ---- invoices (each once, instalments inside)
    const invRows: any[] = await this.ds.query(
      `SELECT i.id, i.number, i.status, i.purpose, i."issueDate"::text AS date, i."dueDate"::text AS "dueDate",
              i.total::float AS total, (i."amountPaid" - i."amountRefunded")::float AS paid, i."writeOffAmount"::float AS "writtenOff",
              GREATEST(i.total - i."amountPaid" - i."writeOffAmount", 0)::float AS balance,
              (SELECT json_agg(json_build_object('stream', li.stream, 'package', li.package)) FROM invoice_line_items li WHERE li."invoiceId" = i.id) AS lines,
              (SELECT array_agg(DISTINCT tm.type::text) FROM enrolments e JOIN terms tm ON tm.id = e."termId" WHERE e."invoiceId" = i.id) AS "termTypes",
              (SELECT array_agg(DISTINCT p."firstName") FROM invoice_line_items li JOIN players p ON p.id = li."playerId" WHERE li."invoiceId" = i.id) AS children,
              (SELECT array_agg(DISTINCT li."playerId") FROM invoice_line_items li WHERE li."invoiceId" = i.id AND li."playerId" IS NOT NULL) AS "childIds",
              (SELECT max(p."paidAt") FROM payments p WHERE p."invoiceId" = i.id AND p.direction = 'INBOUND' AND p.status = 'COMPLETED') AS "lastPaidAt"
       FROM invoices i WHERE i."guardianId" = $1 AND i.status NOT IN ('DRAFT', 'CANCELLED')
       ORDER BY i."issueDate" DESC NULLS LAST, i."createdAt" DESC`, [guardianId]);
    const invoices: any[] = [];
    for (const i of invRows) {
      const s = i.balance > 0.005 ? await this.instalments.summary(i.id) : null;
      const plan = s?.hasPlan ? s.instalments.map((v: any) => ({ seq: v.seq, dueDate: v.dueDate, amount: r2(v.amount), remaining: r2(v.remaining), state: v.state })) : [];
      const due = i.balance > 0.005
        ? (plan.find((v: any) => v.remaining > 0.005) ?? { dueDate: i.dueDate, remaining: i.balance, seq: null }) : null;
      const overdue = !!due && !!due.dueDate && due.dueDate < today;
      invoices.push({
        id: i.id, number: i.number, date: i.date, what: invoicePurpose(i.lines, i.purpose, i.termTypes),
        children: i.children ?? [], childIds: i.childIds ?? [], total: r2(i.total), paid: r2(i.paid), balance: r2(i.balance),
        state: i.balance <= 0.005 ? 'PAID' : overdue ? 'OVERDUE' : i.paid > 0.005 ? 'PART_PAID' : 'DUE',
        statusLabel: invoiceStatusLabel(i.status, s?.hasPlan ? { total: s.counts.total, paid: s.counts.paid } : null),
        lastPaidAt: i.lastPaidAt, opening: i.purpose === 'OPENING',
        next: due ? { seq: due.seq, of: plan.length || null, dueDate: due.dueDate, amount: r2(due.remaining), overdue } : null,
        instalments: plan,
      });
    }
    const open = invoices.filter((i) => i.next);
    const owedTotal = r2(open.reduce((a, i) => a + i.balance, 0));
    const nextDue = open.map((i) => ({ ...i.next, invoiceNumber: i.number, invoiceId: i.id }))
      .sort((a, b) => String(a.dueDate ?? '9999').localeCompare(String(b.dueDate ?? '9999')))[0] ?? null;

    const children = kids.map((k) => {
      const mine = enrols.filter((e) => e.playerId === k.id);
      const live = summarisePurchases(mine).filter((p) => ['ACTIVE', 'PENDING'].includes(p.status));
      const pu = live[0] ?? null;
      const ownDays = pu && pu.ownDays ? pu.trainingDays : null;
      const next = sessions.filter((s) => s.teamId === k.teamId && (!ownDays || ownDays.includes(dubaiWeekday(s.startsAt))))[0] ?? null;
      const myInv = invoices.filter((i) => i.childIds.includes(k.id));
      const pay = myInv.some((i) => i.state === 'OVERDUE') ? 'OVERDUE' : myInv.some((i) => i.next) ? 'DUE' : myInv.length ? 'PAID' : null;
      return {
        id: k.id, name: `${k.firstName} ${k.lastName}`, firstName: k.firstName, reference: k.reference, dob: k.dob,
        category: k.category, level: k.level, team: k.team, location: k.location, coach: k.coach,
        schedule: k.team ? slotLabel(k.teamDays, k.startTime, k.endTime) : null,
        ownDays: ownDays ? daysText(ownDays) : null,
        package: pu ? { label: pu.label, terms: pu.termsText, season: pu.season, sessionsPerWeek: pu.sessionsPerWeek, status: pu.status } : null,
        payment: pay,
        nextSession: next ? { startsAt: next.startsAt, endsAt: next.endsAt, place: next.place ?? k.location } : null,
        reports: reports.filter((r) => r.playerId === k.id).map((r) => ({ id: r.id, term: r.term, season: r.season, at: r.sentAt ?? r.finalizedAt })),
        documents: PARENT_DOC_TYPES.map((t) => {
          const d = docs.find((x) => x.playerId === k.id && x.type === t);
          return { type: t, id: d?.id ?? null, fileName: d?.fileName ?? null, at: d?.createdAt ?? null };
        }),
      };
    });

    // ---- wallet history (the parent's words, never staff notes)
    const wallet: any[] = g.walletId ? await this.ds.query(
      `SELECT wt."createdAt" AS at, wt.type, wt.amount::float AS amount, wt.kind, i.number AS invoice
       FROM wallet_transactions wt LEFT JOIN invoices i ON i.id = wt."invoiceId"
       WHERE wt."walletId" = $1 ORDER BY wt."createdAt" DESC LIMIT 50`, [g.walletId]) : [];

    // ---- notifications on Home
    const notes: Array<{ at: string; kind: string; text: string; ref?: string | null; [k: string]: any }> = [];
    for (const i of open) {
      const n = i.next;
      if (n.overdue) notes.push({ at: n.dueDate, kind: 'OVERDUE', ref: i.number, invoice: i.number, seq: n.seq, of: n.of, dueDate: n.dueDate, amount: n.amount, text: n.of ? `Instalment ${n.seq} of ${n.of} of ${i.number} was due on ${n.dueDate}` : `${i.number} was due on ${n.dueDate}` });
      else if (n.dueDate && n.dueDate <= addDays(today, 14)) notes.push({ at: n.dueDate, kind: 'DUE_SOON', ref: i.number, invoice: i.number, seq: n.seq, of: n.of, dueDate: n.dueDate, amount: n.amount, text: n.of ? `Instalment ${n.seq} of ${n.of} of ${i.number} is due on ${n.dueDate}` : `${i.number} is due on ${n.dueDate}` });
    }
    for (const r of reports) {
      const at = r.sentAt ?? r.finalizedAt;
      if (at && Date.now() - new Date(at).getTime() < 60 * 86400000) {
        const k = kids.find((x) => x.id === r.playerId);
        notes.push({ at: new Date(at).toISOString(), kind: 'REPORT', ref: r.id, child: k?.firstName ?? '', term: r.term ?? '', text: `${k?.firstName ?? ''}’s ${r.term ?? ''} report is ready` });
      }
    }
    const mails: any[] = await this.ds.query(
      `SELECT c."createdAt" AS at, c.kind, c.subject FROM communications c
       WHERE c."guardianId" = $1 AND c.kind = ANY($2) AND c.status <> 'FAILED' ORDER BY c."createdAt" DESC LIMIT 6`, [guardianId, EMAIL_KINDS]);
    for (const m of mails) notes.push({ at: new Date(m.at).toISOString(), kind: 'EMAIL', email: m.kind, text: m.subject });

    return {
      parent: { name: g.name, reference: g.reference, email: g.email, secondaryEmail: g.secondaryEmail, secondaryEmailName: g.secondaryEmailName,
        mobile: g.mobile, nationality: g.nationality, area: g.area, address: g.address, emirate: g.emirate, city: g.city },
      owed: { total: owedTotal, next: nextDue, overdue: open.some((i) => i.next.overdue) },
      children, invoices,
      wallet: { balance: r2(g.wallet), entries: wallet.map((w) => ({ at: w.at, type: w.type, amount: r2(w.amount), kind: w.kind, what: WALLET_WHAT[w.kind] ?? (w.type === 'CREDIT' ? 'Credit' : 'Used'), invoice: w.invoice })) },
      notifications: notes.sort((a, b) => (OVERDUE_FIRST(b) - OVERDUE_FIRST(a)) || String(b.at).localeCompare(String(a.at))).slice(0, 8),
    };
  }
}

const OVERDUE_FIRST = (n: { kind: string }) => (n.kind === 'OVERDUE' ? 2 : n.kind === 'DUE_SOON' ? 1 : 0);
function addDays(d: string, n: number) { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); }
