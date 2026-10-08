import { DiscountRule } from '../../database/entities';

/**
 * The discounts the desk can give by hand, instead of the sibling discount.
 * They come off the training fee (the season package) only — kits, the league
 * and tournaments are always charged, so a sponsored child still pays for kit.
 */
export const MANUAL_DISCOUNT_PRESETS = [
  { code: 'EARLY_BIRD_10', percent: 10, label: 'Early bird 10%', rule: DiscountRule.EARLY_BIRD },
  { code: 'DISCOUNT_10', percent: 10, label: 'Discount 10%', rule: DiscountRule.MANUAL },
  { code: 'DISCOUNT_15', percent: 15, label: 'Discount 15%', rule: DiscountRule.MANUAL },
  { code: 'DISCOUNT_25', percent: 25, label: 'Discount 25%', rule: DiscountRule.MANUAL },
  { code: 'DISCOUNT_50', percent: 50, label: 'Discount 50%', rule: DiscountRule.MANUAL },
  { code: 'SPONSORED_100', percent: 100, label: 'Sponsored 100%', rule: DiscountRule.SPONSOR },
] as const;
export type ManualPresetCode = (typeof MANUAL_DISCOUNT_PRESETS)[number]['code'];
export const MANUAL_PRESET_CODES = MANUAL_DISCOUNT_PRESETS.map((p) => p.code) as string[];

/** What the invoice needs to apply a manual discount to one child's training fee. */
export interface ManualDiscount { amount?: number; percent?: number; label: string; reason?: string | null; rule?: DiscountRule }

/** A preset, any percentage, or a fixed amount (the older way) → the discount to apply. */
export function resolveManualDiscount(input?: { preset?: string; percent?: number; amount?: number; label?: string; reason?: string } | null): ManualDiscount | undefined {
  if (!input) return undefined;
  // Any percentage the desk types in (e.g. 12.5%), not only the preset buttons.
  if (input.percent != null && Number(input.percent) > 0) {
    const pct = Math.round(Math.min(100, Number(input.percent)) * 100) / 100;
    const word = input.label?.trim() || (pct === 100 ? 'Sponsored' : 'Discount');
    return { percent: pct, label: `${word} ${pct}%`, reason: input.reason?.trim() || null,
      rule: pct === 100 ? DiscountRule.SPONSOR : DiscountRule.MANUAL };
  }
  if (input.preset) {
    const p = MANUAL_DISCOUNT_PRESETS.find((x) => x.code === input.preset);
    if (!p) return undefined;
    return { percent: p.percent, label: p.label, reason: input.reason?.trim() || null, rule: p.rule };
  }
  if (input.amount && input.amount > 0) return { amount: input.amount, label: input.label?.trim() || 'Manual discount', reason: input.reason?.trim() || null, rule: DiscountRule.MANUAL };
  return undefined;
}

/** The AED off a fee (excl. VAT). */
export function manualAmount(m: ManualDiscount, fee: number) {
  const raw = m.percent != null ? fee * (m.percent / 100) : (m.amount ?? 0);
  return Math.min(Math.round(raw * 100) / 100, fee);
}
