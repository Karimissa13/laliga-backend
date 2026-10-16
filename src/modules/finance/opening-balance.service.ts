import { BadRequestException } from '@nestjs/common';
import { EntityManager, Not } from 'typeorm';
import { Guardian, Invoice, InvoiceLineItem, InvoiceStatus, InvoiceType, RevenueStream } from '../../database/entities';
import { OldInvoice, OPENING_PURPOSE, openingBalanceLines } from './opening-balance';

/**
 * Write a family's "balance from earlier seasons" (one per family, numbered OB-<parent no>).
 * Used by the importer from the old admin's dump, inside its transaction. Issued straight
 * away, no VAT (the old invoices carried it), due on `asOf`. Returns null when nothing is owed.
 */
export async function writeOpeningBalance(m: EntityManager, guardianId: string, items: OldInvoice[], asOf: string) {
  const g = await m.findOne(Guardian, { where: { id: guardianId } });
  if (!g) throw new BadRequestException('Parent not found');
  const { lines, total, errors } = openingBalanceLines(items);
  if (errors.length) throw new BadRequestException(`${g.reference}: ${errors.join(' ')}`);
  if (!lines.length) return null;
  const number = `OB-${g.reference}`;
  if (await m.findOne(Invoice, { where: { number, status: Not(InvoiceStatus.CANCELLED) } })) {
    throw new BadRequestException(`${g.reference} already has a balance from earlier seasons (${number}).`);
  }
  const amount = total.toFixed(2);
  const inv = await m.save(Invoice, m.create(Invoice, {
    // A cancelled one keeps its number; a replacement gets a suffix so numbers stay unique.
    number: (await m.count(Invoice, { where: { number } })) ? `${number}-${Date.now().toString(36).toUpperCase()}` : number,
    guardianId, type: InvoiceType.CUSTOM, purpose: OPENING_PURPOSE, status: InvoiceStatus.ISSUED,
    issueDate: asOf, dueDate: asOf, subtotal: amount, discountTotal: '0', vatTotal: '0', total: amount,
    notes: 'Unpaid invoices from before Season 9, carried over from the old admin. Each line is one old invoice (VAT already included there).',
  }));
  await m.save(InvoiceLineItem, lines.map((l) => m.create(InvoiceLineItem, {
    invoiceId: inv.id, description: l.description, quantity: 1, unitAmount: l.amount.toFixed(2), lineTotal: l.amount.toFixed(2),
    vatRate: '0', stream: RevenueStream.OTHER, legacyId: l.legacyId,
  })));
  return { id: inv.id, number: inv.number, total, lines: lines.length };
}
