import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from '../../database/entities';
import { InstalmentsService } from '../finance/instalments.service';
import { SettingsService } from '../finance/settings.service';
import { brandLogo } from '../finance/invoice-pdf.service';
import { dubaiToday } from '../../common/dubai-date';
import { NotificationsService } from './notifications.service';
import {
  DEFAULT_REMINDER_WORDING, LOGO_CID, LOGO_PUBLIC_PATH, REMINDER_PLACEHOLDERS, ReminderFacts, ReminderKind, ReminderWording,
  paymentReminderEmail,
} from './reminder-email';

const r2 = (n: number) => Math.round(n * 100) / 100;
const OPEN = [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID];
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);

type Summary = { balance: number; hasPlan: boolean; instalments: Array<{ seq: number; dueDate: string; remaining: number }>; next: { seq: number; remaining: number; dueDate: string } | null };

/**
 * What a reminder asks for: on a plan, the instalments due by today (or, if none
 * yet, the next one); otherwise the invoice balance by its due date.
 */
export function dueNow(s: Summary, invoiceDueDate: string | null, today: string) {
  let what = 'Invoice balance', amount = s.balance, dueDate = invoiceDueDate;
  if (s.hasPlan) {
    const n = s.instalments.length;
    const due = s.instalments.filter((v) => v.remaining > 0.005 && v.dueDate <= today);
    if (due.length) {
      amount = r2(due.reduce((a, v) => a + v.remaining, 0)); dueDate = due[0].dueDate;
      what = due.length === 1 ? `Instalment ${due[0].seq} of ${n}` : `Instalments ${due[0].seq}–${due[due.length - 1].seq} of ${n}`;
    } else if (s.next) { amount = s.next.remaining; dueDate = s.next.dueDate; what = `Instalment ${s.next.seq} of ${n}`; }
  }
  const daysOverdue = dueDate && dueDate < today ? daysBetween(dueDate, today) : 0;
  return { what, amount, dueDate, daysOverdue, daysToDue: dueDate && dueDate >= today ? daysBetween(today, dueDate) : null };
}

/**
 * Payment reminders (Karim, Oct 2026): from an invoice ("Send reminder") or from
 * Communications → Payment reminders, which lists every invoice with money owed.
 * What is due now: on an instalment plan, the instalments due by today (or, if none
 * yet, the next one); otherwise the invoice balance. Past its due date the email is
 * the overdue version. Every reminder is in the email log (kind "reminder").
 */
@Injectable()
export class PaymentRemindersService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly instalments: InstalmentsService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------- wording

  async wording(): Promise<Record<ReminderKind, ReminderWording>> {
    const saved = await this.settings.get<Partial<Record<ReminderKind, Partial<ReminderWording>>>>('reminderWording', {});
    return {
      friendly: { ...DEFAULT_REMINDER_WORDING.friendly, ...(saved.friendly || {}) },
      overdue: { ...DEFAULT_REMINDER_WORDING.overdue, ...(saved.overdue || {}) },
    };
  }

  async setWording(w: Partial<Record<ReminderKind, Partial<ReminderWording>>>) {
    const cur = await this.wording();
    const clean = (x: Partial<ReminderWording> | undefined, d: ReminderWording): ReminderWording => ({
      subject: (x?.subject ?? d.subject).trim() || d.subject,
      heading: (x?.heading ?? d.heading).trim() || d.heading,
      intro: (x?.intro ?? d.intro).trim() || d.intro,
    });
    const next = { friendly: clean(w.friendly, cur.friendly), overdue: clean(w.overdue, cur.overdue) };
    await this.settings.set('reminderWording', next);
    return { ...next, defaults: DEFAULT_REMINDER_WORDING, placeholders: REMINDER_PLACEHOLDERS };
  }

  // ------------------------------------------------------------------ facts

  /** Everything a reminder says about one invoice. */
  async facts(invoiceId: string, kind?: ReminderKind): Promise<ReminderFacts & { invoiceId: string; guardianId: string; email: string | null }> {
    const inv = await this.invoices.findOne({ where: { id: invoiceId }, relations: { guardian: true, lineItems: { player: true } } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (!OPEN.includes(inv.status)) {
      throw new BadRequestException(`Invoice ${inv.number} is ${String(inv.status).toLowerCase().replace('_', ' ')} — there is nothing to remind about.`);
    }
    const s = await this.instalments.summary(inv.id);
    if (!(s.balance > 0.005)) throw new BadRequestException(`Invoice ${inv.number} has nothing left to pay.`);
    const { what, amount, dueDate, daysOverdue } = dueNow(s as Summary, inv.dueDate ? String(inv.dueDate).slice(0, 10) : null, dubaiToday());
    const [n, profile] = await Promise.all([this.settings.notifications(), this.settings.invoiceProfile()]);
    const children = [...new Set((inv.lineItems || []).map((l) => (l.player ? `${l.player.firstName} ${l.player.lastName}` : null)).filter(Boolean))].join(' and ');
    return {
      invoiceId: inv.id, guardianId: inv.guardianId, email: inv.guardian?.email ?? null,
      kind: kind ?? (daysOverdue > 0 ? 'overdue' : 'friendly'),
      parentName: inv.guardian?.fullName ?? 'Parent', children, invoiceNumber: inv.number, what, amountDue: amount, dueDate, daysOverdue,
      invoiceTotal: Number(inv.total), paidSoFar: r2(Number(inv.total) - s.balance), balance: s.balance,
      instalments: s.instalments.map((v: any) => ({ seq: v.seq, dueDate: v.dueDate, amount: v.amount, remaining: v.remaining, state: v.state })),
      portalUrl: n.portalUrl, academyName: profile.academyName, companyName: profile.companyName, replyTo: n.replyTo ?? null,
      bank: { accountName: profile.bank.accountName, bankName: profile.bank.bankName, iban: profile.bank.iban, accountNumber: profile.bank.accountNumber, swift: profile.bank.swift },
    };
  }

  /** The email as the parent will see it — nothing is sent. */
  async preview(invoiceId: string, kind?: ReminderKind) {
    const f = await this.facts(invoiceId, kind);
    const w = (await this.wording())[f.kind];
    const m = paymentReminderEmail(f, w, LOGO_PUBLIC_PATH);
    return { kind: f.kind, to: f.email, subject: m.subject, html: m.html, amountDue: f.amountDue, what: f.what, dueDate: f.dueDate, daysOverdue: f.daysOverdue };
  }

  /** Send one reminder (logged as kind "reminder"). */
  async send(invoiceId: string, opts: { kind?: ReminderKind } = {}) {
    const f = await this.facts(invoiceId, opts.kind);
    if (!f.email) throw new BadRequestException(`The parent on ${f.invoiceNumber} has no email address.`);
    const w = (await this.wording())[f.kind];
    const m = paymentReminderEmail(f, w);
    const logo = brandLogo();
    const r = await this.notifications.sendMessage({
      guardianId: f.guardianId, subject: m.subject, html: m.html, text: m.text, kind: 'reminder',
      ref: { type: 'invoice', id: f.invoiceId },
      inline: logo ? [{ filename: 'laliga-academy.png', content: logo, contentType: 'image/png', cid: LOGO_CID }] : undefined,
      logHtml: m.html.split(`cid:${LOGO_CID}`).join(LOGO_PUBLIC_PATH),
    });
    return { invoice: f.invoiceNumber, kind: f.kind, amountDue: f.amountDue, ...r };
  }

  /** Send to several invoices (up to 25 per call); one failure doesn't stop the rest. */
  async sendMany(ids: string[], opts: { kind?: ReminderKind } = {}) {
    if (ids.length > 25) throw new BadRequestException('Send at most 25 reminders at a time.');
    const results: any[] = [];
    for (const id of ids) {
      try { results.push({ invoiceId: id, ok: true, ...(await this.send(id, opts)) }); }
      catch (e: any) { results.push({ invoiceId: id, ok: false, error: e?.response?.message ?? e?.message }); }
    }
    return { sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  }

  // -------------------------------------------------------------------- list

  /**
   * Every invoice with money owed, for Communications → Payment reminders: what is
   * due now, how late, and when the family was last reminded.
   */
  async list(q: { show?: 'all' | 'overdue' | 'due7'; search?: string }) {
    const today = dubaiToday();
    const params: any[] = [];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const w = [`i.status IN ('ISSUED', 'PART_PAID')`,
      `GREATEST(i.total - i."amountPaid" - i."writeOffAmount", 0) > 0.05`];
    if (q.search) {
      const s = p(`%${q.search.trim()}%`);
      w.push(`(i.number ILIKE ${s} OR g."fullName" ILIKE ${s} OR g.reference ILIKE ${s} OR g.email ILIKE ${s}
        OR EXISTS (SELECT 1 FROM invoice_line_items li JOIN players pl ON pl.id = li."playerId" WHERE li."invoiceId" = i.id
          AND (pl."firstName" || ' ' || pl."lastName") ILIKE ${s}))`);
    }
    const rows: any[] = await this.ds.query(`
      SELECT i.id, i.number, i.status, i."dueDate"::text AS "dueDate", i.total::float AS total,
             GREATEST(i.total - i."amountPaid" - i."writeOffAmount", 0)::float AS balance,
             g.id AS "guardianId", g."fullName" AS parent, g.reference AS "parentRef", g.email,
             (SELECT string_agg(DISTINCT pl."firstName" || ' ' || pl."lastName", ', ') FROM invoice_line_items li JOIN players pl ON pl.id = li."playerId" WHERE li."invoiceId" = i.id) AS children,
             (SELECT max(c."createdAt") AT TIME ZONE 'UTC' FROM communications c WHERE c.kind = 'reminder'
                AND c.attachments @> jsonb_build_array(jsonb_build_object('id', i.id::text))) AS "lastReminderAt",
             (SELECT count(*)::int FROM communications c WHERE c.kind = 'reminder'
                AND c.attachments @> jsonb_build_array(jsonb_build_object('id', i.id::text))) AS reminders
      FROM invoices i JOIN guardians g ON g.id = i."guardianId"
      WHERE ${w.join(' AND ')} ORDER BY i."dueDate" NULLS LAST, i.number`, params);
    const out: any[] = [];
    for (const r of rows) {
      const s = await this.instalments.summary(r.id);
      const d = dueNow(s as Summary, r.dueDate, today);
      if (q.show === 'overdue' && !d.daysOverdue) continue;
      if (q.show === 'due7' && (d.daysOverdue || d.daysToDue == null || d.daysToDue > 7)) continue;
      out.push({ ...r, dueNow: d.amount, nextDueDate: d.dueDate, what: d.what, daysOverdue: d.daysOverdue, daysToDue: d.daysToDue,
        kind: d.daysOverdue ? 'overdue' : 'friendly', hasPlan: s.hasPlan });
    }
    return {
      today, count: out.length,
      totals: { balance: r2(out.reduce((a, r) => a + r.balance, 0)), dueNow: r2(out.reduce((a, r) => a + r.dueNow, 0)), overdue: out.filter((r) => r.daysOverdue > 0).length },
      data: out,
    };
  }
}
