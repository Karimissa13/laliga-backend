import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { RevenueStream } from '../../database/entities';

const money = (n: number) => Math.round(n * 100) / 100;
const DAY = 86400000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Colour-stable order of the revenue streams on the finance charts. */
export const STREAMS: Array<{ key: RevenueStream; label: string }> = [
  { key: RevenueStream.ACADEMY, label: 'LALIGA Academy' },
  { key: RevenueStream.KITS, label: 'Kits sales' },
  { key: RevenueStream.MAN_CITY_LEAGUE, label: 'Manchester City League' },
  { key: RevenueStream.ABU_DHABI_CUP, label: 'Abu Dhabi Cup' },
  { key: RevenueStream.RAMADAN_CUP, label: 'Ramadan Cup' },
  { key: RevenueStream.SALOU_CUP, label: 'Salou Cup' },
  { key: RevenueStream.OTHER, label: 'Other' },
];
const KIT_TYPES = [
  { key: 'HOME', label: 'Home kit' }, { key: 'AWAY', label: 'Away kit' }, { key: 'TOP', label: 'Top' },
  { key: 'TRAINING', label: 'Training kit' }, { key: 'GOALKEEPER', label: 'Goalkeeper kit' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SEASON_COLS = `id, name, "isActive", "startDate"::text AS "startDate", "endDate"::text AS "endDate"`;

export interface OverviewFilter { seasonId?: string; locationId?: string }

/**
 * Everything the dashboard shows, in one call, for one season and optionally one
 * location. Every figure is computed from the ledger and registers — nothing is
 * stored or typed in.
 *
 * Definitions (shown on the screen as tooltips, so nobody has to guess):
 *  - Registered players: children with an active enrolment in the season.
 *  - Revenue: invoiced (issued, not cancelled) less refunds and write-offs,
 *    split into collected (direct money — never wallet use or write-offs) and still
 *    pending. Months are by invoice date.
 *  - Unpaid: issued or part-paid invoices with a balance; aging by due date.
 */
@Injectable()
export class DashboardOverviewService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  async overview(f: OverviewFilter, opts: { finance: boolean; today?: Date }) {
    const today = opts.today ?? new Date();
    const [season] = f.seasonId
      ? await this.ds.query(`SELECT ${SEASON_COLS} FROM seasons WHERE id = $1`, [f.seasonId])
      : await this.ds.query(`SELECT ${SEASON_COLS} FROM seasons WHERE "isActive" ORDER BY "startDate" DESC NULLS LAST LIMIT 1`);
    if (!season) throw new BadRequestException('No season found');
    const terms: any[] = await this.ds.query(
      `SELECT id, name, "startDate"::text AS "startDate", "endDate"::text AS "endDate", weeks
       FROM terms WHERE "seasonId" = $1 AND type = 'TERM' AND "isActive" ORDER BY "startDate"`, [season.id]);
    const [location] = f.locationId ? await this.ds.query(`SELECT id, name FROM locations WHERE id = $1`, [f.locationId]) : [null];

    const ctx = { season, terms, loc: f.locationId ?? null, today };
    const [players, coaches, attendance, schedule, wallet] = await Promise.all([
      this.players(ctx), this.coaches(ctx), this.attendance(ctx), this.schedule(ctx), this.walletBalance(ctx),
    ]);
    return {
      generatedAt: today.toISOString(),
      filters: {
        season: { id: season.id, name: season.name, startDate: season.startDate, endDate: season.endDate },
        location: location ? { id: location.id, name: location.name } : null,
      },
      wallet,
      admin: { players, coaches, attendance, schedule },
      finance: opts.finance ? await this.finance(ctx) : null,
    };
  }

  // ---------------------------------------------------------------- players

  private async players(c: Ctx) {
    // Distinct children enrolled at time T: created by then, not cancelled, not
    // yet ended, not archived by then. The last point is "now".
    const points: Array<{ at: string; n: number }> = await this.ds.query(
      `SELECT to_char(t.at, 'YYYY-MM-DD') AS at,
              (SELECT count(DISTINCT e."playerId")::int FROM enrolments e
                 JOIN players p ON p.id = e."playerId"
                 LEFT JOIN teams tm ON tm.id = e."teamId"
               WHERE e."seasonId" = $1
                 AND e.status IN ('ACTIVE', 'TRANSFERRED', 'COMPLETED')
                 AND e."createdAt" <= t.at
                 AND (e."endedAt" IS NULL OR e."endedAt" > t.at)
                 AND (p."archivedAt" IS NULL OR p."archivedAt" > t.at)
                 AND ($2::uuid IS NULL OR tm."locationId" = $2)) AS n
       FROM generate_series($3::timestamptz - interval '7 weeks', $3::timestamptz, interval '1 week') AS t(at)
       ORDER BY t.at`,
      [c.season.id, c.loc, c.today.toISOString()]);
    const now = points[points.length - 1]?.n ?? 0;
    const weekAgo = points[points.length - 2]?.n ?? 0;
    const [w] = await this.ds.query(
      `SELECT count(DISTINCT e."playerId")::int n FROM enrolments e JOIN players p ON p.id = e."playerId"
       LEFT JOIN teams tm ON tm.id = e."teamId"
       WHERE e."seasonId" = $1 AND e.status = 'PENDING' AND p."archivedAt" IS NULL
         AND ($2::uuid IS NULL OR tm."locationId" = $2 OR e."teamId" IS NULL)`, [c.season.id, c.loc]);
    return {
      registered: now,
      lastWeek: weekAgo,
      change: now - weekAgo,
      changePct: weekAgo ? Math.round(((now - weekAgo) / weekAgo) * 1000) / 10 : null,
      waitlisted: w?.n ?? 0,
      spark: points,
    };
  }

  // ---------------------------------------------------------------- coaches

  private async coaches(c: Ctx) {
    const rows: any[] = await this.ds.query(
      `SELECT co.id, u."fullName" AS name, co."employmentType", co."photoUrl",
              count(t.id)::int AS teams
       FROM coaches co JOIN users u ON u.id = co."userId"
       LEFT JOIN teams t ON t."headCoachId" = co.id AND t."isActive" AND t."seasonId" = $1
            AND ($2::uuid IS NULL OR t."locationId" = $2)
       WHERE co."isActive"
       GROUP BY co.id, u."fullName"
       ORDER BY count(t.id) DESC, u."fullName"`, [c.season.id, c.loc]);
    // With a location chosen, a coach counts there if they head a team there.
    const scoped = c.loc ? rows.filter((r) => r.teams > 0) : rows;
    const count = (t: string | null) => scoped.filter((r) => (r.employmentType ?? null) === t).length;
    return {
      total: scoped.length,
      fullTime: count('FULL_TIME'),
      partTime: count('PART_TIME'),
      notSet: count(null),
      featured: scoped.slice(0, 3).map((r) => ({
        id: r.id, name: r.name, teams: r.teams, employmentType: r.employmentType, photoUrl: r.photoUrl ?? null,
      })),
    };
  }

  // ------------------------------------------------------------- attendance

  private async attendance(c: Ctx) {
    const rows: any[] = await this.ds.query(
      `SELECT COALESCE(ag.code, '—') AS code,
              count(*)::int AS marked,
              count(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE'))::int AS present
       FROM attendances a
       JOIN sessions s ON s.id = a."sessionId"
       JOIN players p ON p.id = a."playerId"
       LEFT JOIN age_groups ag ON ag.id = p."ageGroupId"
       LEFT JOIN teams t ON t.id = s."teamId"
       WHERE (s."termId" = ANY($1::uuid[]) OR (s."startsAt"::date BETWEEN $2::date AND $3::date))
         AND ($4::uuid IS NULL OR COALESCE(s."locationId", t."locationId") = $4)
       GROUP BY ag.code`,
      [c.terms.map((t) => t.id), c.season.startDate, c.season.endDate, c.loc]);
    const marked = rows.reduce((s, r) => s + r.marked, 0);
    const present = rows.reduce((s, r) => s + r.present, 0);
    const band = (x: string) => Number(x.replace(/\D/g, '')) || 999;
    return {
      overallPct: marked ? Math.round((present / marked) * 100) : null,
      marked, present,
      byCategory: rows
        .map((r) => ({ code: r.code, pct: r.marked ? Math.round((r.present / r.marked) * 100) : null, marked: r.marked }))
        .sort((a, b) => band(a.code) - band(b.code)),
    };
  }

  // --------------------------------------------------------------- schedule

  private async schedule(c: Ctx) {
    const start = c.terms[0]?.startDate ?? c.season.startDate;
    const end = c.terms[c.terms.length - 1]?.endDate ?? c.season.endDate;
    if (!start || !end) return null;
    const monday = (d: string) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x; };
    const w0 = monday(start);
    const weekOf = (d: string) => Math.floor((new Date(d + 'T00:00:00Z').getTime() - w0.getTime()) / (7 * DAY)) + 1;
    const lastWeek = weekOf(end);
    const todayIso = iso(c.today);

    const events: any[] = await this.ds.query(
      `SELECT e.id, e.kind, e.title, e."startDate"::text AS "startDate", e."endDate"::text AS "endDate",
              e.notes, l.name AS location
       FROM academy_events e LEFT JOIN locations l ON l.id = e."locationId"
       WHERE (e."seasonId" = $1 OR e."seasonId" IS NULL)
         AND e."endDate" >= $2::date AND e."startDate" <= $3::date
         AND ($4::uuid IS NULL OR e."locationId" IS NULL OR e."locationId" = $4)
       ORDER BY e."startDate"`, [c.season.id, iso(w0), end, c.loc]);
    // Matches and events that were scheduled as sessions also belong on the timeline.
    const sessions: any[] = await this.ds.query(
      `SELECT s.id, s.type AS kind, COALESCE(s.title, initcap(s.type::text)) AS title,
              s."startsAt"::date::text AS "startDate", s."endsAt"::date::text AS "endDate", t.name AS team
       FROM sessions s LEFT JOIN teams t ON t.id = s."teamId"
       WHERE s.type IN ('MATCH', 'EVENT', 'CAMP') AND s."startsAt"::date BETWEEN $1::date AND $2::date
         AND ($3::uuid IS NULL OR COALESCE(s."locationId", t."locationId") = $3)
       ORDER BY s."startsAt" LIMIT 200`, [iso(w0), end, c.loc]);

    const span = (x: { startDate: string; endDate: string }) => ({
      startWeek: Math.max(1, weekOf(x.startDate)), endWeek: Math.min(lastWeek, weekOf(x.endDate)),
    });
    const weeks = Array.from({ length: lastWeek }, (_, i) => {
      const s = new Date(w0.getTime() + i * 7 * DAY), e = new Date(s.getTime() + 6 * DAY);
      const si = iso(s), ei = iso(e);
      const term = c.terms.find((t) => t.startDate <= ei && t.endDate >= si);
      const off = events.find((x) => x.kind === 'HOLIDAY' && x.startDate <= iso(new Date(s.getTime() + 4 * DAY)) && x.endDate >= si);
      return { n: i + 1, start: si, end: ei, term: term?.name ?? null, holiday: off?.title ?? null };
    });
    const currentWeek = Math.min(lastWeek, Math.max(1, weekOf(todayIso)));
    const remaining = weeks.filter((w) => w.n >= currentWeek && w.term && !w.holiday && w.end >= todayIso).length;
    const currentTerm = c.terms.find((t) => t.startDate <= todayIso && t.endDate >= todayIso) ?? null;
    return {
      currentWeek, lastWeek, remainingTrainingWeeks: remaining,
      today: todayIso,
      currentTerm: currentTerm ? { name: currentTerm.name, endDate: currentTerm.endDate } : null,
      weeks,
      terms: c.terms.map((t) => ({ name: t.name, startDate: t.startDate, endDate: t.endDate, ...span(t) })),
      bookings: events.filter((e) => e.kind === 'PITCH_BOOKING').map((e) => ({ ...e, ...span(e) })),
      events: [
        ...events.filter((e) => ['MATCH', 'TOURNAMENT', 'EVENT', 'CAMP'].includes(e.kind)).map((e) => ({ ...e, source: 'calendar' })),
        ...sessions.map((s) => ({ ...s, source: 'session' })),
      ].map((e) => ({ ...e, ...span(e) })).sort((a, b) => a.startDate.localeCompare(b.startDate)),
      holidays: events.filter((e) => e.kind === 'HOLIDAY').map((e) => ({ ...e, ...span(e) })),
    };
  }

  // ----------------------------------------------------------------- wallet

  private async walletBalance(c: Ctx) {
    const [r] = await this.ds.query(
      `SELECT COALESCE(sum(w.balance), 0)::float AS balance, count(*) FILTER (WHERE w.balance > 0)::int AS families
       FROM wallets w
       WHERE $1::uuid IS NULL OR EXISTS (
         SELECT 1 FROM players p JOIN teams t ON t.id = p."currentTeamId"
         WHERE p."guardianId" = w."guardianId" AND t."locationId" = $1)`, [c.loc]);
    return { balance: money(r.balance), familiesWithCredit: r.families };
  }

  // ---------------------------------------------------------------- finance

  /**
   * Invoices that belong to the season (through their enrolments, or — for
   * items-only invoices — by date) and to the location (through the team).
   */
  private scopeSql() {
    return `
      WITH scope AS (
        SELECT i.*,
          COALESCE(
            (SELECT t."locationId" FROM enrolments e JOIN teams t ON t.id = e."teamId" WHERE e."invoiceId" = i.id LIMIT 1),
            (SELECT t."locationId" FROM invoice_line_items li JOIN players p ON p.id = li."playerId"
               JOIN teams t ON t.id = p."currentTeamId" WHERE li."invoiceId" = i.id LIMIT 1)) AS loc,
          (SELECT min(tr."startDate") FROM enrolments e JOIN terms tr ON tr.id = e."termId" WHERE e."invoiceId" = i.id) AS "termStart",
          GREATEST(i.total - i."amountPaid" + i."amountRefunded" - i."writeOffAmount", 0) AS balance,
          -- Direct money only: wallet use and write-offs are not money received.
          COALESCE((SELECT sum(CASE WHEN p.direction = 'INBOUND' THEN p.amount ELSE -p.amount END)
                    FROM payments p WHERE p."invoiceId" = i.id AND p.status = 'COMPLETED' AND p.method <> 'WALLET'), 0) AS collected
        FROM invoices i
        WHERE i.status NOT IN ('DRAFT', 'CANCELLED')
          AND (EXISTS (SELECT 1 FROM enrolments e WHERE e."invoiceId" = i.id AND e."seasonId" = $1)
               OR (NOT EXISTS (SELECT 1 FROM enrolments e WHERE e."invoiceId" = i.id)
                   AND i."issueDate" BETWEEN $2::date - 90 AND $3::date + 90))
      ), inv AS (SELECT * FROM scope WHERE $4::uuid IS NULL OR loc = $4)`;
  }

  /** Chart months: the academic year, September to July for 2026/27. */
  private months(season: any) {
    // A season starting late in a month (31 Aug) is charted from the next one.
    const d0 = new Date((season.startDate ?? iso(new Date())) + 'T00:00:00Z');
    const s = new Date(Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth() + (d0.getUTCDate() > 15 ? 1 : 0), 1));
    return Array.from({ length: 11 }, (_, i) => {
      const d = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + i, 1));
      return { key: iso(d).slice(0, 7), label: MONTHS[d.getUTCMonth()], year: d.getUTCFullYear() };
    });
  }

  private async finance(c: Ctx) {
    const params = [c.season.id, c.season.startDate, c.season.endDate, c.loc];
    const scope = this.scopeSql();
    const months = this.months(c.season);
    const first = months[0].key, last = months[months.length - 1].key;

    // Each line's share of its invoice, so collected/pending can be split by stream.
    const lines: any[] = await this.ds.query(`${scope}
      SELECT inv.id, inv.status, to_char(inv."issueDate", 'YYYY-MM') AS month, inv."issueDate"::text AS "issueDate",
             inv."termStart"::text AS "termStart",
             inv.total::float AS total, inv.collected::float AS collected, inv.balance::float AS balance,
             inv."writeOffAmount"::float AS "writeOff", inv.subtotal::float AS subtotal,
             li.stream, li."lineTotal"::float AS net
      FROM inv JOIN invoice_line_items li ON li."invoiceId" = inv.id`, params);

    const streamKeys = STREAMS.map((s) => s.key);
    const blank = () => Object.fromEntries([...streamKeys, 'PENDING'].map((k) => [k, 0])) as Record<string, number>;
    const byMonth = new Map(months.map((m) => [m.key, blank()]));
    const byTerm = new Map(c.terms.map((t) => [t.name, blank()]));
    const byStream = blank();
    let collected = 0, pending = 0, billed = 0;
    const subtotals = new Map<string, number>();
    for (const l of lines) subtotals.set(l.id, (subtotals.get(l.id) ?? 0) + l.net);
    const seenInv = new Set<string>();
    for (const l of lines) {
      const sub = subtotals.get(l.id) || 0;
      const share = sub > 0 ? l.net / sub : 0;
      const paid = l.collected * share;
      const open = ['ISSUED', 'PART_PAID'].includes(l.status) ? l.balance * share : 0;
      const m = l.month < first ? first : l.month > last ? last : l.month;
      const bucket = byMonth.get(m)!;
      const stream = streamKeys.includes(l.stream) ? l.stream : RevenueStream.OTHER;
      bucket[stream] += paid; bucket.PENDING += open;
      const termName = this.termFor(c.terms, l.termStart ?? l.issueDate);
      if (termName) { const tb = byTerm.get(termName)!; tb[stream] += paid; tb.PENDING += open; }
      byStream[stream] += paid + open;
      collected += paid; pending += open;
      if (!seenInv.has(l.id)) { seenInv.add(l.id); billed += l.total; }
    }
    const round = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, money(v)]));
    const revenue = money(collected + pending);

    // Kits sold, by piece, from the kit contents recorded on each sale.
    const kits: any[] = await this.ds.query(`${scope}
      SELECT k->>'type' AS type, sum((k->>'qty')::int)::int AS units
      FROM inv JOIN invoice_line_items li ON li."invoiceId" = inv.id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(li."kitItems", '[]'::jsonb)) k
      WHERE inv.status NOT IN ('REFUNDED')
      GROUP BY k->>'type'`, params);
    const kitUnits = new Map(kits.map((k) => [k.type, k.units]));

    // Payment status by invoice.
    const statusRows: any[] = await this.ds.query(`${scope}
      SELECT inv.status, count(*)::int AS n, sum(inv.total)::float AS amount,
             sum(inv.balance)::float AS balance,
             count(*) FILTER (WHERE inv."dueDate" < $5::date)::int AS overdue
      FROM inv WHERE inv.total > 0 GROUP BY inv.status`, [...params, iso(c.today)]);
    const st = (s: string) => statusRows.find((r) => r.status === s) ?? { n: 0, amount: 0, balance: 0, overdue: 0 };

    const [unpaid] = await this.ds.query(`${scope}
      SELECT count(DISTINCT inv.id)::int AS invoices,
             count(DISTINCT li."playerId")::int AS players
      FROM inv JOIN invoice_line_items li ON li."invoiceId" = inv.id
      WHERE inv.status IN ('ISSUED', 'PART_PAID') AND inv.balance > 0.05`, params);
    const aging: any[] = await this.ds.query(`${scope}
      SELECT CASE
               WHEN inv."dueDate" IS NULL OR inv."dueDate" >= $5::date THEN 'NOT_DUE'
               WHEN $5::date - inv."dueDate" <= 30 THEN 'D0_30'
               WHEN $5::date - inv."dueDate" <= 60 THEN 'D31_60'
               ELSE 'D60_PLUS' END AS bucket,
             count(*)::int AS n, sum(inv.balance)::float AS amount
      FROM inv WHERE inv.status IN ('ISSUED', 'PART_PAID') AND inv.balance > 0.05
      GROUP BY 1`, [...params, iso(c.today)]);
    const ag = (k: string) => { const r = aging.find((a) => a.bucket === k); return { count: r?.n ?? 0, amount: money(r?.amount ?? 0) }; };
    const totalUnpaid = money(aging.reduce((s, a) => s + a.amount, 0));

    const [credited] = await this.ds.query(
      `SELECT COALESCE(sum(wt.amount), 0)::float AS amount
       FROM wallet_transactions wt JOIN wallets w ON w.id = wt."walletId"
       WHERE wt.type = 'CREDIT' AND wt."createdAt"::date BETWEEN $1::date - 90 AND $2::date + 90
         AND ($3::uuid IS NULL OR EXISTS (
           SELECT 1 FROM players p JOIN teams t ON t.id = p."currentTeamId"
           WHERE p."guardianId" = w."guardianId" AND t."locationId" = $3))`,
      [c.season.startDate, c.season.endDate, c.loc]);

    const pct = (n: number) => (revenue > 0 ? Math.round((n / revenue) * 1000) / 10 : null);
    return {
      streams: STREAMS.map((s) => ({ ...s, amount: money(byStream[s.key]) })).filter((s) => s.key !== RevenueStream.OTHER || s.amount > 0),
      revenue: {
        total: revenue, collected: money(collected), pending: money(pending), billed: money(billed),
        months: months.map((m) => ({ ...m, ...round(byMonth.get(m.key)!) })),
        terms: c.terms.map((t) => ({ key: t.name, label: t.name, ...round(byTerm.get(t.name)!) })),
      },
      kits: {
        types: KIT_TYPES.map((k) => ({ ...k, units: kitUnits.get(k.key) ?? 0 })),
        units: kits.reduce((s, k) => s + k.units, 0),
        revenue: money(byStream[RevenueStream.KITS]),
      },
      payments: {
        fullyPaid: { count: st('PAID').n, amount: money(st('PAID').amount) },
        partiallyPaid: { count: st('PART_PAID').n, amount: money(st('PART_PAID').amount), balance: money(st('PART_PAID').balance) },
        unpaid: { count: st('ISSUED').n, amount: money(st('ISSUED').amount) },
        unpaidPlayers: unpaid?.players ?? 0,
        unpaidInvoices: unpaid?.invoices ?? 0,
        totalUnpaid,
        unpaidPctOfRevenue: pct(totalUnpaid),
        aging: { notDue: ag('NOT_DUE'), d0_30: ag('D0_30'), d31_60: ag('D31_60'), d60plus: ag('D60_PLUS') },
        walletCredited: money(credited.amount),
        walletCreditedPct: pct(credited.amount),
      },
    };
  }

  private termFor(terms: any[], date?: string | null) {
    if (!date || !terms.length) return null;
    return (terms.find((t) => date <= t.endDate) ?? terms[terms.length - 1]).name;
  }
}

type Ctx = { season: any; terms: any[]; loc: string | null; today: Date };
