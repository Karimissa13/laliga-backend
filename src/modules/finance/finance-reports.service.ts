import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { InstalmentsService } from './instalments.service';
import { DataSource } from 'typeorm';
import { PaymentMethod } from '../../database/entities';
import { PACKAGE_LABEL } from './pricing';

const money = (n: number) => Math.round(n * 100) / 100;

/** How each method reads on reports. ONLINE is the payment link. */
export const METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash', CHEQUE: 'Cheque', CARD: 'Credit card', ONLINE: 'Payment link',
  BANK_TRANSFER: 'Bank transfer', WALLET: 'Wallet',
};

/**
 * Direct money: what actually reached the academy. Wallet use (credit moved
 * from one invoice to another, sibling credits) and write-offs are NOT money
 * received and never count here.
 */
export const DIRECT_METHODS: PaymentMethod[] = [
  PaymentMethod.CASH, PaymentMethod.CARD, PaymentMethod.ONLINE, PaymentMethod.BANK_TRANSFER, PaymentMethod.CHEQUE,
];

/** Where an invoice "is": the team of its enrolment, else the child's current team. */
const LOCATION_SQL = (i: string) => `COALESCE(
  (SELECT t."locationId" FROM enrolments e JOIN teams t ON t.id = e."teamId" WHERE e."invoiceId" = ${i}.id LIMIT 1),
  (SELECT t."locationId" FROM invoice_line_items li JOIN players p ON p.id = li."playerId"
     JOIN teams t ON t.id = p."currentTeamId" WHERE li."invoiceId" = ${i}.id LIMIT 1))`;

const PLAYERS_SQL = (i: string) => `(SELECT COALESCE(json_agg(x ORDER BY x->>'ref'), '[]') FROM (
  SELECT DISTINCT jsonb_build_object('id', pl.id, 'ref', pl.reference, 'name', pl."firstName" || ' ' || pl."lastName",
                                     'category', ag.code) AS x
  FROM invoice_line_items li JOIN players pl ON pl.id = li."playerId" LEFT JOIN age_groups ag ON ag.id = pl."ageGroupId"
  WHERE li."invoiceId" = ${i}.id) s)`;

const BALANCE_SQL = (i: string) =>
  `GREATEST(${i}.total - ${i}."amountPaid" + ${i}."amountRefunded" - ${i}."writeOffAmount", 0)`;

/** Direct money received on an invoice, net of refunds paid back as money. */
const RECEIVED_SQL = (i: string) => `COALESCE((SELECT sum(CASE WHEN p.direction = 'INBOUND' THEN p.amount ELSE -p.amount END)
  FROM payments p WHERE p."invoiceId" = ${i}.id AND p.status = 'COMPLETED' AND p.method <> 'WALLET'), 0)`;
/** Wallet credit used to pay an invoice (less any refund back to the wallet). */
const WALLET_SQL = (i: string) => `COALESCE((SELECT sum(CASE WHEN p.direction = 'INBOUND' THEN p.amount ELSE -p.amount END)
  FROM payments p WHERE p."invoiceId" = ${i}.id AND p.status = 'COMPLETED' AND p.method = 'WALLET'), 0)`;

export interface PaymentReportFilter {
  from?: string; to?: string; method?: string; merchantId?: string; locationId?: string;
  search?: string; includeWallet?: boolean;
}

export interface InvoiceRegisterFilter {
  keyword?: string; invoiceNo?: string; playerNo?: string; parentNo?: string;
  status?: string; method?: string; additional?: 'only' | 'exclude'; custom?: 'only' | 'exclude';
  ageGroupId?: string; locationId?: string; termId?: string;
  invoiceFrom?: string; invoiceTo?: string; paymentFrom?: string; paymentTo?: string;
  amountFrom?: number; amountTo?: number;
  page?: number; limit?: number;
}

/**
 * Read models for the finance screens: the Payment Report (one row per money
 * movement) and the invoice register (one row per invoice, every legacy
 * column, the legacy search). Parameterised SQL only.
 */
@Injectable()
export class FinanceReportsService {
  constructor(@InjectDataSource() private readonly ds: DataSource, private readonly instalments: InstalmentsService) {}

  // ---------------------------------------------------------- payment report

  async paymentReport(f: PaymentReportFilter) {
    const params: any[] = [];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const where: string[] = [`pay.status = 'COMPLETED'`, `i.status <> 'DRAFT'`];
    if (f.from) where.push(`pay."paidAt" >= ${p(f.from)}::date`);
    if (f.to) where.push(`pay."paidAt" < ${p(f.to)}::date + 1`);
    if (f.method) where.push(`pay.method = ${p(f.method)}`);
    if (f.includeWallet === false) where.push(`pay.method <> 'WALLET'`);
    if (f.merchantId) where.push(`pay."merchantId" = ${p(f.merchantId)}`);
    if (f.search) {
      const s = p(`%${f.search.trim()}%`);
      where.push(`(i.number ILIKE ${s} OR pay.reference ILIKE ${s} OR g.reference ILIKE ${s} OR g."fullName" ILIKE ${s}
        OR EXISTS (SELECT 1 FROM invoice_line_items li JOIN players pl ON pl.id = li."playerId"
                   WHERE li."invoiceId" = i.id AND (pl.reference ILIKE ${s} OR (pl."firstName" || ' ' || pl."lastName") ILIKE ${s})))`);
    }
    const rows: any[] = await this.ds.query(`
      SELECT * FROM (
        SELECT pay.id, pay."paidAt", pay.method, pay.direction, pay.amount::float AS amount, pay.reference,
               pay."merchantName", pay."merchantNumber", pay.notes,
               i.id AS "invoiceId", i.number AS "invoiceNumber", i.status AS "invoiceStatus",
               ${BALANCE_SQL('i')}::float AS balance,
               g.id AS "guardianId", g.reference AS "parentRef", g."fullName" AS "parentName",
               ${PLAYERS_SQL('i')} AS players,
               ${LOCATION_SQL('i')} AS "locationId"
        FROM payments pay
        JOIN invoices i ON i.id = pay."invoiceId"
        JOIN guardians g ON g.id = i."guardianId"
        WHERE ${where.join(' AND ')}
      ) r
      LEFT JOIN (SELECT id AS lid, name AS location FROM locations) l ON l.lid = r."locationId"
      ${f.locationId ? `WHERE r."locationId" = ${p(f.locationId)}` : ''}
      ORDER BY r."paidAt" ASC, r."invoiceNumber" ASC
      LIMIT 5000`, params);

    let received = 0, wallet = 0;
    const balances = new Map<string, number>();
    const out = rows.map((r, idx) => {
      const sign = r.direction === 'REFUND' ? -1 : 1;
      const isWallet = r.method === PaymentMethod.WALLET;
      const rec = isWallet ? 0 : money(sign * r.amount);
      const wal = isWallet ? money(sign * r.amount) : 0;
      received += rec; wallet += wal;
      balances.set(r.invoiceId, r.balance);
      return {
        sl: idx + 1,
        id: r.id,
        date: r.paidAt,
        method: r.method,
        methodLabel: (r.direction === 'REFUND' ? 'Refund — ' : '') + (METHOD_LABEL[r.method] ?? r.method),
        direction: r.direction,
        merchant: r.merchantName ?? null,
        merchantId: r.merchantNumber ?? null,
        reference: r.reference ?? null,
        location: r.location ? String(r.location).replace(/^Abu Dhabi\s*-\s*/i, '') : null,
        players: r.players,
        invoice: { id: r.invoiceId, number: r.invoiceNumber, status: r.invoiceStatus },
        parent: { id: r.guardianId, ref: r.parentRef, name: r.parentName },
        received: rec,
        wallet: wal,
        balance: money(r.balance),
        notes: r.notes ?? null,
      };
    });
    return {
      rows: out,
      totals: {
        count: out.length,
        received: money(received),
        wallet: money(wallet),
        balance: money([...balances.values()].reduce((s, b) => s + b, 0)),
        invoices: balances.size,
      },
      truncated: rows.length >= 5000,
    };
  }

  // -------------------------------------------------------- invoice register

  private registerWhere(f: InvoiceRegisterFilter) {
    const params: any[] = [];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const w: string[] = [];
    const like = (v: string) => p(`%${v.trim()}%`);
    if (f.keyword) {
      const s = like(f.keyword);
      w.push(`(i.number ILIKE ${s} OR g."fullName" ILIKE ${s} OR g.email ILIKE ${s} OR g.mobile ILIKE ${s} OR g.reference ILIKE ${s}
        OR i.notes ILIKE ${s} OR EXISTS (SELECT 1 FROM invoice_line_items li LEFT JOIN players pl ON pl.id = li."playerId"
          WHERE li."invoiceId" = i.id AND (li.description ILIKE ${s} OR pl.reference ILIKE ${s}
            OR (pl."firstName" || ' ' || pl."lastName") ILIKE ${s})))`);
    }
    // The LA / PL / PR boxes take just the number, as on the old screen.
    const num = (v: string) => v.trim().replace(/^(LA|PL|PR)-?/i, '');
    if (f.invoiceNo) w.push(`regexp_replace(i.number, '^LA-0*', '') = regexp_replace(${p(num(f.invoiceNo))}, '^0*', '')`);
    if (f.parentNo) w.push(`regexp_replace(g.reference, '^PR-0*', '') = regexp_replace(${p(num(f.parentNo))}, '^0*', '')`);
    if (f.playerNo) {
      w.push(`EXISTS (SELECT 1 FROM invoice_line_items li JOIN players pl ON pl.id = li."playerId" WHERE li."invoiceId" = i.id
        AND regexp_replace(pl.reference, '^PL-0*', '') = regexp_replace(${p(num(f.playerNo))}, '^0*', ''))`);
    }
    if (f.status === 'OVERDUE') w.push(`(i.status IN ('ISSUED', 'PART_PAID') AND i."dueDate" < CURRENT_DATE)`);
    else if (f.status) w.push(`i.status = ${p(f.status)}`);
    if (f.method) w.push(`EXISTS (SELECT 1 FROM payments x WHERE x."invoiceId" = i.id AND x.status = 'COMPLETED' AND x.method = ${p(f.method)})`);
    if (f.additional === 'only') w.push(`i.type = 'ADDITIONAL'`);
    if (f.additional === 'exclude') w.push(`i.type <> 'ADDITIONAL'`);
    if (f.custom === 'only') w.push(`i.type = 'CUSTOM'`);
    if (f.custom === 'exclude') w.push(`i.type <> 'CUSTOM'`);
    if (f.ageGroupId) w.push(`EXISTS (SELECT 1 FROM invoice_line_items li JOIN players pl ON pl.id = li."playerId" WHERE li."invoiceId" = i.id AND pl."ageGroupId" = ${p(f.ageGroupId)})`);
    if (f.termId) w.push(`EXISTS (SELECT 1 FROM enrolments e WHERE e."invoiceId" = i.id AND e."termId" = ${p(f.termId)})`);
    if (f.locationId) w.push(`${LOCATION_SQL('i')} = ${p(f.locationId)}`);
    if (f.invoiceFrom) w.push(`i."issueDate" >= ${p(f.invoiceFrom)}::date`);
    if (f.invoiceTo) w.push(`i."issueDate" <= ${p(f.invoiceTo)}::date`);
    if (f.paymentFrom || f.paymentTo) {
      const c: string[] = [`x."invoiceId" = i.id`, `x.status = 'COMPLETED'`];
      if (f.paymentFrom) c.push(`x."paidAt" >= ${p(f.paymentFrom)}::date`);
      if (f.paymentTo) c.push(`x."paidAt" < ${p(f.paymentTo)}::date + 1`);
      w.push(`EXISTS (SELECT 1 FROM payments x WHERE ${c.join(' AND ')})`);
    }
    if (f.amountFrom != null && !Number.isNaN(f.amountFrom)) w.push(`i.total >= ${p(f.amountFrom)}`);
    if (f.amountTo != null && !Number.isNaN(f.amountTo)) w.push(`i.total <= ${p(f.amountTo)}`);
    return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params, p };
  }

  async invoiceRegister(f: InvoiceRegisterFilter, opts: { all?: boolean } = {}) {
    const { where, params, p } = this.registerWhere(f);
    const limit = opts.all ? 10000 : Math.min(Math.max(f.limit ?? 50, 1), 200);
    const page = Math.max(f.page ?? 1, 1);
    const base = `FROM invoices i JOIN guardians g ON g.id = i."guardianId" ${where}`;
    const [tot] = await this.ds.query(`
      SELECT count(*)::int AS n, COALESCE(sum(i.total), 0)::float AS total,
             COALESCE(sum(${RECEIVED_SQL('i')}), 0)::float AS received,
             COALESCE(sum(${WALLET_SQL('i')}), 0)::float AS wallet,
             COALESCE(sum(CASE WHEN i.status IN ('ISSUED', 'PART_PAID') THEN ${BALANCE_SQL('i')} ELSE 0 END), 0)::float AS pending,
             COALESCE(sum(i."writeOffAmount"), 0)::float AS "writeOff",
             COALESCE(sum(i."amountRefunded"), 0)::float AS refunded
      ${base}`, params);
    const rows: any[] = await this.ds.query(`
      SELECT i.id, i.number, i.type, i.status, i."issueDate"::text AS "issueDate", i."dueDate"::text AS "dueDate",
             i.subtotal::float AS subtotal, i."discountTotal"::float AS "discountTotal", i."vatTotal"::float AS "vatTotal",
             i.total::float AS total, i."amountPaid"::float AS "amountPaid", i."amountRefunded"::float AS refunded,
             i."writeOffAmount"::float AS "writeOff", i."writeOffReason", i.installments, i.notes,
             ${BALANCE_SQL('i')}::float AS balance,
             ${RECEIVED_SQL('i')}::float AS received,
             ${WALLET_SQL('i')}::float AS wallet,
             g.id AS "guardianId", g.reference AS "parentRef", g."fullName" AS "parentName", g.email, g.mobile,
             ${PLAYERS_SQL('i')} AS players,
             (SELECT json_agg(json_build_object('description', li.description, 'package', li.package, 'stream', li.stream) ORDER BY li."createdAt")
                FROM invoice_line_items li WHERE li."invoiceId" = i.id) AS lines,
             (SELECT json_agg(DISTINCT jsonb_build_object('term', tr.name, 'start', tr."startDate"::text, 'end', tr."endDate"::text, 'season', s.name))
                FROM enrolments e JOIN terms tr ON tr.id = e."termId" JOIN seasons s ON s.id = e."seasonId" WHERE e."invoiceId" = i.id) AS terms,
             (SELECT max(x."paidAt") FROM payments x WHERE x."invoiceId" = i.id AND x.status = 'COMPLETED' AND x.direction = 'INBOUND') AS "lastPaymentAt",
             (SELECT string_agg(DISTINCT x.method::text, ',') FROM payments x WHERE x."invoiceId" = i.id AND x.status = 'COMPLETED' AND x.direction = 'INBOUND') AS methods,
             (SELECT count(*)::int FROM payments x WHERE x."invoiceId" = i.id AND x.status = 'COMPLETED' AND x.direction = 'INBOUND' AND x.method <> 'WALLET') AS "paymentsCount",
             (SELECT string_agg(x.notes, ' · ') FROM payments x WHERE x."invoiceId" = i.id AND x.direction = 'REFUND' AND x.notes IS NOT NULL) AS "refundReason",
             (SELECT max(c."sentAt") FROM communications c WHERE c.kind = 'invoice' AND c.attachments @> jsonb_build_array(jsonb_build_object('id', i.id::text))) AS "emailedAt",
             (SELECT l.name FROM locations l WHERE l.id = ${LOCATION_SQL('i')}) AS location
      ${base}
      ORDER BY i."createdAt" DESC
      LIMIT ${p(limit)} OFFSET ${p((page - 1) * limit)}`, params);

    const vatPart = (incl: number) => money(incl - incl / 1.05);
    const plans = await this.instalments.countsFor(rows.map((r: any) => r.id));
    const data = rows.map((r) => {
      const pending = ['ISSUED', 'PART_PAID'].includes(r.status) ? money(r.balance) : 0;
      const paidPayments = r.paymentsCount ?? 0;
      return {
        id: r.id, number: r.number, type: r.type, status: r.status,
        overdue: ['ISSUED', 'PART_PAID'].includes(r.status) && !!r.dueDate && r.dueDate < new Date().toISOString().slice(0, 10),
        issueDate: r.issueDate, dueDate: r.dueDate,
        parent: { id: r.guardianId, ref: r.parentRef, name: r.parentName, email: r.email, mobile: r.mobile },
        players: r.players, playersCount: (r.players || []).length,
        subscription: this.subscriptionText(r),
        location: r.location ? String(r.location).replace(/^Abu Dhabi\s*-\s*/i, '') : null,
        totalInclVat: money(r.total), totalExclVat: money(r.total - r.vatTotal), vat: money(r.vatTotal),
        discount: money(r.discountTotal),
        refunded: money(r.refunded), refundReason: r.refundReason ?? null,
        writeOff: money(r.writeOff), writeOffReason: r.writeOffReason ?? null,
        received: money(r.received), vatOnReceived: vatPart(r.received), netReceived: money(r.received - vatPart(r.received)),
        wallet: money(r.wallet),
        pending, vatOnPending: vatPart(pending), netPending: money(pending - vatPart(pending)),
        installments: plans.get(r.id) ?? { total: 1, paid: Math.min(paidPayments, 1), pending: Math.max(0, 1 - paidPayments) },
        hasPlan: plans.has(r.id),
        lastPaymentAt: r.lastPaymentAt, methods: r.methods ? String(r.methods).split(',').map((m) => METHOD_LABEL[m] ?? m) : [],
        additional: r.type === 'ADDITIONAL', custom: r.type === 'CUSTOM',
        emailedAt: r.emailedAt ?? null,
      };
    });
    return {
      data,
      meta: { total: tot.n, page, limit, pages: Math.max(1, Math.ceil(tot.n / limit)) },
      totals: {
        count: tot.n, total: money(tot.total), received: money(tot.received), wallet: money(tot.wallet),
        pending: money(tot.pending), writeOff: money(tot.writeOff), refunded: money(tot.refunded),
      },
    };
  }

  private subscriptionText(r: any): string {
    const players = (r.players || []) as Array<{ name: string }>;
    const terms = ((r.terms || []) as Array<{ term: string; start: string; end: string; season: string }>)
      .sort((a, b) => a.start.localeCompare(b.start));
    const pkg = (r.lines || []).find((l: any) => l.package)?.package as keyof typeof PACKAGE_LABEL | undefined;
    const fmt = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    if (terms.length) {
      const label = pkg ? PACKAGE_LABEL[pkg] : terms.map((t) => t.term).join(', ');
      return `${players.map((p) => p.name).join(', ')} — ${terms[0].season} ${label} · ${fmt(terms[0].start)} – ${fmt(terms[terms.length - 1].end)}`;
    }
    return (r.lines || []).map((l: any) => l.description).join('; ');
  }

  // ----------------------------------------------------------------- CSV

  static toCsv(header: string[], rows: Array<Array<string | number | null | undefined>>): string {
    const cell = (v: any) => {
      if (v == null) return '';
      const s = String(v);
      // Keep Excel from treating =, +, -, @ as a formula (CSV injection).
      const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
      return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  }
}
