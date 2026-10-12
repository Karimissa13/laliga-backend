import { InvoiceStatus } from '../../database/entities/enums';
import {
  PaymentState, invoiceStatusLabel, isOverdue, overdueSql, paymentStateOf, paymentStateSql,
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

describe('invoiceStatusLabel — the payment status in words (Oct 2026)', () => {
  it('says "Invoice issued" until money arrives, with or without instalments', () => {
    expect(invoiceStatusLabel('ISSUED', null)).toBe('Invoice issued');
    expect(invoiceStatusLabel('ISSUED', { total: 3, paid: 0 })).toBe('Invoice issued');
  });
  it('counts instalments paid in order on a plan, else "Partial payment"', () => {
    expect(invoiceStatusLabel('PART_PAID', null)).toBe('Partial payment');
    expect(invoiceStatusLabel('PART_PAID', { total: 3, paid: 0 })).toBe('Partial payment');   // part of instalment 1
    expect(invoiceStatusLabel('PART_PAID', { total: 3, paid: 1 })).toBe('Instalment 1 of 3 paid');
    expect(invoiceStatusLabel('PART_PAID', { total: 5, paid: 4 })).toBe('Instalment 4 of 5 paid');
  });
  it('names the settled and closed states', () => {
    expect(invoiceStatusLabel('PAID', { total: 3, paid: 3 })).toBe('Paid');
    expect(invoiceStatusLabel('DRAFT')).toBe('Draft (not sent)');
    expect(invoiceStatusLabel('CANCELLED')).toBe('Cancelled');
  });
});

describe('invoicePurpose — what an invoice was for (wallet statement)', () => {
  const { invoicePurpose } = jest.requireActual('./invoice-purpose');
  it('names term options, camps, trips, leagues and kits', () => {
    expect(invoicePurpose([{ stream: 'ACADEMY', package: 'FULL' }, { stream: 'KITS' }])).toBe('Full season + Kit');
    expect(invoicePurpose([{ stream: 'ACADEMY', package: 'T1' }], null, ['CAMP'])).toBe('Camp');
    expect(invoicePurpose([{ stream: 'SALOU_CUP' }])).toBe('Salou Cup (trip)');
    expect(invoicePurpose([{ stream: 'MAN_CITY_LEAGUE' }])).toBe('Man City League');
    expect(invoicePurpose([{ stream: 'ACADEMY', package: 'FULL' }], 'MOVE_UP')).toBe('Squad move-up');
  });
});
