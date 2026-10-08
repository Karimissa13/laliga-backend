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
  /** sessionsLeft ÷ sessionsTotal, 4 decimals. */
  ratio: number;
  /** How the sessions were counted: the team's planned sessions, or its training days on the calendar. */
  basis: 'team sessions' | 'training days' | 'days';
}

type TermLike = { id: string; name?: string; startDate?: string | null; endDate?: string | null };
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
 * Prorating by sessions left (Karim, Oct 2026): a child who starts after the
 * first day pays training × sessions from the start date ÷ sessions in the
 * purchase. Sessions come from the team's season plan, so closures and
 * holidays already left out of the schedule don't count. Without a team (or a
 * plan), the team's training days on the calendar are counted instead.
 * Kits, the league and tournaments are never prorated.
 */
@Injectable()
export class ProrationService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Null when the start date is on or before the first day — full price. */
  async forPurchase(terms: TermLike[], team: TeamLike, startDate?: string | null): Promise<Proration | null> {
    if (!startDate) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) throw new BadRequestException('The start date must be a date (YYYY-MM-DD).');
    const dated = terms.filter((t) => t.startDate && t.endDate)
      .sort((a, b) => String(a.startDate).localeCompare(String(b.startDate)));
    if (!dated.length) return null;
    const first = dated[0].startDate!, last = dated[dated.length - 1].endDate!;
    if (startDate <= first) return null;
    if (startDate > last) throw new BadRequestException(`The start date is after the last day of this option (${last}).`);

    let total = 0, left = 0, basis: Proration['basis'] = 'team sessions';
    if (team?.id) {
      const [r] = await this.ds.query(
        `WITH r(f, t) AS (SELECT * FROM unnest($3::date[], $4::date[])),
              s AS (SELECT (x."startsAt" AT TIME ZONE 'Asia/Dubai')::date AS d FROM sessions x
                     WHERE x."teamId" = $1 AND x."isCancelled" = false AND x.type = 'TRAINING')
         SELECT count(*)::int AS total, count(*) FILTER (WHERE s.d >= $2::date)::int AS "left"
           FROM s WHERE EXISTS (SELECT 1 FROM r WHERE s.d BETWEEN r.f AND r.t)`,
        [team.id, startDate, dated.map((t) => t.startDate), dated.map((t) => t.endDate)],
      );
      total = r?.total ?? 0; left = r?.left ?? 0;
    }
    if (!total) {
      const c = countByCalendar(dated, startDate, team?.trainingDays);
      total = c.total; left = c.left;
      basis = team?.trainingDays?.length ? 'training days' : 'days';
    }
    if (!total) return null;
    if (!left) throw new BadRequestException('There are no sessions left from this start date.');
    return { startDate, sessionsLeft: left, sessionsTotal: total, ratio: Math.round((left / total) * 10000) / 10000, basis };
  }
}
