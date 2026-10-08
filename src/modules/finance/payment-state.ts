import { InvoiceStatus } from '../../database/entities/enums';

/**
 * A child's payment state, as the front desk talks about it.
 *
 * Defined ONCE here. The player list filters on it in SQL and every screen
 * displays it; the SQL is generated from this same table, so the filter and the
 * label can never disagree.
 */
export enum PaymentState {
  PAID = 'PAID',
  PART_PAID = 'PART_PAID',
  UNPAID = 'UNPAID',
  NOT_SENT = 'NOT_SENT',        // invoice exists but is still a draft
  NO_INVOICE = 'NO_INVOICE',
  REFUNDED = 'REFUNDED',
  WRITTEN_OFF = 'WRITTEN_OFF',
}

export const PAYMENT_STATE_LABEL: Record<PaymentState, string> = {
  [PaymentState.PAID]: 'Paid',
  [PaymentState.PART_PAID]: 'Part paid',
  [PaymentState.UNPAID]: 'Unpaid',
  [PaymentState.NOT_SENT]: 'Invoice not sent',
  [PaymentState.NO_INVOICE]: 'No invoice',
  [PaymentState.REFUNDED]: 'Refunded',
  [PaymentState.WRITTEN_OFF]: 'Written off',
};

const FROM_INVOICE: Record<InvoiceStatus, PaymentState> = {
  [InvoiceStatus.DRAFT]: PaymentState.NOT_SENT,
  [InvoiceStatus.ISSUED]: PaymentState.UNPAID,
  [InvoiceStatus.PART_PAID]: PaymentState.PART_PAID,
  [InvoiceStatus.PAID]: PaymentState.PAID,
  [InvoiceStatus.SPONSORED]: PaymentState.PAID,
  [InvoiceStatus.REFUNDED]: PaymentState.REFUNDED,
  [InvoiceStatus.WRITTEN_OFF]: PaymentState.WRITTEN_OFF,
  [InvoiceStatus.CANCELLED]: PaymentState.NO_INVOICE,
};

/** Invoice statuses on which money is still owed — the ones that can be overdue. */
const OPEN: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID];

export function paymentStateOf(status?: InvoiceStatus | null): PaymentState {
  return status ? FROM_INVOICE[status] : PaymentState.NO_INVOICE;
}

export function isOverdue(status?: InvoiceStatus | null, dueDate?: string | null, today = new Date()): boolean {
  if (!status || !dueDate || !OPEN.includes(status)) return false;
  return dueDate < today.toISOString().slice(0, 10);
}

// ---- SQL generated from the tables above ---------------------------------

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

/** CASE expression mapping `<alias>.status` to a PaymentState. */
export function paymentStateSql(alias: string): string {
  const whens = Object.entries(FROM_INVOICE)
    .map(([inv, state]) => `WHEN ${alias}.status = ${q(inv)} THEN ${q(state)}`)
    .join(' ');
  return `(CASE WHEN ${alias}.status IS NULL THEN ${q(PaymentState.NO_INVOICE)} ${whens} END)`;
}

/** Boolean expression: money still owed and past due. */
export function overdueSql(alias: string): string {
  return `(${alias}.status IN (${OPEN.map(q).join(', ')}) AND ${alias}."dueDate" < CURRENT_DATE)`;
}
