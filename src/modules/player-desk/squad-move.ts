/**
 * Squad moves (Karim, 12 Oct 2026) — the pure arithmetic, kept free of the database
 * so it can be unit-tested.
 *
 * The price list charges by category and sessions a week, not by level: a move that
 * keeps the sessions a week (e.g. Development 2×/week → an Advanced team on Tue/Thu)
 * costs nothing.
 *
 * Otherwise the two-calendar rule (Karim, 12 Oct 2026), for the same term option the
 * family already bought:
 *   new part  = new list price × new team's sessions left from the move date ÷ its sessions in the option
 *   old part  = old list price × old team's sessions left from the move date ÷ its sessions in the option
 *   difference = new part − old part      (each part rounded to the fil first)
 * then the child's existing discount % (sibling or manual) is taken off the difference.
 * Positive = to pay (move-up invoice); negative = may be credited (the desk decides).
 */

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface MoveChargeInput {
  /** VAT-inclusive list price of the purchase at the old and the new sessions-a-week. */
  oldPrice: number;
  newPrice: number;
  /** Share of the OLD team's sessions in the purchase still to come from the move date (1 = all of it). */
  oldRatio: number;
  /** Share of the NEW team's sessions in the purchase from the move date (1 = all of it). */
  newRatio: number;
  /** The child's discount on the original training fee, in % (0 if none). */
  discountPercent: number;
}

export interface MoveCharge {
  /** New list price × new share, and old list price × old share (VAT inclusive, rounded to the fil). */
  newPart: number;
  oldPart: number;
  /** Difference before discount, VAT inclusive: positive = to pay, negative = may be credited. */
  gross: number;
  /** The child's discount on that difference (same sign as gross). */
  discount: number;
  /** What the family pays (positive) or may be credited (negative), VAT inclusive. */
  amount: number;
  direction: 'UP' | 'DOWN' | 'SAME';
}

const share = (x: number) => Math.min(1, Math.max(0, Number.isFinite(x) ? x : 1));

export function moveCharge(i: MoveChargeInput): MoveCharge {
  const newPart = r2(i.newPrice * share(i.newRatio));
  const oldPart = r2(i.oldPrice * share(i.oldRatio));
  const gross = r2(newPart - oldPart);
  const pct = Math.min(100, Math.max(0, i.discountPercent || 0));
  const discount = r2(gross * pct / 100);
  const amount = r2(gross - discount);
  return { newPart, oldPart, gross, discount, amount, direction: Math.abs(amount) < 0.005 ? 'SAME' : amount > 0 ? 'UP' : 'DOWN' };
}

/**
 * Percentages for n instalments, two decimals, adding up to exactly 100
 * (the last one takes the remainder): 3 → 33.33, 33.33, 33.34.
 */
export function evenPercents(n: number): number[] {
  if (n < 1) return [];
  const each = Math.floor((100 / n) * 100) / 100;
  const out = Array.from({ length: n }, () => each);
  out[n - 1] = r2(100 - each * (n - 1));
  return out;
}

/**
 * The child's discount on the original training fee, as a percentage of the list
 * price on that invoice (sibling and manual discounts never stack, so it is one figure).
 */
export function discountPercentOf(trainingUnitNet: number, discountAmount: number): number {
  if (!(trainingUnitNet > 0) || !(discountAmount > 0)) return 0;
  return r2(Math.min(100, (discountAmount / trainingUnitNet) * 100));
}
