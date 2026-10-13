import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Weekday } from '../../database/entities/enums';

/** What a start date after the first day does to a purchase's training fee. */
export interface Proration {
  /** The day the child starts (YYYY-MM-DD). */
  startDate: string;
  /** Sessions from the start date to the end of the purchase. */
  sessionsLeft: number;
  /** Sessions in the whole purchase. */
  sessionsTotal: number;
  /** sessionsLeft ÷ sessionsTotal, exact (never rounded before it multiplies a price). */
  ratio: number;
  /** How the sessions were counted: the package's assigned sessions (weeks × sessions a week), or calendar days. */
  basis: 'package sessions' | 'training days' | 'days';
}

type TermLike = { id: string; name?: string; startDate?: string | null; endDate?: string | null; weeks?: number | null };
type TeamLike = { id: string; trainingDays?: Weekday[] | null } | null | undefined;

const DOW: Record<number, Weekday> = { 0: Weekday.SUN, 1: Weekday.MON, 2: Weekday.TUE, 3: Weekday.WED, 4: Weekday.THU, 5: Weekday.FRI, 6: Weekday.SAT };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Count the days in the term ranges (optionally only the team's weekdays), in total and from the start date. */
export function countByCalendar(terms: TermLike[], startDate: string, days?: Weekday[] | null) {
  let total = 0, left = 0;
  for (const t of terms) {
    if (!t.startDate || !t.endDate) continue;
    for (let d = new Date(t.startDate + 'T00:00:00Z'); iso(d) <= t.endDate; d.setUTCDate(d.getUTCDate() + 1)) {
      if (days?.length && !days.includes(DOW[d.getUTCDay()])) continue;
      total++;
      if (iso(d) >= startDate) left++;
    }
  }
  return { total, left };
}

/**
 * The sessions a package is sold for (Karim, 13 Oct 2026): each term's weeks × the
 * sessions a week bought — Term 1 = 15 × 2 = 30, a full season = 34 × 2 = 68 for
 * 2 a week. Public holidays and other no-training days do not reduce a package.
 *
 * Prorating: a child who starts after the first day pays the training fee ×
 * sessions left ÷ sessions in the package. Sessions left are counted on the team's
 * training days from the start date (holidays not deducted either), scaled to the
 * package when the child buys fewer sessions a week than the team trains.
 * Kits, the league and tournaments are never prorated.
 */
export function packageSessions(terms: TermLike[], startDate: string, days?: Weekday[] | null, sessionsPerWeek?: number | null) {
  const cal = countByCalendar(terms, startDate, days);
  const spw = sessionsPerWeek || days?.length || 0;
  const assigned = spw && terms.length && terms.every((t) => Number(t.weeks) > 0)
    ? terms.reduce((a, t) => a + Number(t.weeks) * spw, 0) : cal.total;
  if (!cal.total || !assigned) return { total: assigned || cal.total, left: cal.left, basis: (days?.length ? 'training days' : 'days') as Proration['basis'] };
  // The calendar matches the package (weeks × days the team trains); otherwise scale it.
  const left = assigned === cal.total ? cal.left : Math.round((assigned * cal.left) / cal.total);
  return { total: assigned, left, basis: (spw && terms.every((t) => Number(t.weeks) > 0) ? 'package sessions' : days?.length ? 'training days' : 'days') as Proration['basis'] };
}

@Injectable()
export class ProrationService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Null when the start date is on or before the first day — full price. */
  async forPurchase(terms: TermLike[], team: TeamLike, startDate?: string | null, sessionsPerWeek?: number | null): Promise<Proration | null> {
    if (!startDate) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequestException('The start date must be a date (YYYY-MM-DD).');
    const dated = terms.filter((t) => t.startDate && t.endDate)
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    if (!dated.length) return null;
    const first = dated[0].startDate!, last = dated[dated.length - 1].endDate!;
    if (startDate <= first) return null;
    if (startDate > last) throw new BadRequestException(`The start date is after the last day of this option (${last}).`);

    const { total, left, basis } = packageSessions(dated, startDate, team?.trainingDays, sessionsPerWeek);
    if (!total) return null;
    if (!left) throw new BadRequestException('There are no sessions left from this start date.');
    return { startDate, sessionsLeft: left, sessionsTotal: total, ratio: left / total, basis };
  }
}
