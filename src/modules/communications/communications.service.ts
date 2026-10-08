import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Communication, CommunicationChannel, CommunicationStatus, CommunicationTemplate,
  Guardian, Invoice, InvoiceStatus, Player, PlayerStatus,
} from '../../database/entities';
import { CHANNEL_REGISTRY, renderTemplate } from './channels';

export interface Audience {
  guardianIds?: string[];
  teamId?: string;
  ageGroupId?: string;
  playerStatus?: PlayerStatus;
  hasOutstanding?: boolean;
  all?: boolean;
}

@Injectable()
export class CommunicationsService {
  private readonly logger = new Logger('Communications');

  constructor(
    @InjectRepository(Communication) private readonly comms: Repository<Communication>,
    @InjectRepository(CommunicationTemplate) private readonly templates: Repository<CommunicationTemplate>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
  ) {}

  // ---------------------------------------------------------- templates
  listTemplates() { return this.templates.find({ order: { name: 'ASC' } }); }
  createTemplate(input: Partial<CommunicationTemplate>) {
    return this.templates.save(this.templates.create(input));
  }
  async updateTemplate(id: string, input: Partial<CommunicationTemplate>) {
    await this.templates.update(id, input);
    return this.templates.findOne({ where: { id } });
  }

  // ----------------------------------------------------------- audience
  /** Resolve an audience definition to concrete guardians. */
  async resolveAudience(a: Audience): Promise<Guardian[]> {
    if (a.guardianIds?.length) {
      return this.guardians.find({ where: { id: In(a.guardianIds) } });
    }
    if (a.hasOutstanding) {
      const open = await this.invoices.find({
        where: { status: In([InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID]) },
        relations: { guardian: true },
      });
      const map = new Map<string, Guardian>();
      open.forEach((i) => {
        const bal = Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount);
        if (bal > 0.009 && i.guardian) map.set(i.guardian.id, i.guardian);
      });
      return [...map.values()];
    }
    if (a.teamId || a.ageGroupId || a.playerStatus) {
      const qb = this.players.createQueryBuilder('p').leftJoinAndSelect('p.guardian', 'g');
      if (a.teamId) qb.andWhere('p.currentTeamId = :t', { t: a.teamId });
      if (a.ageGroupId) qb.andWhere('p.ageGroupId = :ag', { ag: a.ageGroupId });
      if (a.playerStatus) qb.andWhere('p.status = :st', { st: a.playerStatus });
      const players = await qb.getMany();
      const map = new Map<string, Guardian>();
      players.forEach((p) => p.guardian && map.set(p.guardian.id, p.guardian));
      return [...map.values()];
    }
    if (a.all) return this.guardians.find({ where: { isActive: true } });
    return [];
  }

  // --------------------------------------------------------------- send
  private addressFor(g: Guardian, channel: CommunicationChannel): string {
    return channel === CommunicationChannel.EMAIL ? g.email : g.mobile;
  }

  /** Queue + deliver a message to one guardian, recording it in history. */
  async sendToGuardian(params: {
    guardian: Guardian; channel: CommunicationChannel; subject?: string; body: string;
    templateId?: string; vars?: Record<string, any>;
  }) {
    const vars = { guardian: params.guardian, ...(params.vars || {}) };
    const body = renderTemplate(params.body, vars);
    const subject = params.subject ? renderTemplate(params.subject, vars) : undefined;
    const to = this.addressFor(params.guardian, params.channel);

    const record = await this.comms.save(this.comms.create({
      channel: params.channel,
      status: CommunicationStatus.QUEUED,
      templateId: params.templateId,
      guardianId: params.guardian.id,
      toAddress: to,
      subject,
      body,
    }));

    const driver = CHANNEL_REGISTRY[params.channel];
    const res = await driver.send(to, subject, body);
    await this.comms.update(record.id, {
      status: res.ok ? CommunicationStatus.SENT : CommunicationStatus.FAILED,
      sentAt: res.ok ? new Date() : undefined,
      error: res.error,
    });
    return { id: record.id, to, ok: res.ok, simulated: res.simulated };
  }

  /** Targeted broadcast — by team, age group, payment status, or everyone. */
  async broadcast(params: {
    audience: Audience; channel: CommunicationChannel; subject?: string; body?: string;
    templateName?: string;
  }) {
    let subject = params.subject;
    let body = params.body;
    let templateId: string | undefined;

    if (params.templateName) {
      const tpl = await this.templates.findOne({ where: { name: params.templateName } });
      if (!tpl) throw new BadRequestException(`Template "${params.templateName}" not found`);
      subject = subject ?? tpl.subject;
      body = body ?? tpl.body;
      templateId = tpl.id;
    }
    if (!body) throw new BadRequestException('Provide body or templateName');

    const recipients = await this.resolveAudience(params.audience);
    const results: any[] = [];
    for (const g of recipients) {
      results.push(await this.sendToGuardian({
        guardian: g, channel: params.channel, subject, body, templateId,
      }));
    }
    return {
      recipients: recipients.length,
      sent: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      simulated: results.some((r) => r.simulated),
      results,
    };
  }

  /** Communication history (whole academy, or one guardian). */
  history(guardianId?: string, take = 100) {
    return this.comms.find({
      where: guardianId ? { guardianId } : {},
      relations: { guardian: true },
      order: { createdAt: 'DESC' },
      take,
    });
  }
}
