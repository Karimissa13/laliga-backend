import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Communication, CommunicationChannel, Enrolment, Guardian, Invoice, InvoiceStatus,
  Lead, LeadStatus, Player, PlayerStatus, Session, Term,
} from '../../database/entities';
import { CommunicationsService } from './communications.service';
import { AuditService } from '../../audit/audit.service';

export interface AutomationResult {
  automation: string;
  candidates: number;
  sent: number;
  dryRun: boolean;
  details: any[];
}

/**
 * Administrative automations — the manual chasing the audit flagged.
 * Each runs idempotently and supports dryRun so an admin can preview before sending.
 * Trigger them on a schedule (cron/queue) or on demand from the dashboard.
 */
@Injectable()
export class AutomationsService {
  private readonly logger = new Logger('Automations');

  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Lead) private readonly leads: Repository<Lead>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    private readonly comms: CommunicationsService,
    private readonly audit: AuditService,
  ) {}

  private balance(i: Invoice) {
    return Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount);
  }

  /** Remind guardians about overdue invoices. */
  async paymentReminders(opts: { dryRun?: boolean; channel?: CommunicationChannel } = {}): Promise<AutomationResult> {
    const dryRun = opts.dryRun ?? true;
    const channel = opts.channel ?? CommunicationChannel.EMAIL;
    const open = await this.invoices.find({
      where: { status: In([InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID]) },
      relations: { guardian: true },
    });
    const now = new Date();
    const overdue = open.filter((i) => this.balance(i) > 0.009 && i.dueDate && new Date(i.dueDate) < now);

    const details: any[] = [];
    let sent = 0;
    for (const inv of overdue) {
      if (!inv.guardian) continue;
      const days = Math.floor((now.getTime() - new Date(inv.dueDate!).getTime()) / 86400000);
      const entry = {
        invoice: inv.number, guardian: inv.guardian.fullName,
        balance: Math.round(this.balance(inv) * 100) / 100, daysOverdue: days,
      };
      if (!dryRun) {
        await this.comms.sendToGuardian({
          guardian: inv.guardian, channel,
          subject: `Payment reminder — invoice {{invoice}}`,
          body: `Dear {{guardian.fullName}},\n\nOur records show invoice {{invoice}} has an outstanding balance of AED {{balance}}, now {{days}} day(s) past due.\n\nYou can settle it online or contact the academy office.\n\nLaLiga Academy Abu Dhabi`,
          vars: { invoice: inv.number, balance: entry.balance, days },
        });
        sent++;
      }
      details.push(entry);
    }
    await this.audit.record({ action: 'automation.payment-reminders', actorType: 'system', metadata: { candidates: overdue.length, sent, dryRun } });
    return { automation: 'payment-reminders', candidates: overdue.length, sent, dryRun, details };
  }

  /** Confirm upcoming trials to the enquiring parent. */
  async trialConfirmations(opts: { dryRun?: boolean; withinDays?: number; channel?: CommunicationChannel } = {}): Promise<AutomationResult> {
    const dryRun = opts.dryRun ?? true;
    const within = opts.withinDays ?? 3;
    const channel = opts.channel ?? CommunicationChannel.EMAIL;
    const from = new Date();
    const to = new Date(); to.setDate(to.getDate() + within);

    const all = await this.leads.find({
      where: { status: In([LeadStatus.TRIAL_BOOKED, LeadStatus.CONTACTED]) },
    });
    const upcoming = all.filter((l) => l.trialDate && new Date(l.trialDate) >= from && new Date(l.trialDate) <= to);

    const details: any[] = [];
    let sent = 0;
    for (const lead of upcoming) {
      const entry = { lead: lead.reference, player: lead.playerName, trialDate: lead.trialDate, to: lead.guardianEmail };
      if (!dryRun) {
        // leads may not have a guardian record yet — send to the lead's own contact
        const pseudo = { id: undefined, fullName: lead.guardianName, email: lead.guardianEmail, mobile: lead.guardianMobile } as any;
        await this.comms.sendToGuardian({
          guardian: pseudo, channel,
          subject: 'Your LaLiga Academy trial is confirmed',
          body: `Dear {{guardian.fullName}},\n\nThis confirms {{player}}'s trial session on {{date}}{{venue}}.\n\nPlease arrive 15 minutes early with football boots, shin pads and water.\n\nLaLiga Academy Abu Dhabi`,
          vars: { player: lead.playerName, date: new Date(lead.trialDate!).toDateString(), venue: lead.venueLabel ? ` at ${lead.venueLabel}` : '' },
        });
        sent++;
      }
      details.push(entry);
    }
    await this.audit.record({ action: 'automation.trial-confirmations', actorType: 'system', metadata: { candidates: upcoming.length, sent, dryRun } });
    return { automation: 'trial-confirmations', candidates: upcoming.length, sent, dryRun, details };
  }

  /** Nudge active players to renew when the current term is ending. */
  async renewalReminders(opts: { dryRun?: boolean; daysBeforeTermEnd?: number; channel?: CommunicationChannel } = {}): Promise<AutomationResult> {
    const dryRun = opts.dryRun ?? true;
    const window = opts.daysBeforeTermEnd ?? 30;
    const channel = opts.channel ?? CommunicationChannel.EMAIL;

    const now = new Date();
    const horizon = new Date(); horizon.setDate(horizon.getDate() + window);
    const endingTerms = (await this.terms.find({ where: { isActive: true } }))
      .filter((t) => t.endDate && new Date(t.endDate) >= now && new Date(t.endDate) <= horizon);

    const details: any[] = [];
    let sent = 0;
    if (endingTerms.length) {
      const enrolments = await this.enrolments.find({
        where: { termId: In(endingTerms.map((t) => t.id)) },
        relations: { player: { guardian: true }, term: true },
      });
      const seen = new Set<string>();
      for (const e of enrolments) {
        const g = e.player?.guardian;
        if (!g || seen.has(g.id)) continue;
        seen.add(g.id);
        const entry = { guardian: g.fullName, player: `${e.player.firstName} ${e.player.lastName}`, term: e.term?.name, endsOn: e.term?.endDate };
        if (!dryRun) {
          await this.comms.sendToGuardian({
            guardian: g, channel,
            subject: 'Secure {{player}}’s place for next term',
            body: `Dear {{guardian.fullName}},\n\n{{term}} finishes on {{endsOn}}. Re-enrol {{player}} now to keep their place — returning players receive their loyalty discount automatically.\n\nLaLiga Academy Abu Dhabi`,
            vars: entry,
          });
          sent++;
        }
        details.push(entry);
      }
    }
    await this.audit.record({ action: 'automation.renewal-reminders', actorType: 'system', metadata: { candidates: details.length, sent, dryRun } });
    return { automation: 'renewal-reminders', candidates: details.length, sent, dryRun, details };
  }

  /** Welcome/confirmation when a player is newly registered. */
  async registrationConfirmations(opts: { dryRun?: boolean; sinceHours?: number; channel?: CommunicationChannel } = {}): Promise<AutomationResult> {
    const dryRun = opts.dryRun ?? true;
    const since = new Date(Date.now() - (opts.sinceHours ?? 24) * 3600_000);
    const channel = opts.channel ?? CommunicationChannel.EMAIL;

    const recent = await this.players.createQueryBuilder('p')
      .leftJoinAndSelect('p.guardian', 'g')
      .leftJoinAndSelect('p.ageGroup', 'ag')
      .where('p.createdAt >= :since', { since })
      .andWhere('p.status IN (:...st)', { st: [PlayerStatus.ACTIVE, PlayerStatus.REGISTERED] })
      .getMany();

    const details: any[] = [];
    let sent = 0;
    for (const p of recent) {
      if (!p.guardian) continue;
      const entry = { player: `${p.firstName} ${p.lastName}`, reference: p.reference, ageGroup: p.ageGroup?.code, guardian: p.guardian.fullName };
      if (!dryRun) {
        await this.comms.sendToGuardian({
          guardian: p.guardian, channel,
          subject: 'Welcome to LaLiga Academy Abu Dhabi',
          body: `Dear {{guardian.fullName}},\n\n{{player}} is registered (reference {{reference}}) in age group {{ageGroup}}.\n\nYou can view schedules, attendance and invoices from your parent account.\n\nLaLiga Academy Abu Dhabi`,
          vars: entry,
        });
        sent++;
      }
      details.push(entry);
    }
    await this.audit.record({ action: 'automation.registration-confirmations', actorType: 'system', metadata: { candidates: recent.length, sent, dryRun } });
    return { automation: 'registration-confirmations', candidates: recent.length, sent, dryRun, details };
  }

  /** Run every automation (used by the scheduler / "run now" button). */
  async runAll(dryRun = true) {
    return {
      dryRun,
      results: [
        await this.paymentReminders({ dryRun }),
        await this.trialConfirmations({ dryRun }),
        await this.renewalReminders({ dryRun }),
        await this.registrationConfirmations({ dryRun }),
      ],
    };
  }
}
