import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  CreditNoteKind, Invoice, Merchant, Payment, PaymentDirection, PaymentMethod, PaymentStatus,
  Wallet, WalletTransaction, WalletTxnType,
} from '../../database/entities';
import { InvoicesService } from './invoices.service';
import { CreditNotesService } from './credit-notes.service';

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
    const balance = Number(updated.total) - Number(updated.amountPaid) + Number(updated.amountRefunded);
    let walletCredit = 0;
    if (balance < -0.009) {
      walletCredit = money(Math.abs(balance));
      await this.creditWallet(updated.guardianId, walletCredit, `Overpayment on ${updated.number}`);
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
      await this.creditWallet(invoice.guardianId, input.amount, `Refund from ${invoice.number}`);
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

  async creditWallet(guardianId: string, amount: number, reason?: string) {
    const w = await this.getWallet(guardianId);
    await this.walletTxns.save(this.walletTxns.create({
      walletId: w.id, type: WalletTxnType.CREDIT, amount: money(amount).toFixed(2), reason,
    }));
    await this.wallets.update(w.id, { balance: money(Number(w.balance) + amount).toFixed(2) });
    return this.getWallet(guardianId);
  }

  async debitWallet(guardianId: string, amount: number, reason?: string) {
    const w = await this.getWallet(guardianId);
    if (Number(w.balance) < amount) throw new BadRequestException('Insufficient wallet balance');
    await this.walletTxns.save(this.walletTxns.create({
      walletId: w.id, type: WalletTxnType.DEBIT, amount: money(amount).toFixed(2), reason,
    }));
    await this.wallets.update(w.id, { balance: money(Number(w.balance) - amount).toFixed(2) });
    return this.getWallet(guardianId);
  }

  /** Pay an invoice from the guardian's wallet credit. */
  async payFromWallet(invoiceId: string, amount: number, recordedById?: string) {
    const invoice = await this.invoices.findOne({ where: { id: invoiceId } });
    if (!invoice) throw new BadRequestException('Invalid invoiceId');
    await this.debitWallet(invoice.guardianId, amount, `Applied to invoice ${invoice.number}`);
    return this.record({ invoiceId, amount, method: PaymentMethod.WALLET, recordedById, notes: 'Paid from wallet credit' });
  }
}
