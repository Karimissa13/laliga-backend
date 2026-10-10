import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { CreditNote, CreditNoteKind, Invoice, InvoiceStatus } from '../../database/entities';
import { ReferenceService } from '../../common/reference.service';

const r2 = (n: number) => Math.round(n * 100) / 100;
const dubaiToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });

export const CREDIT_NOTE_KIND_LABEL: Record<CreditNoteKind, string> = {
  [CreditNoteKind.REFUND]: 'Refund',
  [CreditNoteKind.WRITE_OFF]: 'Amount forgiven',
  [CreditNoteKind.CANCELLATION]: 'Invoice cancelled',
};

/**
 * VAT inside a credited amount, at the invoice's own proportion — so a credit on a
 * zero-VAT (or sponsored) invoice carries no VAT, and a full credit returns
 * exactly the invoice's VAT.
 */
export function creditSplit(amount: number, invoiceTotal: number, invoiceVat: number) {
  const total = r2(amount);
  const vat = invoiceTotal > 0 ? r2((total * invoiceVat) / invoiceTotal) : 0;
  return { total, vat, net: r2(total - vat) };
}

export interface IssueCreditNote {
  invoiceId: string; kind: CreditNoteKind; amount: number; reason?: string | null;
  paymentId?: string | null; instalmentSeq?: number | null; actorId?: string | null;
}

/**
 * Tax credit notes (Karim, Oct 2026). Issued by the finance actions themselves —
 * a refund, an amount forgiven (when not a bad debt), cancelling an issued invoice —
 * never typed in. They document what the ledger already records, so they never
 * change an invoice's totals; the database refuses edits and deletes.
 */
@Injectable()
export class CreditNotesService {
  constructor(
    @InjectRepository(CreditNote) private readonly notes: Repository<CreditNote>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly refs: ReferenceService,
  ) {}

  /** Issue one. A draft was never a tax invoice, so it gets none (returns null); nor does a zero amount. */
  async issue(input: IssueCreditNote): Promise<CreditNote | null> {
    const inv = await this.invoices.findOne({ where: { id: input.invoiceId } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === InvoiceStatus.DRAFT || !(input.amount > 0.005)) return null;
    const s = creditSplit(input.amount, Number(inv.total), Number(inv.vatTotal));
    const reason = (input.reason?.trim() || CREDIT_NOTE_KIND_LABEL[input.kind]).slice(0, 250);
    return this.notes.save(this.notes.create({
      number: await this.refs.next('CN'),
      invoiceId: inv.id, guardianId: inv.guardianId, kind: input.kind, issueDate: dubaiToday(),
      total: s.total.toFixed(2), vatAmount: s.vat.toFixed(2), netAmount: s.net.toFixed(2), reason,
      paymentId: input.paymentId ?? null, instalmentSeq: input.instalmentSeq ?? null, createdById: input.actorId ?? null,
    }));
  }

  forInvoice(invoiceId: string) {
    return this.notes.find({ where: { invoiceId }, order: { createdAt: 'ASC' } });
  }

  async findOne(id: string) {
    const n = await this.notes.findOne({ where: { id }, relations: { invoice: true, guardian: true } });
    if (!n) throw new NotFoundException('Credit note not found');
    return n;
  }

  /** Was a credit note issued for this waived instalment? (Then the waiver can't be undone.) */
  forWaiver(invoiceId: string, instalmentSeq: number) {
    return this.notes.findOne({ where: { invoiceId, instalmentSeq, kind: CreditNoteKind.WRITE_OFF } });
  }

  /** The credit-note register for a period (accounting / VAT return). */
  async list(f: { from?: string; to?: string }) {
    const where: any = {};
    if (f.from || f.to) where.issueDate = Between(f.from ?? '1900-01-01', f.to ?? '2999-12-31');
    const rows = await this.notes.find({ where, relations: { invoice: true, guardian: true }, order: { issueDate: 'DESC', createdAt: 'DESC' }, take: 2000 });
    const sum = (k: 'total' | 'vatAmount' | 'netAmount') => r2(rows.reduce((s, n) => s + Number(n[k]), 0));
    return {
      data: rows.map((n) => ({
        id: n.id, number: n.number, issueDate: n.issueDate, kind: n.kind, kindLabel: CREDIT_NOTE_KIND_LABEL[n.kind], reason: n.reason,
        invoice: { id: n.invoiceId, number: n.invoice?.number }, parent: { id: n.guardianId, ref: n.guardian?.reference, name: n.guardian?.fullName },
        total: Number(n.total), vat: Number(n.vatAmount), net: Number(n.netAmount),
      })),
      totals: { count: rows.length, total: sum('total'), vat: sum('vatAmount'), net: sum('netAmount') },
    };
  }
}
