import { TermPackage } from '../../database/entities/enums';

/**
 * Pure pricing rules for the 2026/27 price list. Kept free of the database so
 * they can be unit-tested and reused by quotes, invoices and the dashboard.
 */

export const PACKAGES: TermPackage[] = [
  TermPackage.T1, TermPackage.T2, TermPackage.T3, TermPackage.T1_2, TermPackage.T2_3, TermPackage.FULL,
];

export const PACKAGE_LABEL: Record<TermPackage, string> = {
  T1: 'Term 1', T2: 'Term 2', T3: 'Term 3', T1_2: 'Terms 1 & 2', T2_3: 'Terms 2 & 3', FULL: 'Full season',
};

/** Which of the season's terms (by position: 0 = Term 1) each option covers. */
export const PACKAGE_TERMS: Record<TermPackage, number[]> = {
  T1: [0], T2: [1], T3: [2], T1_2: [0, 1], T2_3: [1, 2], FULL: [0, 1, 2],
};

/** The option a set of term positions corresponds to, or null if it isn't one (e.g. Terms 1 and 3). */
export function packageForPositions(positions: number[]): TermPackage | null {
  const key = [...new Set(positions)].sort((a, b) => a - b).join(',');
  return (Object.keys(PACKAGE_TERMS) as TermPackage[]).find((p) => PACKAGE_TERMS[p].join(',') === key) ?? null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Split a VAT-inclusive price into net + VAT. VAT is taken as the remainder
 * (price × 5/105), so the invoice always totals the advertised figure:
 * AED 2,455 is 2,338.10 + 116.90, never 2,455.01. Rounding the net first and
 * then charging 5% on it can miss by a fil for about one price in ten.
 */
export function splitIncl(incl: number, vatRate: number): { net: number; vat: number } {
  const net = round2(incl / (1 + vatRate / 100));
  return { net, vat: round2(incl - net) };
}

/**
 * VAT for a line. When nothing was taken off a VAT-inclusive price, VAT is the
 * remainder of that price; otherwise it is the rate on the discounted net.
 */
export function lineVat(net: number, vatRate: number, inclPrice?: number | null, discounted = false): number {
  if (inclPrice != null && !discounted) return splitIncl(inclPrice, vatRate).vat;
  return round2(net * vatRate / 100);
}

/** U6 and U8 train for an hour; every other category for an hour and a half. */
export function hoursPerSession(code?: string | null): number {
  const n = Number(String(code || '').replace(/\D/g, ''));
  return n && n <= 8 ? 1 : 1.5;
}

/**
 * Sessions a week a team trains, which picks the price-list tier. Development
 * squads train twice a week, Advanced and HPC three times, unless the team's own
 * schedule says otherwise. A development family can also buy a 1-day place.
 */
export function defaultSessionsPerWeek(team?: { trainingDays?: string[] | null; level?: string | null } | null): number {
  const days = team?.trainingDays?.length ?? 0;
  if (days >= 1 && days <= 3) return days;
  return team?.level && team.level !== 'DEVELOPMENT' ? 3 : 2;
}

/**
 * Which sessions-a-week tiers each level can buy, from the price-list headings:
 * 1 a week is Development only, 2 a week is Development & Advanced, 3 a week is
 * Advanced & HPC.
 */
export const TIERS_FOR_LEVEL: Record<string, number[]> = {
  DEVELOPMENT: [1, 2], ADVANCED: [2, 3], HPC: [3],
};
export function tierAllowed(level: string | null | undefined, spw: number): boolean {
  return !level || !TIERS_FOR_LEVEL[level] || TIERS_FOR_LEVEL[level].includes(spw);
}
