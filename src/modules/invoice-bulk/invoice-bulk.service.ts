import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Invoice, InvoiceStatus } from '../../database/entities';
import { AuditService } from '../../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentLinksService } from '../payment-links/payment-links.service';

/** At most this many invoices per request — the screen sends a selection in batches and shows progress. */
export const BULK_BATCH = 25;

export type BulkOutcome = 'sent' | 'recorded' | 'skipped' | 'failed';
export interface BulkResult { id: string; number: string | null; outcome: BulkOutcome; detail: string }

const OPEN = [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID];

/**
 * Actions on a selection of invoices. Each invoice goes through exactly the same
 * service as the single-invoice action (same checks, same Email log, same
 * activity-log entry), one at a time; one failure never stops the rest.
 */
@Injectable()
export class InvoiceBulkService {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly notifications: NotificationsService,
    private readonly paymentLinks: PaymentLinksService,
    private readonly audit: AuditService,
  ) {}

  /** Email each invoice (PDF attached) to the parent, as "Email invoice" does. */
  email(ids: string[], actorId?: string) {
    return this.each(ids, async (inv) => {
      if (inv.status === InvoiceStatus.DRAFT) return skip('Not issued yet');
      if (inv.status === InvoiceStatus.CANCELLED) return skip('Cancelled');
      const r = await this.notifications.sendInvoice(inv.id, { actorId });
      await this.log('invoice.email', inv.id, actorId);
      return mailed(r);
    });
  }

  /** Email a payment link for what is still owed, as "Send payment link" does. */
  sendPaymentLinks(ids: string[], actorId?: string) {
    return this.each(ids, async (inv) => {
      if (!OPEN.includes(inv.status)) return skip(inv.status === InvoiceStatus.DRAFT ? 'Not issued yet' : 'Nothing to pay');
      const r = await this.paymentLinks.send(inv.id, null, actorId);
      await this.log('invoice.payment_link_sent', inv.id, actorId);
      return mailed(r.email);
    });
  }

  private async each(ids: string[], act: (inv: Invoice) => Promise<{ outcome: BulkOutcome; detail: string }>) {
    const unique = [...new Set(ids)];
    const found = new Map((await this.invoices.find({ where: { id: In(unique) } })).map((i) => [i.id, i]));
    const results: BulkResult[] = [];
    for (const id of unique) {
      const inv = found.get(id);
      if (!inv) { results.push({ id, number: null, outcome: 'failed', detail: 'Invoice not found' }); continue; }
      try {
        results.push({ id, number: inv.number, ...(await act(inv)) });
      } catch (e: any) {
        results.push({ id, number: inv.number, outcome: 'failed', detail: e?.response?.message ?? e?.message ?? 'Failed' });
      }
    }
    const count = (o: BulkOutcome) => results.filter((r) => r.outcome === o).length;
    return { results, sent: count('sent'), recorded: count('recorded'), skipped: count('skipped'), failed: count('failed') };
  }

  private log(action: string, invoiceId: string, actorId?: string) {
    return this.audit.record({ actorId, actorType: actorId ? 'user' : 'system', action, entity: 'invoice', entityId: invoiceId, metadata: { bulk: true } });
  }
}

const skip = (detail: string) => ({ outcome: 'skipped' as const, detail });

/** Sent, or — while no mailbox is connected — recorded in the Email log only. */
function mailed(r: { to?: string | null; sent: boolean; error?: string | null }) {
  if (r.sent) return { outcome: 'sent' as const, detail: `Sent to ${r.to}` };
  if (r.error) return { outcome: 'failed' as const, detail: `Not sent: ${r.error}` };
  return { outcome: 'recorded' as const, detail: 'Recorded in the Email log (email is not connected yet)' };
}
