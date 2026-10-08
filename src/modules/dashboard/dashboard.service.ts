import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Enrolment, Invoice, InvoiceStatus, Lead, LeadStatus, Player, PlayerStatus,
} from '../../database/entities';
import { AuditService } from '../../audit/audit.service';
import { InvoicesService } from '../finance/invoices.service';
import { SessionsService } from '../scheduling/sessions.service';
import { AttendanceService } from '../scheduling/attendance.service';
import { DevelopmentService } from '../development/development.service';
import { AnalyticsService } from '../analytics/analytics.service';

/**
 * The admin's landing screen: KPIs, the work queue, and what's happening today.
 * Designed to be actionable — every alert maps to a screen the admin can act on.
 */
@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    private readonly audit: AuditService,
    private readonly invoicesService: InvoicesService,
    private readonly sessions: SessionsService,
    private readonly attendance: AttendanceService,
    private readonly development: DevelopmentService,
    private readonly analytics: AnalyticsService,
  ) {}

  private daysAgo(n: number): Date {
    const d = new Date(); d.setDate(d.getDate() - n); return d;
  }

  async kpis() {
    const [totalPlayers, activePlayers, waitlisted] = await Promise.all([
      this.players.count(),
      this.players.count({ where: { status: PlayerStatus.ACTIVE } }),
      this.players.count({ where: { status: PlayerStatus.WAITLISTED } }),
    ]);

    const outstanding = await this.invoicesService.outstanding();

    const recentRegistrations = await this.players.createQueryBuilder('p')
      .where('p.createdAt >= :d', { d: this.daysAgo(30) }).getCount();

    const trialTotal = await this.leads.createQueryBuilder('l')
      .where('l.createdAt >= :d', { d: this.daysAgo(90) }).getCount();
    const trialConverted = await this.leads.createQueryBuilder('l')
      .where('l.createdAt >= :d', { d: this.daysAgo(90) })
      .andWhere('l.status = :s', { s: LeadStatus.REGISTERED }).getCount();

    const revenue = await this.analytics.revenue();

    return {
      activePlayers,
      totalPlayers,
      waitlisted,
      outstandingBalance: outstanding.totalOutstanding,
      outstandingInvoices: outstanding.count,
      overdueInvoices: outstanding.overdueCount,
      overdueAmount: outstanding.totalOverdue,
      revenueBilled: revenue.billed,
      revenueCollected: revenue.collected,
      collectionRate: revenue.collectionRate,
      newRegistrations30d: recentRegistrations,
      trialConversionRate: trialTotal ? Math.round((trialConverted / trialTotal) * 100) : 0,
    };
  }

  /** The work queue — each item is something an admin acts on today. */
  async pendingActions() {
    const [outstanding, unsubmitted, attendanceIssues, expiringDocs] = await Promise.all([
      this.invoicesService.outstanding(),
      this.attendance.unsubmitted(7),
      this.attendance.issues({ threshold: 70, minSessions: 3 }),
      this.development.expiringDocuments(30),
    ]);

    const now = new Date();
    const weekAhead = new Date(); weekAhead.setDate(weekAhead.getDate() + 7);
    const leads = await this.leads.find({
      where: { status: In([LeadStatus.NEW, LeadStatus.CONTACTED, LeadStatus.TRIAL_BOOKED]) },
    });
    const trialsThisWeek = leads.filter((l) => l.trialDate && new Date(l.trialDate) >= now && new Date(l.trialDate) <= weekAhead);
    const unactionedLeads = leads.filter((l) => l.status === LeadStatus.NEW).length;

    const pendingRegistrations = await this.players.count({ where: { status: PlayerStatus.TRIAL } });
    const waitlisted = await this.players.count({ where: { status: PlayerStatus.WAITLISTED } });

    return {
      overdueInvoices: { count: outstanding.overdueCount, amount: outstanding.totalOverdue, action: '/invoices?overdueOnly=true' },
      newLeads: { count: unactionedLeads, action: '/leads?status=NEW' },
      trialsThisWeek: { count: trialsThisWeek.length, items: trialsThisWeek.slice(0, 5).map((l) => ({ reference: l.reference, player: l.playerName, date: l.trialDate })), action: '/leads' },
      pendingRegistrations: { count: pendingRegistrations, action: '/players?status=TRIAL' },
      waitlisted: { count: waitlisted, action: '/players?status=WAITLISTED' },
      registersNotSubmitted: { count: unsubmitted.length, items: unsubmitted.slice(0, 5), action: '/sessions' },
      attendanceIssues: { count: attendanceIssues.length, items: attendanceIssues.slice(0, 5), action: '/attendance/issues' },
      expiringDocuments: { count: expiringDocs.length, items: expiringDocs.slice(0, 5), action: '/documents/expiring' },
    };
  }

  async upcomingSessions(days = 2) { return this.sessions.upcoming(days); }

  async recentActivity(take = 12) { return this.audit.find({ take }); }

  async summary() {
    const [kpis, pendingActions, upcoming, recentActivity, capacity] = await Promise.all([
      this.kpis(), this.pendingActions(), this.upcomingSessions(2), this.recentActivity(12),
      this.analytics.capacity(),
    ]);
    return {
      kpis,
      pendingActions,
      upcomingSessions: upcoming,
      capacity: { overallUtilisation: capacity.overallUtilisation, fullTeams: capacity.fullTeams, teams: capacity.teams },
      recentActivity,
    };
  }
}
