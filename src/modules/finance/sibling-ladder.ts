/**
 * The sibling-discount ladder.
 *
 * Academy policy (confirmed by operations, Oct 2026): the first child pays full
 * price, the second gets 15%, the third 25%, and the fourth and beyond also 25%.
 *
 * Kept as a pure function with no database or framework dependency so the policy
 * can be unit-tested on its own and so there is exactly one place that knows the
 * percentages.
 */

export interface SiblingLadder {
  /** Percentage for the 2nd child, 3rd child, … in order. */
  tiers: number[];
  /** Percentage for any child beyond the last entry in `tiers`. */
  beyond: number;
}

export const DEFAULT_SIBLING_LADDER: SiblingLadder = { tiers: [15, 25], beyond: 25 };

/**
 * Percentage for a child at 1-based position `rank` within the family.
 * Rank 1 is the child who pays full price.
 */
export function ladderPercent(rank: number, ladder: SiblingLadder = DEFAULT_SIBLING_LADDER): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  if (rank === 1) return 0;
  const idx = rank - 2;                       // rank 2 -> tiers[0]
  if (idx < ladder.tiers.length) return ladder.tiers[idx];
  return ladder.beyond;
}

/**
 * Read a ladder out of a Discount row's `params`, falling back to the default.
 * Shape: { "tiers": [15, 25], "beyond": 25 }
 */
export function ladderFromParams(params?: Record<string, any> | null): SiblingLadder {
  // All-or-nothing on purpose. Dropping a single bad entry would re-index the
  // ladder — a typo of 150 in the 2nd-child slot would silently promote the
  // 3rd-child rate to the 2nd child. A bad ladder falls back to policy instead.
  let tiers: number[] | null = null;
  if (Array.isArray(params?.tiers)) {
    const parsed = params!.tiers.map(Number);
    const allValid = parsed.length > 0
      && parsed.every((n: number) => Number.isFinite(n) && n >= 0 && n <= 100);
    tiers = allValid ? parsed : null;
  }
  const beyondRaw = Number(params?.beyond);
  const beyond = Number.isFinite(beyondRaw) && beyondRaw >= 0 && beyondRaw <= 100
    ? beyondRaw
    : (tiers?.length ? tiers[tiers.length - 1] : DEFAULT_SIBLING_LADDER.beyond);
  return {
    tiers: tiers?.length ? tiers : DEFAULT_SIBLING_LADDER.tiers,
    beyond,
  };
}

/** Human wording for the invoice and the admin screen. */
export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
