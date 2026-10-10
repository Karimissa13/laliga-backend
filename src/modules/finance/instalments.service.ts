import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreditNoteKind, Invoice, InvoiceInstalment, InvoiceStatus, Payment, PaymentStatus } from '../../database/entities';
import { InvoicesService } from './invoices.service';
import { CreditNotesService } from './credit-notes.service';
import { INSTALMENT_STATE_LABEL, InstalmentView, LedgerPayment, MAX_INSTALMENTS, PlanRow, allocate, amountsFor, planProblem } from './instalments';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface PlanInput { percent: number; dueDate: string }

/**
 * Instalment plans (Karim, Oct 2026): manual, set by the academy — 2 to 5
 * instalments, each with its percentage of the total and a due date typed in
 * by staff. The parent doesn't choose and doesn't see the schedule; they get a
 * payment link for the amount the desk sends.
 */
@Injectable()
export class InstalmentsService {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceInstalment) private readonly rows: Repository<InvoiceInstalment>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly invoicing: InvoicesService,
    private readonly creditNotes: CreditNotesService,
  ) {}

  private plan(rows: InvoiceInstalment[]): PlanRow[] {
    return rows.map((r) => ({ seq: r.seq, percent: Number(r.percent), amount: Number(r.amount), dueDate: r.dueDate, flag: r.flag,
      waivedAmount: Number(r.waivedAmount), waivedReason: r.waivedReason ?? null }));
  }
  private ledger(pays: Payment[]): LedgerPayment[] {
    return pays.filter((p) => p.status === PaymentStatus.COMPLETED)
      .sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime())
      .map((p) => ({ amount: Number(p.amount), direction: p.direction as any, instalmentSeq: p.instalmentSeq ?? null }));
  }

  /** The plan with what each instalment has received, what's left and where it stands. */
  async summary(invoiceId: string) {
    const inv = await this.invoices.findOne({ where: { id: invoiceId }, relations: { payments: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const rows = await this.rows.find({ where: { invoiceId }, order: { seq: 'ASC' } });
    return this.shape(inv, rows);
  }

  private shape(inv: Invoice, rows: InvoiceInstalment[]) {
    const plan = this.plan(rows);
    const waived = plan.reduce((a, p) => a + p.waivedAmount, 0);
    const views: InstalmentView[] = plan.length
      ? allocate(plan, this.ledger(inv.payments || []), { genericWriteOff: r2(Number(inv.writeOffAmount) - waived) })
      : [];
    const total = Number(inv.total);
    const balance = r2(Math.max(0, total - Number(inv.amountPaid) + Number(inv.amountRefunded) - Number(inv.writeOffAmount)));
    const next = views.find((v) => v.remaining > 0.005) ?? null;
    const editable = ![InvoiceStatus.CANCELLED, InvoiceStatus.PAID, InvoiceStatus.REFUNDED, InvoiceStatus.WRITTEN_OFF, InvoiceStatus.SPONSORED].includes(inv.status);
    return {
      invoiceId: inv.id, number: inv.number, status: inv.status, total, balance, hasPlan: views.length > 0, editable,
      max: MAX_INSTALMENTS,
      instalments: views.map((v) => ({ ...v, label: INSTALMENT_STATE_LABEL[v.state] })),
      next: next ? { seq: next.seq, remaining: next.remaining, dueDate: next.dueDate, state: next.state } : null,
      counts: { total: views.length, paid: views.filter((v) => v.state === 'PAID' || v.state === 'WAIVED').length,
        pending: views.filter((v) => v.state !== 'PAID' && v.state !== 'WAIVED').length },
    };
  }

  /** Paid / pending counts for many invoices at once (the invoice register). */
  async countsFor(invoiceIds: string[]) {
    const out = new Map<string, { total: number; paid: number; pending: number }>();
    if (!invoiceIds.length) return out;
    const rows = await this.rows.find({ where: { invoiceId: In(invoiceIds) }, order: { seq: 'ASC' } });
    if (!rows.length) return out;
    const ids = [...new Set(rows.map((r) => r.invoiceId))];
    const invs = await this.invoices.find({ where: { id: In(ids) }, relations: { payments: true } });
    for (const inv of invs) {
      const s = this.shape(inv, rows.filter((r) => r.invoiceId === inv.id));
      out.set(inv.id, s.counts);
    }
    return out;
  }

  /**
   * Set, change or remove (empty list) the plan. Shares are percentages of the
   * invoice total that add up to 100; dates are typed by staff and run in
   * order. An instalment that already has money against it can't drop below
   * what it received, and a waived one keeps its waiver.
   */
  async setPlan(invoiceId: string, items: PlanInput[]) {
    const inv = await this.invoices.findOne({ where: { id: invoiceId }, relations: { payments: true } });
    if (!inv) throw new NotFoundException('Invoice not found');
    const current = await this.rows.find({ where: { invoiceId }, order: { seq: 'ASC' } });
    const before = this.shape(inv, current);
    if (!before.editable) throw new BadRequestException(`This invoice is ${String(inv.status).toLowerCase().replace('_', ' ')} — its instalments can't be changed.`);

    if (!items.length) {
      if (current.some((r) => Number(r.waivedAmount) > 0)) throw new BadRequestException('Undo the waived instalment first.');
      if (current.length) await this.rows.delete({ invoiceId });
      await this.payments.update({ invoiceId }, { instalmentSeq: null });
      await this.invoices.update(invoiceId, { installments: 1 });
      return this.summary(invoiceId);
    }
    const problem = planProblem(items);
    if (problem) throw new BadRequestException(problem);

    const amounts = amountsFor(Number(inv.total), items.map((i) => Number(i.percent)));
    for (const v of before.instalments) {
      const neu = amounts[v.seq - 1];
      const keep = r2(v.paid + v.waivedAmount);
      if (keep > 0.005 && (neu == null || neu + 0.005 < keep)) {
        throw new BadRequestException(v.waivedAmount > 0
          ? `Instalment ${v.seq} is waived — undo the waiver before changing it.`
          : `Instalment ${v.seq} has already received AED ${v.paid.toFixed(2)} — it can't be smaller than that.`);
      }
    }
    // Replace the rows, carrying flags and waivers by position.
    const old = new Map(current.map((r) => [r.seq, r]));
    if (current.length) await this.rows.delete({ invoiceId });
    await this.rows.save(items.map((it, i) => this.rows.create({
      invoiceId, seq: i + 1, percent: Number(it.percent).toFixed(2), amount: amounts[i].toFixed(2), dueDate: it.dueDate,
      flag: old.get(i + 1)?.flag ?? 'NONE', waivedAmount: old.get(i + 1)?.waivedAmount ?? '0', waivedReason: old.get(i + 1)?.waivedReason ?? null,
    })));
    await this.payments.createQueryBuilder().update().set({ instalmentSeq: null })
      .where('"invoiceId" = :id AND "instalmentSeq" > :n', { id: invoiceId, n: items.length }).execute();
    await this.invoices.update(invoiceId, { installments: items.length, dueDate: items[0].dueDate });
    return this.summary(invoiceId);
  }

  /** After the invoice total changes (re-priced before any payment): same percentages, new amounts. */
  async rescale(invoiceId: string) {
    const inv = await this.invoices.findOne({ where: { id: invoiceId } });
    const rows = await this.rows.find({ where: { invoiceId }, order: { seq: 'ASC' } });
    if (!inv || !rows.length) return;
    const amounts = amountsFor(Number(inv.total), rows.map((r) => Number(r.percent)));
    for (const [i, r] of rows.entries()) await this.rows.update(r.id, { amount: amounts[i].toFixed(2) });
  }

  /** "Ready to pay" marks the instalment the parent should pay now (one at a time). */
  async setReady(invoiceId: string, seq: number, ready: boolean) {
    const row = await this.rows.findOne({ where: { invoiceId, seq } });
    if (!row) throw new NotFoundException('Instalment not found');
    if (row.flag === 'WAIVED') throw new BadRequestException('This instalment is waived.');
    if (ready) await this.rows.createQueryBuilder().update().set({ flag: 'NONE' }).where('"invoiceId" = :id AND flag = :f', { id: invoiceId, f: 'READY' }).execute();
    await this.rows.update(row.id, { flag: ready ? 'READY' : 'NONE' });
    return this.summary(invoiceId);
  }

  /** Forgive what is left of an instalment: it is written off on the invoice, with the reason. */
  async waive(invoiceId: string, seq: number, reason: string, opts: { creditNote?: boolean; actorId?: string } = {}) {
    const s = await this.summary(invoiceId);
    const v = s.instalments.find((x) => x.seq === seq);
    if (!v) throw new NotFoundException('Instalment not found');
    if (v.state === 'WAIVED') throw new BadRequestException('Already waived.');
    if (v.remaining <= 0.005) throw new BadRequestException('This instalment is already paid.');
    if (!s.editable) throw new BadRequestException('This invoice can no longer be changed.');
    const row = (await this.rows.findOne({ where: { invoiceId, seq } }))!;
    await this.rows.update(row.id, { flag: 'WAIVED', waivedAmount: r2(Number(row.waivedAmount) + v.remaining).toFixed(2), waivedReason: reason });
    const inv = (await this.invoices.findOne({ where: { id: invoiceId } }))!;
    await this.invoices.update(invoiceId, {
      writeOffAmount: r2(Number(inv.writeOffAmount) + v.remaining).toFixed(2),
      writeOffReason: [inv.writeOffReason, `Instalment ${seq} waived: ${reason}`].filter(Boolean).join(' · ').slice(0, 250),
    });
    if (opts.creditNote) {
      await this.creditNotes.issue({ invoiceId, kind: CreditNoteKind.WRITE_OFF, amount: v.remaining, reason: `Instalment ${seq} waived: ${reason}`,
        instalmentSeq: seq, actorId: opts.actorId });
    }
    await this.invoicing.recomputeStatus(invoiceId);
    return this.summary(invoiceId);
  }

  /** Take a waiver back: the amount is owed again. */
  async unwaive(invoiceId: string, seq: number) {
    const row = await this.rows.findOne({ where: { invoiceId, seq } });
    if (!row || row.flag !== 'WAIVED') throw new BadRequestException('This instalment is not waived.');
    const note = await this.creditNotes.forWaiver(invoiceId, seq);
    if (note) {
      throw new BadRequestException(`Tax credit note ${note.number} was issued for this waiver, so it can't be undone. Invoice the amount again instead.`);
    }
    const amt = Number(row.waivedAmount);
    const inv = (await this.invoices.findOne({ where: { id: invoiceId } }))!;
    await this.rows.update(row.id, { flag: 'NONE', waivedAmount: '0', waivedReason: null });
    await this.invoices.update(invoiceId, { writeOffAmount: r2(Math.max(0, Number(inv.writeOffAmount) - amt)).toFixed(2) });
    await this.invoicing.recomputeStatus(invoiceId);
    return this.summary(invoiceId);
  }
}
