import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  Attendance, AttendanceStatus, Player, Session,
} from '../../database/entities';

@Injectable()
export class AttendanceService {
  constructor(
    @InjectRepository(Attendance) private readonly attendances: Repository<Attendance>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
  ) {}

  /**
   * The register for a session: every player on the team, with any mark already
   * recorded. This is what a coach opens on a tablet — no spreadsheet round-trip.
   */
  async register(sessionId: string) {
    const session = await this.sessions.findOne({
      where: { id: sessionId },
      relations: { team: true, venue: true, location: true, coach: { user: true } },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (!session.teamId) {
      return { session, roster: [], note: 'Session has no team assigned' };
    }
    const players = await this.players.find({
      where: { currentTeamId: session.teamId, archivedAt: IsNull() },
      relations: { ageGroup: true },
      order: { firstName: 'ASC' },
    });
    const marks = await this.attendances.find({ where: { sessionId } });
    const byPlayer = new Map(marks.map((m) => [m.playerId, m]));
    // Children booked in for a free trial at this session (from Trials & Leads).
    const trials: any[] = await this.sessions.manager.query(
      `SELECT id AS "leadId", reference, "playerName" AS name, "guardianName", "guardianMobile", "ageGroupLabel" AS category,
              "trialOutcome" AS outcome, status
       FROM leads WHERE "trialSessionId" = $1 ORDER BY "playerName"`, [sessionId]);

    return {
      trials,
      session,
      roster: players.map((p) => ({
        playerId: p.id,
        reference: p.reference,
        name: `${p.firstName} ${p.lastName}`,
        ageGroup: p.ageGroup?.code,
        status: byPlayer.get(p.id)?.status ?? null,
        reason: byPlayer.get(p.id)?.reason ?? null,
        comment: byPlayer.get(p.id)?.comment ?? null,
        marked: byPlayer.has(p.id),
      })),
      markedCount: marks.length,
      total: players.length,
      complete: players.length > 0 && marks.length >= players.length,
    };
  }

  /** Mark a whole register in one call (tap-through then submit). */
  async markBulk(sessionId: string, marks: Array<{ playerId: string; status: AttendanceStatus; reason?: string; comment?: string }>) {
    const session = await this.sessions.findOne({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Session not found');
    if (session.isCancelled) throw new BadRequestException('This session was cancelled — reinstate it before taking the register');
    const day = (d: Date) => new Date(d.getTime() + 4 * 3600000).toISOString().slice(0, 10);
    if (day(new Date(session.startsAt)) > day(new Date())) throw new BadRequestException('This session is in the future — take the register on the day');

    for (const m of marks) {
      const existing = await this.attendances.findOne({ where: { sessionId, playerId: m.playerId } });
      if (existing) {
        await this.attendances.update(existing.id, {
          status: m.status, reason: m.reason, comment: m.comment,
        });
      } else {
        await this.attendances.save(this.attendances.create({
          sessionId, playerId: m.playerId, status: m.status, reason: m.reason, comment: m.comment,
        }));
      }
    }
    return this.register(sessionId);
  }

  /** Per-player attendance rate and recent absences. */
  async playerStats(playerId: string) {
    const rows = await this.attendances.find({
      where: { playerId },
      relations: { session: true },
      order: { recordedAt: 'DESC' },
      take: 200,
    });
    const total = rows.length;
    const present = rows.filter((r) => r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE).length;
    const absent = rows.filter((r) => r.status === AttendanceStatus.ABSENT).length;
    const excused = rows.filter((r) => r.status === AttendanceStatus.EXCUSED).length;
    return {
      total, present, absent, excused,
      attendanceRate: total ? Math.round((present / total) * 100) : null,
      recent: rows.slice(0, 10).map((r) => ({
        date: r.session?.startsAt, status: r.status, reason: r.reason,
      })),
    };
  }

  /**
   * Players whose attendance has dropped — the dashboard "attendance issues"
   * alert. Flags anyone below the threshold over their last N marks.
   */
  async issues(params: { threshold?: number; minSessions?: number } = {}) {
    const threshold = params.threshold ?? 70;
    const minSessions = params.minSessions ?? 3;
    const rows = await this.attendances.find({ relations: { player: true }, take: 5000, order: { recordedAt: 'DESC' } });
    const byPlayer = new Map<string, { player: any; total: number; present: number }>();
    for (const r of rows) {
      if (!r.player) continue;
      const e = byPlayer.get(r.playerId) ?? { player: r.player, total: 0, present: 0 };
      e.total++;
      if (r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE) e.present++;
      byPlayer.set(r.playerId, e);
    }
    return [...byPlayer.values()]
      .filter((e) => e.total >= minSessions)
      .map((e) => ({
        playerId: e.player.id,
        reference: e.player.reference,
        name: `${e.player.firstName} ${e.player.lastName}`,
        sessions: e.total,
        attendanceRate: Math.round((e.present / e.total) * 100),
      }))
      .filter((e) => e.attendanceRate < threshold)
      .sort((a, b) => a.attendanceRate - b.attendanceRate);
  }

  /** Sessions in the past whose register was never submitted. */
  async unsubmitted(days = 7) {
    const from = new Date(); from.setDate(from.getDate() - days);
    const now = new Date();
    const past = await this.sessions.createQueryBuilder('s')
      .leftJoinAndSelect('s.team', 't')
      .where('s.endsAt BETWEEN :from AND :now', { from, now })
      .andWhere('s.teamId IS NOT NULL')
      .andWhere('s.isCancelled = false')
      .orderBy('s.startsAt', 'DESC')
      .getMany();

    const out: any[] = [];
    for (const s of past) {
      const marks = await this.attendances.count({ where: { sessionId: s.id } });
      const roster = await this.players.count({ where: { currentTeamId: s.teamId!, archivedAt: IsNull() } });
      if (roster > 0 && marks < roster) {
        out.push({ sessionId: s.id, startsAt: s.startsAt, team: s.team?.name, marked: marks, roster });
      }
    }
    return out;
  }

  /** Team attendance summary over a date range. */
  async teamSummary(teamId: string, from?: string, to?: string) {
    const qb = this.attendances.createQueryBuilder('a')
      .innerJoin('a.session', 's')
      .where('s.teamId = :teamId', { teamId });
    if (from) qb.andWhere('s.startsAt >= :from', { from: new Date(from) });
    if (to) qb.andWhere('s.startsAt <= :to', { to: new Date(to) });
    const rows = await qb.getMany();
    const total = rows.length;
    const present = rows.filter((r) => r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE).length;
    const byStatus: Record<string, number> = {};
    rows.forEach((r) => (byStatus[r.status] = (byStatus[r.status] || 0) + 1));
    return { teamId, totalMarks: total, present, attendanceRate: total ? Math.round((present / total) * 100) : null, byStatus };
  }
}
