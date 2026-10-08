import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Attendance, AttendanceStatus, Coach, Enrolment, Invoice, InvoiceStatus, Lead,
  LeadStatus, Player, PlayerStatus, Session, Team,
} from '../../database/entities';

const money = (n: number) => Math.round(n * 100) / 100;

export interface AnalyticsFilter {
  from?: string; to?: string; seasonId?: string; locationId?: string;
  teamId?: string; ageGroupId?: string; coachId?: string;
}

/**
 * Replaces the legacy export-only "Reports" screen with real, filterable
 * analytics. Everything here is computed from live data, never hand-maintained.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(Attendance) private readonly attendances: Repository<Attendance>,
    @InjectRepository(Coach) private readonly coaches: Repository<Coach>,
  ) {}

  /** Enrolment / player-base numbers, sliceable by team, age group, status. */
  async enrolment(f: AnalyticsFilter = {}) {
    const qb = this.players.createQueryBuilder('p')
      .leftJoin('p.ageGroup', 'ag')
      .leftJoin('p.currentTeam', 't');
    if (f.teamId) qb.andWhere('p.currentTeamId = :t', { t: f.teamId });
    if (f.ageGroupId) qb.andWhere('p.ageGroupId = :ag', { ag: f.ageGroupId });
    const players = await qb.getMany();

    const byStatus: Record<string, number> = {};
    players.forEach((p) => (byStatus[p.status] = (byStatus[p.status] || 0) + 1));

    const byAgeRows = await this.players.createQueryBuilder('p')
      .leftJoin('p.ageGroup', 'ag')
      .select('COALESCE(ag.code, :none)', 'code').addSelect('COUNT(*)', 'count')
      .setParameter('none', 'Unassigned')
      .groupBy('ag.code').orderBy('ag.code', 'ASC')
      .getRawMany();

    const byTeamRows = await this.players.createQueryBuilder('p')
      .leftJoin('p.currentTeam', 't')
      .select('COALESCE(t.name, :none)', 'team').addSelect('COUNT(*)', 'count')
      .setParameter('none', 'Unassigned')
      .groupBy('t.name')
      .getRawMany();

    // New registrations by month (last 12)
    const trend = await this.players.createQueryBuilder('p')
      .select("to_char(date_trunc('month', p.createdAt), 'YYYY-MM')", 'month')
      .addSelect('COUNT(*)', 'count')
      .where("p.createdAt >= now() - interval '12 months'")
      .groupBy("date_trunc('month', p.createdAt)")
      .orderBy("date_trunc('month', p.createdAt)", 'ASC')
      .getRawMany();

    return {
      totalPlayers: players.length,
      active: byStatus[PlayerStatus.ACTIVE] || 0,
      trial: byStatus[PlayerStatus.TRIAL] || 0,
      waitlisted: byStatus[PlayerStatus.WAITLISTED] || 0,
      withdrawn: byStatus[PlayerStatus.WITHDRAWN] || 0,
      byStatus,
      byAgeGroup: byAgeRows.map((r) => ({ code: r.code, count: Number(r.count) })),
      byTeam: byTeamRows.map((r) => ({ team: r.team, count: Number(r.count) })),
      newRegistrationsByMonth: trend.map((r) => ({ month: r.month, count: Number(r.count) })),
    };
  }

  /** Revenue billed vs collected, plus outstanding — by month. */
  async revenue(f: AnalyticsFilter = {}) {
    const all = await this.invoices.find();
    const relevant = all.filter((i) => i.status !== InvoiceStatus.CANCELLED && i.status !== InvoiceStatus.DRAFT);

    const billed = money(relevant.reduce((s, i) => s + Number(i.total), 0));
    const collected = money(relevant.reduce((s, i) => s + Number(i.amountPaid) - Number(i.amountRefunded), 0));
    const writtenOff = money(relevant.reduce((s, i) => s + Number(i.writeOffAmount), 0));
    const outstanding = money(billed - collected - writtenOff);
    const vat = money(relevant.reduce((s, i) => s + Number(i.vatTotal), 0));
    const discounts = money(relevant.reduce((s, i) => s + Number(i.discountTotal), 0));

    const monthly = await this.invoices.createQueryBuilder('i')
      .select("to_char(date_trunc('month', i.createdAt), 'YYYY-MM')", 'month')
      .addSelect('SUM(i.total)', 'billed')
      .addSelect('SUM(i.amountPaid)', 'collected')
      .where("i.createdAt >= now() - interval '12 months'")
      .andWhere('i.status != :d', { d: InvoiceStatus.DRAFT })
      .groupBy("date_trunc('month', i.createdAt)")
      .orderBy("date_trunc('month', i.createdAt)", 'ASC')
      .getRawMany();

    const byStatus: Record<string, number> = {};
    relevant.forEach((i) => (byStatus[i.status] = (byStatus[i.status] || 0) + 1));

    return {
      billed, collected, outstanding, writtenOff, vat, discounts,
      collectionRate: billed ? Math.round((collected / billed) * 100) : 0,
      invoiceCount: relevant.length,
      byStatus,
      monthly: monthly.map((m) => ({ month: m.month, billed: money(Number(m.billed)), collected: money(Number(m.collected)) })),
    };
  }

  /** Team capacity utilisation — where there's room, where there's a waitlist. */
  async capacity() {
    const teams = await this.teams.find({
      where: { isActive: true },
      relations: { ageGroup: true, location: true, headCoach: { user: true } },
      order: { name: 'ASC' },
    });
    const rows: any[] = [];
    let totalCap = 0, totalFilled = 0;
    for (const t of teams) {
      const filled = await this.players.count({ where: { currentTeamId: t.id } });
      totalCap += t.capacity; totalFilled += filled;
      rows.push({
        teamId: t.id, team: t.name, ageGroup: t.ageGroup?.code, location: t.location?.name,
        coach: t.headCoach?.user?.fullName ?? null,
        capacity: t.capacity, filled, available: Math.max(0, t.capacity - filled),
        utilisation: t.capacity ? Math.round((filled / t.capacity) * 100) : 0,
        isFull: filled >= t.capacity,
      });
    }
    return {
      teams: rows.length,
      totalCapacity: totalCap, totalFilled,
      overallUtilisation: totalCap ? Math.round((totalFilled / totalCap) * 100) : 0,
      fullTeams: rows.filter((r) => r.isFull).length,
      rows,
    };
  }

  /** Sessions and players per coach — workload balance. */
  async coachWorkload(f: AnalyticsFilter = {}) {
    const coaches = await this.coaches.find({ relations: { user: true } });
    const out: any[] = [];
    for (const c of coaches) {
      const qb = this.sessions.createQueryBuilder('s').where('s.coachId = :c', { c: c.id });
      if (f.from) qb.andWhere('s.startsAt >= :from', { from: new Date(f.from) });
      if (f.to) qb.andWhere('s.startsAt <= :to', { to: new Date(f.to) });
      const sessionCount = await qb.getCount();
      const teams = await this.teams.find({ where: { headCoachId: c.id, isActive: true } });
      let playerCount = 0;
      for (const t of teams) playerCount += await this.players.count({ where: { currentTeamId: t.id } });
      out.push({
        coachId: c.id, name: c.user?.fullName ?? '—', certification: c.certification,
        sessions: sessionCount, teams: teams.length, players: playerCount,
      });
    }
    return out.sort((a, b) => b.sessions - a.sessions);
  }

  /** Venue utilisation — how heavily each location is booked. */
  async venueUtilisation(f: AnalyticsFilter = {}) {
    const qb = this.sessions.createQueryBuilder('s')
      .leftJoin('s.location', 'l')
      .select('COALESCE(l.name, :none)', 'location')
      .addSelect('COUNT(*)', 'sessions')
      .addSelect('SUM(EXTRACT(EPOCH FROM (s.endsAt - s.startsAt))/3600)', 'hours')
      .setParameter('none', 'Unassigned')
      .groupBy('l.name');
    if (f.from) qb.andWhere('s.startsAt >= :from', { from: new Date(f.from) });
    if (f.to) qb.andWhere('s.startsAt <= :to', { to: new Date(f.to) });
    const rows = await qb.getRawMany();
    return rows.map((r) => ({ location: r.location, sessions: Number(r.sessions), hours: money(Number(r.hours || 0)) }));
  }

  /** Attendance rate overall and per team. */
  async attendance(f: AnalyticsFilter = {}) {
    const qb = this.attendances.createQueryBuilder('a').innerJoin('a.session', 's');
    if (f.from) qb.andWhere('s.startsAt >= :from', { from: new Date(f.from) });
    if (f.to) qb.andWhere('s.startsAt <= :to', { to: new Date(f.to) });
    if (f.teamId) qb.andWhere('s.teamId = :t', { t: f.teamId });
    const rows = await qb.getMany();
    const total = rows.length;
    const present = rows.filter((r) => r.status === AttendanceStatus.PRESENT || r.status === AttendanceStatus.LATE).length;
    const byStatus: Record<string, number> = {};
    rows.forEach((r) => (byStatus[r.status] = (byStatus[r.status] || 0) + 1));

    const byTeam = await this.attendances.createQueryBuilder('a')
      .innerJoin('a.session', 's').leftJoin('s.team', 't')
      .select('COALESCE(t.name, :none)', 'team')
      .addSelect('COUNT(*)', 'marks')
      .addSelect("SUM(CASE WHEN a.status IN ('PRESENT','LATE') THEN 1 ELSE 0 END)", 'present')
      .setParameter('none', 'Unassigned')
      .groupBy('t.name')
      .getRawMany();

    return {
      totalMarks: total, present,
      attendanceRate: total ? Math.round((present / total) * 100) : null,
      byStatus,
      byTeam: byTeam.map((r) => ({
        team: r.team, marks: Number(r.marks), present: Number(r.present),
        rate: Number(r.marks) ? Math.round((Number(r.present) / Number(r.marks)) * 100) : null,
      })),
    };
  }

  /** Trial funnel + conversion. */
  async conversion() {
    const rows = await this.leads.createQueryBuilder('l')
      .select('l.status', 'status').addSelect('COUNT(*)', 'count')
      .groupBy('l.status').getRawMany();
    const byStatus: Record<string, number> = {};
    rows.forEach((r) => (byStatus[r.status] = Number(r.count)));
    const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
    const registered = byStatus[LeadStatus.REGISTERED] || 0;

    const bySource = await this.leads.createQueryBuilder('l')
      .select('l.source', 'source').addSelect('COUNT(*)', 'count')
      .addSelect("SUM(CASE WHEN l.status = 'REGISTERED' THEN 1 ELSE 0 END)", 'converted')
      .groupBy('l.source').getRawMany();

    return {
      totalLeads: total, registered,
      conversionRate: total ? Math.round((registered / total) * 100) : 0,
      byStatus,
      bySource: bySource.map((r) => ({
        source: r.source, leads: Number(r.count), converted: Number(r.converted),
        rate: Number(r.count) ? Math.round((Number(r.converted) / Number(r.count)) * 100) : 0,
      })),
    };
  }

  /** One call for the analytics dashboard. */
  async overview(f: AnalyticsFilter = {}) {
    const [enrolment, revenue, capacity, attendance, conversion] = await Promise.all([
      this.enrolment(f), this.revenue(f), this.capacity(), this.attendance(f), this.conversion(),
    ]);
    return { enrolment, revenue, capacity, attendance, conversion };
  }
}
