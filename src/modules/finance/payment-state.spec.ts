import { InvoiceStatus } from '../../database/entities/enums';
import {
  PaymentState, isOverdue, overdueSql, paymentStateOf, paymentStateSql,
} from './payment-state';

describe('payment state', () => {
  it('maps every invoice status to a front-desk state', () => {
    expect(paymentStateOf(InvoiceStatus.ISSUED)).toBe(PaymentState.UNPAID);
    expect(paymentStateOf(InvoiceStatus.PART_PAID)).toBe(PaymentState.PART_PAID);
    expect(paymentStateOf(InvoiceStatus.PAID)).toBe(PaymentState.PAID);
    expect(paymentStateOf(InvoiceStatus.SPONSORED)).toBe(PaymentState.PAID);
    expect(paymentStateOf(InvoiceStatus.DRAFT)).toBe(PaymentState.NOT_SENT);
    expect(paymentStateOf(null)).toBe(PaymentState.NO_INVOICE);
    for (const s of Object.values(InvoiceStatus)) expect(paymentStateOf(s)).toBeDefined();
  });

  it('only open invoices can be overdue', () => {
    const today = new Date('2026-10-06');
    expect(isOverdue(InvoiceStatus.ISSUED, '2026-10-01', today)).toBe(true);
    expect(isOverdue(InvoiceStatus.PART_PAID, '2026-10-01', today)).toBe(true);
    expect(isOverdue(InvoiceStatus.ISSUED, '2026-10-20', today)).toBe(false);
    expect(isOverdue(InvoiceStatus.PAID, '2026-10-01', today)).toBe(false);
    expect(isOverdue(InvoiceStatus.DRAFT, '2026-10-01', today)).toBe(false);
  });

  it('generates SQL covering every status, from the same table', () => {
    const sql = paymentStateSql('inv');
    for (const s of Object.values(InvoiceStatus)) expect(sql).toContain(`'${s}'`);
    expect(sql).toContain(`'${PaymentState.NO_INVOICE}'`);
    expect(overdueSql('inv')).toContain(`'ISSUED'`);
    expect(overdueSql('inv')).toContain(`'PART_PAID'`);
    // A settled invoice must never count as overdue.
    expect(overdueSql('inv')).not.toContain(`'PAID'`);
    expect(overdueSql('inv')).not.toContain(`'SPONSORED'`);
  });
});
