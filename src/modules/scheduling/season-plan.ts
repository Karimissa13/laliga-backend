/**
 * The season's training sessions, worked out from each team's schedule.
 * Pure: no database, so the seed, the service and the tests share it.
 *
 * A team trains on its training days, at its slot, on every day of every term,
 * except days marked "no training" (public holidays, school breaks). Times are
 * Abu Dhabi time (UTC+4, no daylight saving).
 */

export const DUBAI_OFFSET = '+04:00';
const WD = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export interface PlanTeam { id: string; trainingDays: string[]; startTime?: string | null; endTime?: string | null }
export interface PlanTerm { id: string; startDate: string; endDate: string }
export interface Closure { startDate: string; endDate: string; title?: string }
export interface PlannedSession { teamId: string; termId: string; date: string; startsAt: Date; endsAt: Date }

const hm = (t?: string | null) => (t ? t.slice(0, 5) : null);

/** Every date (YYYY-MM-DD) from a to b inclusive. */
export function eachDate(a: string, b: string): string[] {
  const out: string[] = [];
  const d = new Date(a + 'T00:00:00Z'), end = new Date(b + 'T00:00:00Z');
  while (d <= end) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1); }
  return out;
}

export function weekdayOf(date: string): string {
  return WD[new Date(date + 'T00:00:00Z').getUTCDay()];
}

export function at(date: string, time: string): Date {
  return new Date(`${date}T${time}:00${DUBAI_OFFSET}`);
}

export function planTeamSessions(team: PlanTeam, terms: PlanTerm[], closures: Closure[], range?: { from?: string; to?: string }): PlannedSession[] {
  const start = hm(team.startTime), end = hm(team.endTime);
  if (!start || !end || !team.trainingDays?.length) return [];
  const closed = new Set(closures.flatMap((c) => eachDate(c.startDate, c.endDate)));
  const out: PlannedSession[] = [];
  for (const term of terms) {
    const a = range?.from && range.from > term.startDate ? range.from : term.startDate;
    const b = range?.to && range.to < term.endDate ? range.to : term.endDate;
    if (a > b) continue;
    for (const date of eachDate(a, b)) {
      if (!team.trainingDays.includes(weekdayOf(date)) || closed.has(date)) continue;
      out.push({ teamId: team.id, termId: term.id, date, startsAt: at(date, start), endsAt: at(date, end) });
    }
  }
  return out;
}
