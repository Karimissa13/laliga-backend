import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';
import { AttendanceStatus, ProgramType, Session, SessionType, Team } from '../../database/entities';
import { Closure, PlanTerm, planTeamSessions } from './season-plan';

const dubaiDate = (d: Date) => new Date(d.getTime() + 4 * 3600000).toISOString().slice(0, 10);

/**
 * The season's training sessions for every team, and the attendance views built
 * on them: a team's register grid and the day's registers across teams.
 */
@Injectable()
export class SeasonScheduleService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private async seasonContext(seasonId?: string) {
    const [season] = seasonId
      ? await this.ds.query(`SELECT id, name FROM seasons WHERE id = $1`, [seasonId])
      : await this.ds.query(`SELECT id, name FROM seasons WHERE "isActive" LIMIT 1`);
    if (!season) throw new BadRequestException('No season');
    const terms: PlanTerm[] = await this.ds.query(
      `SELECT id, "startDate"::text AS "startDate", "endDate"::text AS "endDate" FROM terms
       WHERE "seasonId" = $1 AND type = $2 AND "isActive" AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL ORDER BY "startDate"`,
      [season.id, ProgramType.TERM]);
    const closures: Closure[] = await this.ds.query(
      `SELECT "startDate"::text AS "startDate", "endDate"::text AS "endDate", title FROM academy_events
       WHERE "noTraining" AND ("seasonId" = $1 OR "seasonId" IS NULL)`, [season.id]);
    return { season, terms, closures };
  }

  /**
   * Create the season's sessions for each team (or the given teams). Safe to run
   * again: a session already there is left alone. With `sync`, future sessions
   * that no longer fit the team's schedule — and have no attendance yet — are
   * removed, so a changed training day or time is picked up from today onwards.
   */
  async generate(input: { seasonId?: string; teamIds?: string[]; from?: string; to?: string; sync?: boolean }) {
    const { season, terms, closures } = await this.seasonContext(input.seasonId);
    if (!terms.length) throw new BadRequestException('The season has no term dates');
    const teams: Team[] = await this.ds.getRepository(Team).find({
      where: { seasonId: season.id, isActive: true, ...(input.teamIds?.length ? { id: In(input.teamIds) } : {}) },
    });
    const now = new Date();
    const report: Array<{ teamId: string; team: string; created: number; removed: number; kept: number; planned: number }> = [];
    for (const t of teams) {
      const plan = planTeamSessions(t as any, terms, closures, { from: input.from, to: input.to });
      const existing: Array<{ id: string; startsAt: Date; marks: number }> = await this.ds.query(
        `SELECT s.id, s."startsAt", (SELECT count(*)::int FROM attendances a WHERE a."sessionId" = s.id) AS marks
         FROM sessions s WHERE s."teamId" = $1 AND s.type = 'TRAINING' AND s."termId" = ANY($2::uuid[])`,
        [t.id, terms.map((x) => x.id)]);
      const have = new Set(existing.map((e) => new Date(e.startsAt).getTime()));
      const want = new Set(plan.map((p) => p.startsAt.getTime()));
      const toCreate = plan.filter((p) => !have.has(p.startsAt.getTime()));
      let removed = 0;
      if (input.sync) {
        const stale = existing.filter((e) => !want.has(new Date(e.startsAt).getTime()) && new Date(e.startsAt) > now && e.marks === 0
          && (!input.from || dubaiDate(new Date(e.startsAt)) >= input.from) && (!input.to || dubaiDate(new Date(e.startsAt)) <= input.to));
        if (stale.length) { await this.ds.getRepository(Session).delete(stale.map((s) => s.id)); removed = stale.length; }
      }
      if (toCreate.length) {
        await this.ds.getRepository(Session).insert(toCreate.map((p) => ({
          type: SessionType.TRAINING, termId: p.termId, teamId: t.id, locationId: t.locationId ?? undefined,
          coachId: t.headCoachId ?? undefined, startsAt: p.startsAt, endsAt: p.endsAt,
        })));
      }
      report.push({ teamId: t.id, team: t.name, created: toCreate.length, removed, kept: existing.length - removed, planned: plan.length });
    }
    return {
      season: season.name,
      teams: report.length,
      created: report.reduce((s, r) => s + r.created, 0),
      removed: report.reduce((s, r) => s + r.removed, 0),
      total: report.reduce((s, r) => s + r.planned, 0),
      closures: closures.map((c) => ({ title: (c as any).title, from: c.startDate, to: c.endDate })),
      byTeam: report,
    };
  }

  /** A team's register for a date range: every session as a column, every child as a row. */
  async teamGrid(teamId: string, from?: string, to?: string) {
    const [team] = await this.ds.query(
      `SELECT t.id, t.name, t.level, t."trainingDays", t."startTime"::text AS "startTime", t."endTime"::text AS "endTime",
              u."fullName" AS coach
       FROM teams t LEFT JOIN coaches c ON c.id = t."headCoachId" LEFT JOIN users u ON u.id = c."userId" WHERE t.id = $1`, [teamId]);
    if (!team) throw new NotFoundException('Team not found');
    const today = dubaiDate(new Date());
    const f = from ?? today.slice(0, 8) + '01';
    const tEnd = to ?? (() => { const d = new Date(f + 'T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() + 1); d.setUTCDate(0); return d.toISOString().slice(0, 10); })();
    const sessions: any[] = await this.ds.query(
      `SELECT s.id, s."startsAt", s."endsAt", s."isCancelled", s."cancelReason", s.type,
              (SELECT count(*)::int FROM attendances a WHERE a."sessionId" = s.id) AS marked
       FROM sessions s WHERE s."teamId" = $1 AND s."startsAt" >= ($2::date)::timestamp AT TIME ZONE 'Asia/Dubai'
         AND s."startsAt" < (($3::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai') ORDER BY s."startsAt"`, [teamId, f, tEnd]);
    const players: any[] = await this.ds.query(
      `SELECT p.id, p.reference, p."firstName" || ' ' || p."lastName" AS name, ag.code AS category
       FROM players p LEFT JOIN age_groups ag ON ag.id = p."ageGroupId"
       WHERE p."currentTeamId" = $1 AND p."archivedAt" IS NULL ORDER BY p."firstName", p."lastName"`, [teamId]);
    const marks: any[] = sessions.length ? await this.ds.query(
      `SELECT "sessionId", "playerId", status, reason FROM attendances WHERE "sessionId" = ANY($1::uuid[])`, [sessions.map((s) => s.id)]) : [];
    // Season-to-date rate per child, all sessions of this team.
    const rates: any[] = players.length ? await this.ds.query(
      `SELECT a."playerId", count(*)::int AS marked, count(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE'))::int AS present
       FROM attendances a JOIN sessions s ON s.id = a."sessionId"
       WHERE s."teamId" = $1 AND NOT s."isCancelled" AND a."playerId" = ANY($2::uuid[]) GROUP BY a."playerId"`,
      [teamId, players.map((p) => p.id)]) : [];
    const byKey = new Map(marks.map((m) => [`${m.sessionId}:${m.playerId}`, m]));
    const rate = new Map(rates.map((r) => [r.playerId, r]));
    const nowMs = Date.now();
    return {
      team, from: f, to: tEnd, today,
      sessions: sessions.map((s) => ({
        id: s.id, date: dubaiDate(new Date(s.startsAt)), startsAt: s.startsAt, endsAt: s.endsAt, type: s.type,
        cancelled: s.isCancelled, cancelReason: s.cancelReason,
        when: new Date(s.endsAt).getTime() < nowMs ? 'past' : dubaiDate(new Date(s.startsAt)) === today ? 'today' : 'future',
        marked: s.marked, complete: players.length > 0 && s.marked >= players.length,
      })),
      players: players.map((p) => {
        const r = rate.get(p.id);
        return {
          ...p,
          marks: Object.fromEntries(sessions.map((s) => [s.id, byKey.get(`${s.id}:${p.id}`)?.status ?? null])),
          seasonRate: r && r.marked ? Math.round((r.present / r.marked) * 100) : null,
          seasonMarked: r?.marked ?? 0,
        };
      }),
    };
  }

  /** Every session on a day (Abu Dhabi time) with how far its register has got. */
  async day(date?: string) {
    const d = date ?? dubaiDate(new Date());
    const rows: any[] = await this.ds.query(
      `SELECT s.id, s."startsAt", s."endsAt", s.type, s.title, s."isCancelled", s."cancelReason",
              t.id AS "teamId", t.name AS team, t.level, u."fullName" AS coach, l.name AS location,
              (SELECT count(*)::int FROM attendances a WHERE a."sessionId" = s.id) AS marked,
              (SELECT count(*)::int FROM players p WHERE p."currentTeamId" = t.id AND p."archivedAt" IS NULL) AS roster
       FROM sessions s LEFT JOIN teams t ON t.id = s."teamId" LEFT JOIN coaches c ON c.id = s."coachId"
       LEFT JOIN users u ON u.id = c."userId" LEFT JOIN locations l ON l.id = s."locationId"
       WHERE s."startsAt" >= ($1::date)::timestamp AT TIME ZONE 'Asia/Dubai'
         AND s."startsAt" < (($1::date + 1)::timestamp AT TIME ZONE 'Asia/Dubai')
       ORDER BY s."startsAt", t.name`, [d]);
    return { date: d, sessions: rows.map((r) => ({ ...r, complete: r.roster > 0 && r.marked >= r.roster })) };
  }

  async setCancelled(sessionId: string, cancelled: boolean, reason?: string) {
    const repo = this.ds.getRepository(Session);
    const s = await repo.findOne({ where: { id: sessionId } });
    if (!s) throw new NotFoundException('Session not found');
    await repo.update(sessionId, { isCancelled: cancelled, cancelReason: cancelled ? (reason?.trim() || 'Cancelled') : null });
    return { id: sessionId, cancelled, reason: cancelled ? (reason?.trim() || 'Cancelled') : null };
  }

  /** Mark everyone on the register present in one go (the coach then changes the few who weren't). */
  async markAllPresent(sessionId: string) {
    const [s] = await this.ds.query(`SELECT id, "teamId", "isCancelled", "startsAt" FROM sessions WHERE id = $1`, [sessionId]);
    if (!s) throw new NotFoundException('Session not found');
    if (s.isCancelled) throw new BadRequestException('This session was cancelled');
    if (dubaiDate(new Date(s.startsAt)) > dubaiDate(new Date())) throw new BadRequestException('This session is in the future — take the register on the day');
    await this.ds.query(
      `INSERT INTO attendances (id, "sessionId", "playerId", status, "recordedAt")
       SELECT gen_random_uuid(), $1, p.id, $2, now() FROM players p
       WHERE p."currentTeamId" = $3 AND p."archivedAt" IS NULL
       ON CONFLICT ("sessionId", "playerId") DO NOTHING`, [sessionId, AttendanceStatus.PRESENT, s.teamId]);
    return { id: sessionId };
  }
}
