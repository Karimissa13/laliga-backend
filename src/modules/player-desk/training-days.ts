/**
 * A child's own training days (Karim, 16 Oct 2026): every real training time is its own
 * team, and a child who comes fewer times a week than the team trains (1× or 2× on a
 * Tue/Wed/Thu team) picks which of the team's days. Pure, so it is unit-tested.
 */
export const WEEK = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
const NAME: Record<string, string> = { MON: 'Mon', TUE: 'Tue', WED: 'Wed', THU: 'Thu', FRI: 'Fri', SAT: 'Sat', SUN: 'Sun' };

export const sortDays = (d: string[]) => [...new Set(d)].sort((a, b) => WEEK.indexOf(a as any) - WEEK.indexOf(b as any));
export const daysText = (d: string[]) => sortDays(d).map((x) => NAME[x] ?? x).join(', ');

/**
 * What to save for `chosen` on a team training on `teamDays`, for a child paying for
 * `sessionsPerWeek` sessions: null = every team day; otherwise the sorted days.
 */
export function checkTrainingDays(teamDays: string[], chosen: string[] | null, sessionsPerWeek: number | null): { days: string[] | null } | { error: string } {
  if (!chosen || !chosen.length) return { days: null };
  const days = sortDays(chosen);
  const off = days.filter((d) => !teamDays.includes(d));
  if (!teamDays.length) return { error: 'The team has no training days set yet — set them on the team first.' };
  if (off.length) return { error: `The team doesn't train on ${daysText(off)} (it trains ${daysText(teamDays)}).` };
  if (days.length === teamDays.length) return { days: null };
  if (sessionsPerWeek && days.length !== sessionsPerWeek) {
    return { error: `This child pays for ${sessionsPerWeek}× a week — choose ${sessionsPerWeek} day${sessionsPerWeek === 1 ? '' : 's'} (${days.length} chosen).` };
  }
  return { days };
}

/** "MON" … "SUN" of a moment, in Abu Dhabi time. */
export function dubaiWeekday(at: Date | string): string {
  const d = new Date(new Date(at).getTime() + 4 * 3600000);
  return WEEK[(d.getUTCDay() + 6) % 7];
}

/**
 * SQL: how many children are on the register of session `s` (alias) of team `t` (alias) — the
 * team's children, less those whose own days leave out the session's weekday. Same rule as the register.
 */
export const REGISTER_COUNT_SQL = (s: string, t: string) => `(SELECT count(*)::int FROM players p
  WHERE p."currentTeamId" = ${t}.id AND p."archivedAt" IS NULL
    AND NOT EXISTS (SELECT 1 FROM enrolments e WHERE e."playerId" = p.id AND e."teamId" = ${t}.id
      AND e.status IN ('ACTIVE', 'PENDING') AND e."trainingDays" IS NOT NULL
      AND (${s}."termId" IS NULL OR e."termId" = ${s}."termId")
      AND NOT (upper(to_char(${s}."startsAt" AT TIME ZONE 'Asia/Dubai', 'DY')) = ANY(e."trainingDays"::text[]))))`;
