import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  CreditNoteKind, Invoice, InvoiceStatus, Merchant, Payment, PaymentDirection, PaymentMethod, PaymentStatus,
  Wallet, WalletTransaction, WalletTxnType,
} from '../../database/entities';
import { InvoicesService } from './invoices.service';
import { CreditNotesService } from './credit-notes.service';
import { PURPOSE_LINES_SQL, TERM_TYPES_SQL, invoicePurpose } from './invoice-purpose';

const money = (n: number) => Math.round(n * 100) / 100;

@Injectable()
export class PaymentsService {
  constructor(
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletTransaction) private readonly walletTxns: Repository<WalletTransaction>,
    @InjectRepository(Merchant) private readonly merchants: Repository<Merchant>,
    private readonly invoicesService: InvoicesService,
    private readonly creditNotes: CreditNotesService,
  ) {}

  /** A payment already recorded for this gateway transaction (webhooks can arrive twice). */
  findByGatewayId(gatewayId: string) { return this.payments.findOne({ where: { gatewayId } }); }

  /** Record a payment against an invoice. Invoice status recomputes from the ledger. */
  async record(input: {
    invoiceId: string; amount: number; method: PaymentMethod; reference?: string;
    paidAt?: string; notes?: string; recordedById?: string; gatewayId?: string; merchantId?: string; instalmentSeq?: number | null;
  }) {
    // Paying with wallet credit must take it out of the wallet (it used to be recorded only).
    if (input.method === PaymentMethod.WALLET && !input.gatewayId) {
      return this.payFromWallet(input.invoiceId, input.amount, input.recordedById, { instalmentSeq: input.instalmentSeq, notes: input.notes, paidAt: input.paidAt });
    }
    const invoice = await this.invoices.findOne({ where: { id: input.invoiceId } });
    if (!invoice) throw new BadRequestException('Invalid invoiceId');
    if (input.amount <= 0) throw new BadRequestException('Amount must be positive');
    if (invoice.status === 'CANCELLED') throw new BadRequestException('A cancelled invoice can\'t take a payment');
    // The merchant's name and MID are copied onto the payment, so renaming a
    // merchant later never changes what an old payment says.
    let merchant: Merchant | null = null;
    if (input.merchantId) {
      merchant = await this.merchants.findOne({ where: { id: input.merchantId } });
      if (!merchant) throw new BadRequestException('Unknown merchant');
    }

    const payment = await this.payments.save(this.payments.create({
      invoiceId: input.invoiceId,
      direction: PaymentDirection.INBOUND,
      amount: money(input.amount).toFixed(2),
      method: input.method,
      status: PaymentStatus.COMPLETED,
      reference: input.reference,
      gatewayId: input.gatewayId,
      merchantId: merchant?.id ?? null,
      merchantName: merchant?.name ?? null,
      merchantNumber: merchant?.merchantNumber ?? null,
      paidAt: input.paidAt ? new Date(input.paidAt) : new Date(),
      recordedById: input.recordedById,
      notes: input.notes,
      instalmentSeq: input.instalmentSeq ?? null,
    }));

    const updated = await this.invoicesService.recomputeStatus(input.invoiceId);

    // Overpayment lands in the guardian's wallet instead of being lost.
    const balance = Number(updated.total) - Number(updated.amountPaid);
    let walletCredit = 0;
    if (balance < -0.009) {
      walletCredit = money(Math.abs(balance));
      await this.creditWallet(updated.guardianId, walletCredit, `Overpayment on ${updated.number}`,
        { kind: 'OVERPAYMENT', invoiceId: updated.id, paymentId: payment.id, createdById: input.recordedById });
    }
    return { payment, invoice: await this.invoicesService.findOne(input.invoiceId), walletCredit };
  }

  /** Refund against an invoice (recorded as a REFUND direction in the same ledger). */
  async refund(input: { invoiceId: string; amount: number; reason?: string; toWallet?: boolean; recordedById?: string }) {
    const invoice = await this.invoices.findOne({ where: { id: input.invoiceId } });
    if (!invoice) throw new BadRequestException('Invalid invoiceId');
    const netPaid = Number(invoice.amountPaid) - Number(invoice.amountRefunded);
    if (input.amount > netPaid + 0.009) {
      throw new BadRequestException(`Refund exceeds net paid (${netPaid.toFixed(2)})`);
    }
    const payment = await this.payments.save(this.payments.create({
      invoiceId: input.invoiceId,
      direction: PaymentDirection.REFUND,
      amount: money(input.amount).toFixed(2),
      method: input.toWallet ? PaymentMethod.WALLET : PaymentMethod.BANK_TRANSFER,
      status: PaymentStatus.COMPLETED,
      notes: input.reason,
      recordedById: input.recordedById,
    }));
    if (input.toWallet) {
      await this.creditWallet(invoice.guardianId, input.amount, `Refund from ${invoice.number}${input.reason ? ' — ' + input.reason : ''}`,
        { kind: 'REFUND', invoiceId: invoice.id, paymentId: payment.id, createdById: input.recordedById });
    }
    // Money paid back reduces the supply: the tax credit note documents it.
    const creditNote = await this.creditNotes.issue({
      invoiceId: input.invoiceId, kind: CreditNoteKind.REFUND, amount: input.amount,
      reason: input.reason || (input.toWallet ? 'Refund to wallet credit' : 'Refund'),
      paymentId: payment.id, actorId: input.recordedById,
    });
    return { payment, creditNote, invoice: await this.invoicesService.recomputeStatus(input.invoiceId) };
  }

  listForInvoice(invoiceId: string) {
    return this.payments.find({ where: { invoiceId }, order: { paidAt: 'DESC' } });
  }

  // ------------------------------------------------------------------ wallet
  async getWallet(guardianId: string) {
    let w = await this.wallets.findOne({ where: { guardianId }, relations: { transactions: true } });
    if (!w) w = await this.wallets.save(this.wallets.create({ guardianId, balance: '0' }));
    return w;
  }

  /**
   * Credit or debit a family wallet. The balance changes in one database statement
   * (no read-then-write), together with its entry, so two people acting at the same
   * moment can't lose an amount; a debit never takes the balance below zero.
   * `meta` links the entry to what it came from or paid for (kind, invoice, payment).
   */
  async creditWallet(guardianId: string, amount: number, reason?: string, meta: WalletMeta = {}) {
    await this.ds().transaction((m) => this.moveWallet(m, guardianId, WalletTxnType.CREDIT, amount, reason, { kind: 'CREDIT', ...meta }));
    return this.getWallet(guardianId);
  }

  async debitWallet(guardianId: string, amount: number, reason?: string, meta: WalletMeta = {}) {
    await this.ds().transaction((m) => this.moveWallet(m, guardianId, WalletTxnType.DEBIT, amount, reason, { kind: 'DEBIT', ...meta }));
    return this.getWallet(guardianId);
  }

  private ds() { return this.wallets.manager; }

  /** Inside a transaction: move the balance (guarded) and write the entry. */
  private async moveWallet(m: EntityManager, guardianId: string, type: WalletTxnType, amount: number, reason: string | undefined, meta: WalletMeta) {
    const amt = money(amount);
    if (!(amt > 0)) throw new BadRequestException('The amount must be more than zero');
    const w = await this.getWallet(guardianId);
    const res: any = await m.query(
      type === WalletTxnType.CREDIT
        ? `UPDATE wallets SET balance = balance + $2, "updatedAt" = now() WHERE id = $1 RETURNING id`
        : `UPDATE wallets SET balance = balance - $2, "updatedAt" = now() WHERE id = $1 AND balance >= $2 RETURNING id`,
      [w.id, amt.toFixed(2)]);
    // For UPDATE … RETURNING the driver answers [rows, rowCount]: no row updated = not enough balance.
    const updated = Array.isArray(res) && Array.isArray(res[0]) ? res[0].length : Array.isArray(res) ? res.length : 0;
    if (!updated) {
      const [b] = await m.query(`SELECT balance::float AS balance FROM wallets WHERE id = $1`, [w.id]);
      throw new BadRequestException(`Not enough in the wallet — it holds AED ${Number(b?.balance ?? 0).toFixed(2)}.`);
    }
    return m.getRepository(WalletTransaction).save(m.getRepository(WalletTransaction).create({
      walletId: w.id, type, amount: amt.toFixed(2), reason,
      kind: meta.kind ?? null, invoiceId: meta.invoiceId ?? null, paymentId: meta.paymentId ?? null,
      createdById: meta.createdById ?? null, reversalOfId: meta.reversalOfId ?? null,
    }));
  }

  /** A family's invoices that still hold money that could go back to them (paid less refunded). */
  async refundableInvoices(guardianId: string) {
    const rows: any[] = await this.invoices.manager.query(
      `SELECT i.id, i.number, i.status, i."issueDate"::text AS "issueDate", i.total::float AS total,
              i."amountPaid"::float AS paid, i."amountRefunded"::float AS refunded,
              (i."amountPaid" - i."amountRefunded")::float AS refundable,
              (SELECT string_agg(DISTINCT p."firstName" || ' ' || p."lastName", ', ') FROM invoice_line_items li
                 JOIN players p ON p.id = li."playerId" WHERE li."invoiceId" = i.id) AS children
       FROM invoices i WHERE i."guardianId" = $1 AND i.status NOT IN ('DRAFT', 'CANCELLED')
         AND i."amountPaid" - i."amountRefunded" > 0.005
       ORDER BY i."issueDate" DESC, i.number DESC`, [guardianId]);
    return rows.map((r) => ({ ...r, refundable: money(r.refundable) }));
  }

  /**
   * Pay an invoice — any kind: season package, camp, trip, league, kit — with the
   * family's wallet credit (Karim, Oct 2026). In one transaction: the wallet goes down
   * (never below zero), an invoice payment (method Wallet) is recorded, and the wallet
   * entry is linked to both. Never more than the invoice still owes.
   */
  async payFromWallet(invoiceId: string, amount: number, recordedById?: string,
    opts: { instalmentSeq?: number | null; notes?: string; paidAt?: string } = {}) {
    const invoice = await this.invoices.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('Invalid invoiceId');
    if (!WALLET_PAYABLE.includes(invoice.status)) {
      throw new BadRequestException(`Invoice ${invoice.number} is ${String(invoice.status).toLowerCase().replace('_', ' ')} — it can't take a wallet payment.`);
    }
    const amt = money(amount);
    if (!(amt > 0)) throw new BadRequestException('Amount must be positive');
    const payment = await this.ds().transaction(async (m) => {
      // Lock the invoice and count what it owes from its payments, so two wallet payments at
      // the same moment can't both pass the check and overpay it.
      await m.query(`SELECT id FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
      const [o] = await m.query(
        `SELECT (i.total - i."writeOffAmount"
            - COALESCE((SELECT sum(p.amount) FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'COMPLETED' AND p.direction = 'INBOUND'), 0)
            + COALESCE((SELECT sum(p.amount) FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'COMPLETED' AND p."reversalOfId" IS NOT NULL), 0))::float AS owed
         FROM invoices i WHERE i.id = $1`, [invoiceId]);
      const owed = money(Math.max(0, o?.owed ?? 0));
      if (amt > owed + 0.005) throw new BadRequestException(`Invoice ${invoice.number} only owes AED ${owed.toFixed(2)}.`);
      const pay = await m.getRepository(Payment).save(m.getRepository(Payment).create({
        invoiceId, direction: PaymentDirection.INBOUND, amount: amt.toFixed(2), method: PaymentMethod.WALLET,
        status: PaymentStatus.COMPLETED, paidAt: opts.paidAt ? new Date(opts.paidAt) : new Date(),
        recordedById, notes: opts.notes || 'Paid from wallet credit', instalmentSeq: opts.instalmentSeq ?? null,
      }));
      await this.moveWallet(m, invoice.guardianId, WalletTxnType.DEBIT, amt, `Applied to invoice ${invoice.number}`,
        { kind: 'INVOICE_PAYMENT', invoiceId, paymentId: pay.id, createdById: recordedById });
      return pay;
    });
    await this.invoicesService.recomputeStatus(invoiceId);
    return { payment, invoice: await this.invoicesService.findOne(invoiceId), walletCredit: 0, wallet: Number((await this.getWallet(invoice.guardianId)).balance) };
  }

  /**
   * Undo a wallet payment on an invoice: the money goes back to the wallet and the
   * invoice owes it again. Recorded as a reversing payment (never an edit or a delete),
   * without a credit note — nothing was refunded, the payment is taken back.
   */
  async reverseWalletPayment(paymentId: string, reason: string, actorId?: string) {
    const pay = await this.payments.findOne({ where: { id: paymentId } });
    if (!pay || pay.method !== PaymentMethod.WALLET || pay.direction !== PaymentDirection.INBOUND || pay.status !== PaymentStatus.COMPLETED) {
      throw new BadRequestException('Only a payment made with wallet credit can be taken back to the wallet.');
    }
    if (await this.payments.findOne({ where: { reversalOfId: pay.id } })) throw new BadRequestException('This wallet payment was already taken back.');
    const invoice = await this.invoices.findOne({ where: { id: pay.invoiceId } });
    if (!invoice) throw new NotFoundException('Invoice not found');
    if ([InvoiceStatus.CANCELLED, InvoiceStatus.REFUNDED].includes(invoice.status)) {
      throw new BadRequestException(`Invoice ${invoice.number} is ${String(invoice.status).toLowerCase()} — its payments can't be taken back.`);
    }
    const why = (reason || '').trim();
    if (why.length < 3) throw new BadRequestException('Give a reason (at least 3 characters).');
    const original = await this.walletTxns.findOne({ where: { paymentId: pay.id, kind: 'INVOICE_PAYMENT' } })
      ?? await this.walletTxns.findOne({ where: { invoiceId: pay.invoiceId, kind: 'INVOICE_PAYMENT', amount: pay.amount, cancelledAt: IsNull() }, order: { createdAt: 'ASC' } });
    await this.ds().transaction(async (m) => {
      const back = await m.getRepository(Payment).save(m.getRepository(Payment).create({
        invoiceId: pay.invoiceId, direction: PaymentDirection.REFUND, amount: pay.amount, method: PaymentMethod.WALLET,
        status: PaymentStatus.COMPLETED, recordedById: actorId, notes: `Wallet payment taken back — ${why}`, reversalOfId: pay.id,
        instalmentSeq: pay.instalmentSeq ?? null,
      }));
      await this.moveWallet(m, invoice.guardianId, WalletTxnType.CREDIT, Number(pay.amount), `Wallet payment on ${invoice.number} taken back — ${why}`,
        { kind: 'PAYMENT_REVERSAL', invoiceId: invoice.id, paymentId: back.id, createdById: actorId, reversalOfId: original?.id ?? null });
      if (original) await m.getRepository(WalletTransaction).update(original.id, { cancelledAt: new Date(), cancelledById: actorId ?? null, cancelReason: why.slice(0, 250) });
    });
    await this.invoicesService.recomputeStatus(invoice.id);
    return { invoice: await this.invoicesService.findOne(invoice.id), wallet: Number((await this.getWallet(invoice.guardianId)).balance) };
  }

  /**
   * Cancel a wallet entry (Karim: "delete and cancel the amount in the wallet"). Nothing is
   * deleted: a cancelling entry takes it back and both stay on the statement, marked.
   *  · a credit added for another reason (e.g. goodwill) → taken back out (if still in the wallet);
   *  · a manual debit → put back;
   *  · a payment of an invoice with wallet credit → taken back to the wallet, the invoice owes it again.
   * Refund, overpayment and sibling credits come from an invoice and are corrected there.
   */
  async cancelWalletEntry(entryId: string, reason: string, actorId?: string) {
    const t = await this.walletTxns.findOne({ where: { id: entryId }, relations: { wallet: true } });
    if (!t) throw new NotFoundException('Wallet entry not found');
    const why = (reason || '').trim();
    if (why.length < 3) throw new BadRequestException('Give a reason (at least 3 characters).');
    if (t.cancelledAt) throw new BadRequestException('This entry was already cancelled.');
    if (t.reversalOfId || t.kind === 'CANCELLATION' || t.kind === 'PAYMENT_REVERSAL') throw new BadRequestException('A cancelling entry can\'t itself be cancelled.');
    const kind = t.kind ?? (t.type === WalletTxnType.CREDIT ? 'CREDIT' : 'DEBIT');
    if (kind === 'INVOICE_PAYMENT') {
      const payId = t.paymentId ?? (await this.payments.findOne({
        where: { invoiceId: t.invoiceId ?? undefined, method: PaymentMethod.WALLET, direction: PaymentDirection.INBOUND, amount: t.amount },
        order: { createdAt: 'ASC' } }))?.id;
      if (!payId) throw new BadRequestException('The invoice payment for this entry was not found.');
      return this.reverseWalletPayment(payId, why, actorId);
    }
    if (!['CREDIT', 'DEBIT'].includes(kind)) {
      const word: Record<string, string> = { REFUND: 'a refund', OVERPAYMENT: 'an overpayment', SIBLING: 'a sibling discount credit' };
      throw new BadRequestException(`This credit comes from ${word[kind] ?? 'an invoice'} — correct it on the invoice, not in the wallet.`);
    }
    const guardianId = t.wallet.guardianId;
    await this.ds().transaction(async (m) => {
      await this.moveWallet(m, guardianId, kind === 'CREDIT' ? WalletTxnType.DEBIT : WalletTxnType.CREDIT, Number(t.amount),
        `Cancelled: ${t.reason || (kind === 'CREDIT' ? 'credit' : 'debit')} — ${why}`,
        { kind: 'CANCELLATION', createdById: actorId, reversalOfId: t.id, invoiceId: t.invoiceId ?? null });
      await m.getRepository(WalletTransaction).update(t.id, { cancelledAt: new Date(), cancelledById: actorId ?? null, cancelReason: why.slice(0, 250) });
    });
    return { wallet: Number((await this.getWallet(guardianId)).balance) };
  }

  /** The family's invoices that wallet credit could pay: what each owes and what it is for. */
  async walletPayableInvoices(guardianId: string) {
    const rows: any[] = await this.invoices.manager.query(
      `SELECT i.id, i.number, i.status, i.purpose, i."issueDate"::text AS "issueDate", i."dueDate"::text AS "dueDate", i.total::float AS total,
              GREATEST(i.total - i."amountPaid" - i."writeOffAmount", 0)::float AS owed,
              (SELECT string_agg(DISTINCT p."firstName" || ' ' || p."lastName", ', ') FROM invoice_line_items li
                 JOIN players p ON p.id = li."playerId" WHERE li."invoiceId" = i.id) AS children,
              ${PURPOSE_LINES_SQL('i')} AS lines, ${TERM_TYPES_SQL('i')} AS "termTypes"
       FROM invoices i WHERE i."guardianId" = $1 AND i.status IN ('ISSUED', 'PART_PAID')
         AND i.total - i."amountPaid" - i."writeOffAmount" > 0.005
       ORDER BY i."dueDate" NULLS LAST, i.number`, [guardianId]);
    const plans = await this.invoices.manager.query(
      `SELECT "invoiceId", count(*)::int AS n FROM invoice_instalments WHERE "invoiceId" = ANY($1::uuid[]) GROUP BY 1`, [rows.map((r) => r.id)]);
    const hasPlan = new Set(plans.map((x: any) => x.invoiceId));
    return rows.map((r) => ({ id: r.id, number: r.number, status: r.status, issueDate: r.issueDate, dueDate: r.dueDate, total: r.total,
      owed: money(r.owed), children: r.children, purpose: invoicePurpose(r.lines, r.purpose, r.termTypes), hasPlan: hasPlan.has(r.id) }));
  }
}

/** Invoice statuses a wallet payment can go on (a draft too, for the sibling credit that follows a registration). */
const WALLET_PAYABLE: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID, InvoiceStatus.DRAFT];

export interface WalletMeta { kind?: string; invoiceId?: string | null; paymentId?: string | null; createdById?: string | null; reversalOfId?: string | null }
