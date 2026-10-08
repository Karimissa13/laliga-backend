/**
 * Age-group derivation. Legacy system stored age bands as free text and assigned
 * them manually; here the band is derived from DOB + the season cutoff year.
 *
 * Football age groups are by birth year: "U-N" means players who are under N on
 * the cutoff date. code e.g. "U9". A player's group is the smallest UN whose
 * (cutoffYear - birthYear) < N.
 */
export function deriveAgeGroupCode(dateOfBirth: string | Date, cutoffDate?: string | Date | null): string {
  const dob = new Date(dateOfBirth);
  const cutoff = cutoffDate ? new Date(cutoffDate) : new Date();
  // Age at cutoff (whole years)
  let age = cutoff.getFullYear() - dob.getFullYear();
  const m = cutoff.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && cutoff.getDate() < dob.getDate())) age--;
  // Round up to the next whole age band: a 7-year-old plays U-8.
  const band = age + 1;
  return `U${band}`;
}

const bandOf = (code: string) => Number(String(code).replace(/^U/i, ''));

export interface CategoryPlacement {
  /** The category the child is placed in, or null if no category can take them. */
  code: string | null;
  /** The exact band from date of birth, e.g. "U7". */
  exact: string;
  /** True when the exact band had no category and the child was moved up. */
  playedUp: boolean;
  /** Plain-English explanation for the admin. */
  note: string;
}

/**
 * Academy rule (confirmed Oct 2026): a child whose birth year falls in a band with
 * no category PLAYS UP to the next one — U7 → U8, U15 → U16, U17 → U18.
 *
 * `activeCodes` is the list of categories the academy actually runs, so the rule
 * follows configuration: open a U15 group and U15 children stop playing up,
 * without a code change.
 */
export function placeInCategory(exact: string, activeCodes: string[]): CategoryPlacement {
  const want = bandOf(exact);
  const bands = [...new Set(activeCodes)]
    .map((c) => ({ c, n: bandOf(c) }))
    .filter((x) => Number.isFinite(x.n))
    .sort((a, b) => a.n - b.n);

  const hit = bands.find((b) => b.n === want);
  if (hit) return { code: hit.c, exact, playedUp: false, note: `${exact} from date of birth` };

  const up = bands.find((b) => b.n > want);
  if (up) {
    return {
      code: up.c, exact, playedUp: true,
      note: `${exact} from date of birth — no ${exact} group, so plays up to ${up.c}`,
    };
  }
  const oldest = bands[bands.length - 1];
  return {
    code: null, exact, playedUp: false,
    note: oldest
      ? `${exact} from date of birth — older than the oldest group (${oldest.c}); place manually`
      : `${exact} from date of birth — no age categories are configured`,
  };
}
