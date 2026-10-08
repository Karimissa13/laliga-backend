/**
 * Instalments, worked out from the payments ledger.
 *
 * Each instalment owes its share of the invoice total (incl. VAT). What it has
 * received comes from the payments: a payment taken "for instalment 2" goes to
 * instalment 2 first, anything else fills the instalments in order. Refunds and
 * a general write-off come off the last instalments first; a waived instalment
 * is forgiven (its remainder was written off when it was waived).
 */
export const MAX_INSTALMENTS = 5;

export type InstalmentState = 'PAID' | 'WAIVED' | 'PART_PAID' | 'OVERDUE' | 'READY' | 'DUE' | 'UPCOMING';

export interface PlanRow { seq: number; percent: number; amount: number; dueDate: string; flag: string; waivedAmount: number; waivedReason?: string | null }
export interface LedgerPayment { amount: number; direction: 'INBOUND' | 'REFUND'; instalmentSeq?: number | null }

export interface InstalmentView extends PlanRow {
  paid: number; writtenOff: number; remaining: number; state: InstalmentState;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Split a total by percentages; the last instalment takes the rounding so they add up exactly. */
export function amountsFor(total: number, percents: number[]): number[] {
  const out = percents.map((p) => r2((total * p) / 100));
  if (out.length) out[out.length - 1] = r2(total - out.slice(0, -1).reduce((a, b) => a + b, 0));
  return out;
}

export function allocate(plan: PlanRow[], payments: LedgerPayment[], opts: { genericWriteOff?: number; today?: string } = {}): InstalmentView[] {
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const rows = plan.slice().sort((a, b) => a.seq - b.seq).map((p) => ({ ...p, need: r2(p.amount - p.waivedAmount), paid: 0, writtenOff: 0 }));
  // A write-off not made by waiving an instalment comes off the last ones first.
  let wo = r2(Math.max(0, opts.genericWriteOff ?? 0));
  for (let i = rows.length - 1; i >= 0 && wo > 0.004; i--) {
    const d = Math.min(rows[i].need, wo); rows[i].need = r2(rows[i].need - d); rows[i].writtenOff = r2(d); wo = r2(wo - d);
  }
  let pool = 0;
  for (const p of payments) {
    if (p.direction === 'REFUND') { pool -= p.amount; continue; }
    const row = p.instalmentSeq ? rows.find((x) => x.seq === p.instalmentSeq) : undefined;
    if (row) {
      const take = Math.min(Math.max(0, row.need - row.paid), p.amount);
      row.paid = r2(row.paid + take); pool += p.amount - take;
    } else pool += p.amount;
  }
  pool = r2(pool);
  if (pool < 0) {
    // Refunded more than the untagged payments: take it back from the last instalments.
    let back = -pool; pool = 0;
    for (let i = rows.length - 1; i >= 0 && back > 0.004; i--) {
      const d = Math.min(rows[i].paid, back); rows[i].paid = r2(rows[i].paid - d); back = r2(back - d);
    }
  }
  for (const row of rows) {
    const take = Math.min(Math.max(0, row.need - row.paid), pool);
    row.paid = r2(row.paid + take); pool = r2(pool - take);
  }
  return rows.map(({ need, ...row }) => {
    const remaining = r2(Math.max(0, need - row.paid));
    let state: InstalmentState;
    if (remaining <= 0.005) state = row.flag === 'WAIVED' ? 'WAIVED' : 'PAID';
    else if (row.dueDate < today) state = 'OVERDUE';
    else if (row.flag === 'READY') state = 'READY';
    else if (row.paid > 0.005) state = 'PART_PAID';
    else if (row.dueDate === today) state = 'DUE';
    else state = 'UPCOMING';
    return { ...row, remaining, state };
  });
}

export const INSTALMENT_STATE_LABEL: Record<InstalmentState, string> = {
  PAID: 'Paid', WAIVED: 'Waived', PART_PAID: 'Part paid', OVERDUE: 'Overdue', READY: 'Ready to pay', DUE: 'Due today', UPCOMING: 'Not paid',
};

/** The rules for a plan typed by staff. Returns the problem in plain words, or null when it's fine. */
export function planProblem(items: Array<{ percent: number; dueDate: string }>): string | null {
  if (items.length < 2 || items.length > MAX_INSTALMENTS) return `An instalment plan has 2 to ${MAX_INSTALMENTS} instalments.`;
  for (const [i, it] of items.entries()) {
    const pct = Number(it.percent);
    if (!(pct > 0) || pct >= 100) return `Instalment ${i + 1}: the percentage must be between 0.01 and 99.99.`;
    if (Math.abs(pct * 100 - Math.round(pct * 100)) > 1e-6) return `Instalment ${i + 1}: use at most two decimals.`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(it.dueDate || '')) return `Instalment ${i + 1}: choose a due date.`;
    if (i > 0 && it.dueDate < items[i - 1].dueDate) return `Instalment ${i + 1} is due before instalment ${i}.`;
  }
  const sum = r2(items.reduce((a, it) => a + Number(it.percent), 0));
  if (Math.abs(sum - 100) > 0.001) return `The percentages add up to ${sum}% — they must make 100%.`;
  return null;
}
