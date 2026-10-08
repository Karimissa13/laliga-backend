import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import {
  Communication, CommunicationChannel, CommunicationStatus, Guardian, Invoice, Player,
} from '../../database/entities';
import { DomainEvents } from '../../common/domain-events';
import { AuditService } from '../../audit/audit.service';
import { InvoicePdfService } from '../finance/invoice-pdf.service';
import { SettingsService } from '../finance/settings.service';
import { MailerService } from './mailer.service';
import { invoiceEmail, welcomeEmail } from './email-templates';

const TEMP_DAYS = 7;
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';

/** Readable temporary password, e.g. "Kq7m-Rt4x-Wp": no 0/O or 1/l to misread. */
export function tempPassword(): string {
  const pick = (n: number) => Array.from({ length: n }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  let p = `${pick(4)}-${pick(4)}-${pick(2)}`;
  if (!/\d/.test(p)) p = p.slice(0, -1) + String(randomInt(2, 10));
  return p;
}

/**
 * Parent-facing email: the welcome (with sign-in details) when a child is
 * registered, and the tax invoice (PDF attached) when an invoice is issued.
 *
 * Every message is written to the email log. A temporary password is never
 * stored readable — the log keeps "••••", and the parent's copy is the only one.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger('Notifications');

  constructor(
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(Communication) private readonly log: Repository<Communication>,
    private readonly events: DomainEvents,
    private readonly mailer: MailerService,
    private readonly pdf: InvoicePdfService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.events.on('player.created', async (e) => {
      const s = await this.settings.notifications();
      if (s.autoWelcome) await this.sendWelcome(e.guardianId, { playerId: e.playerId, actorId: e.actorId });
    });
    this.events.on('invoice.issued', async (e) => {
      const s = await this.settings.notifications();
      if (s.autoEmailInvoices) await this.sendInvoice(e.invoiceId, { actorId: e.actorId });
    });
  }

  status() { return this.mailer.status(); }

  // ----------------------------------------------------------------- welcome

  /**
   * Welcome a family. The first time (no sign-in yet) a temporary password is
   * created and must be changed at first sign-in. `resetLogin` issues a new one
   * (the desk's "Resend sign-in details").
   */
  async sendWelcome(guardianId: string, opts: { playerId?: string; resetLogin?: boolean; actorId?: string } = {}) {
    const g = await this.guardians.createQueryBuilder('g').addSelect('g.passwordHash').where('g.id = :id', { id: guardianId }).getOne();
    if (!g) throw new NotFoundException('Parent not found');
    if (!g.email) throw new BadRequestException('This parent has no email address');
    const kids = await this.players.find({ where: { guardianId }, order: { createdAt: 'DESC' } });
    const child = (opts.playerId ? kids.find((k) => k.id === opts.playerId) : kids[0]) ?? null;
    const s = await this.settings.notifications();
    const profile = await this.settings.invoiceProfile();

    const needsLogin = !g.passwordHash || g.mustChangePassword || opts.resetLogin;
    let temp: string | undefined;
    let expires: Date | undefined;
    if (needsLogin) {
      temp = tempPassword();
      expires = new Date(Date.now() + TEMP_DAYS * 86400000);
      await this.guardians.update(g.id, {
        passwordHash: await bcrypt.hash(temp, 10), mustChangePassword: true, tempPasswordExpiresAt: expires,
        credentialsSentAt: new Date(),
      });
    }
    const m = welcomeEmail({
      // Siblings registered together get one email naming all of them.
      parentName: g.fullName, childName: siblingsNamed(kids, child),
      email: g.email, tempPassword: temp, portalUrl: s.portalUrl, company: profile.companyName,
      expiresOn: expires?.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Dubai' }),
    });
    const r = await this.mailer.send({ to: g.email, subject: m.subject, html: m.html, text: m.text, fromName: s.fromName, replyTo: s.replyTo });
    const redact = (x: string) => (temp ? x.split(temp).join('••••••••••••') : x);
    const row = await this.record({
      guardianId: g.id, to: g.email, subject: m.subject, html: redact(m.html), kind: needsLogin ? 'welcome' : 'registered',
      result: r, attachments: null,
    });
    if (opts.resetLogin && opts.actorId) {
      await this.audit.record({ actorId: opts.actorId, actorType: 'user', action: 'guardian.login_reset', entity: 'guardian', entityId: g.id, metadata: { sent: r.ok && !r.simulated } });
    }
    return { id: row.id, to: g.email, kind: row.kind, sent: r.ok && !r.simulated, simulated: r.simulated, error: r.error ?? null, loginCreated: needsLogin };
  }

  // ----------------------------------------------------------------- invoice

  async sendInvoice(invoiceId: string, opts: { actorId?: string; to?: string } = {}) {
    const inv = await this.invoices.findOne({ where: { id: invoiceId }, relations: { guardian: true, lineItems: { player: true } } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === 'DRAFT') throw new BadRequestException('Issue the invoice before emailing it');
    const g = inv.guardian;
    const to = opts.to ?? g?.email;
    if (!to) throw new BadRequestException('This parent has no email address');
    const [s, profile, file] = await Promise.all([this.settings.notifications(), this.settings.invoiceProfile(), this.pdf.render(inv.id)]);
    const paid = Number(inv.amountPaid) - Number(inv.amountRefunded);
    const balance = Math.max(0, Number(inv.total) - paid - Number(inv.writeOffAmount));
    const names = [...new Set(inv.lineItems.map((l) => l.player ? `${l.player.firstName} ${l.player.lastName}` : null).filter(Boolean))].join(', ');
    const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const m = invoiceEmail({
      parentName: g.fullName, number: inv.number, total: fmt(Number(inv.total)), balance: fmt(balance),
      dueDate: inv.dueDate ? new Date(inv.dueDate + 'T00:00:00Z').toLocaleDateString('en-GB', { timeZone: 'UTC' }) : null,
      players: names, portalUrl: s.portalUrl, company: profile.companyName,
      bankLine: `Bank transfer: ${profile.bank.accountName}, ${profile.bank.bankName}, IBAN ${profile.bank.iban}. Please write "${profile.academyName} – [Name of Player]" as the payment details.`,
    });
    const cc = !opts.to && g.secondaryEmail ? [g.secondaryEmail] : undefined;
    const r = await this.mailer.send({
      to, cc, subject: m.subject, html: m.html, text: m.text, fromName: s.fromName, replyTo: s.replyTo,
      attachments: [{ filename: file.fileName, content: file.buffer, contentType: 'application/pdf' }],
    });
    const row = await this.record({
      guardianId: g.id, to: cc ? `${to}, ${cc.join(', ')}` : to, subject: m.subject, html: m.html, kind: 'invoice', result: r,
      attachments: [{ type: 'invoice', id: inv.id, fileName: file.fileName }],
    });
    return { id: row.id, to: row.toAddress, sent: r.ok && !r.simulated, simulated: r.simulated, error: r.error ?? null };
  }

  /**
   * Email a parent a document (e.g. a term report) with the PDF attached, copied
   * to the family's additional email, and record it in the email log.
   */
  async sendDocument(input: { guardianId: string; subject: string; html: string; text: string; kind: string;
    file: { fileName: string; buffer: Buffer }; attachment: { type: string; id: string } }) {
    const g = await this.guardians.findOne({ where: { id: input.guardianId } });
    if (!g?.email) throw new BadRequestException('This parent has no email address');
    const s = await this.settings.notifications();
    const cc = g.secondaryEmail ? [g.secondaryEmail] : undefined;
    const r = await this.mailer.send({
      to: g.email, cc, subject: input.subject, html: input.html, text: input.text, fromName: s.fromName, replyTo: s.replyTo,
      attachments: [{ filename: input.file.fileName, content: input.file.buffer, contentType: 'application/pdf' }],
    });
    const row = await this.record({
      guardianId: g.id, to: cc ? `${g.email}, ${cc.join(', ')}` : g.email, subject: input.subject, html: input.html, kind: input.kind, result: r,
      attachments: [{ ...input.attachment, fileName: input.file.fileName }],
    });
    return { id: row.id, to: row.toAddress, sent: r.ok && !r.simulated, simulated: r.simulated, error: r.error ?? null };
  }

  /** Email a parent a message without an attachment (e.g. a payment link), copied to the additional email, and log it. */
  async sendMessage(input: { guardianId: string; subject: string; html: string; text: string; kind: string; ref?: { type: string; id: string } }) {
    const g = await this.guardians.findOne({ where: { id: input.guardianId } });
    if (!g?.email) throw new BadRequestException('This parent has no email address');
    const s = await this.settings.notifications();
    const cc = g.secondaryEmail ? [g.secondaryEmail] : undefined;
    const r = await this.mailer.send({ to: g.email, cc, subject: input.subject, html: input.html, text: input.text, fromName: s.fromName, replyTo: s.replyTo });
    const row = await this.record({
      guardianId: g.id, to: cc ? `${g.email}, ${cc.join(', ')}` : g.email, subject: input.subject, html: input.html, kind: input.kind, result: r,
      attachments: input.ref ? [{ ...input.ref, fileName: '' }] : null,
    });
    return { id: row.id, to: row.toAddress, sent: r.ok && !r.simulated, simulated: r.simulated, error: r.error ?? null };
  }

  // --------------------------------------------------------------------- log

  private async record(x: {
    guardianId: string; to: string; subject: string; html: string; kind: string;
    result: { ok: boolean; simulated: boolean; error?: string };
    attachments: Array<{ type: string; id: string; fileName: string }> | null;
  }) {
    return this.log.save(this.log.create({
      channel: CommunicationChannel.EMAIL,
      status: x.result.ok ? (x.result.simulated ? CommunicationStatus.QUEUED : CommunicationStatus.SENT) : CommunicationStatus.FAILED,
      guardianId: x.guardianId, toAddress: x.to, subject: x.subject, body: x.html,
      sentAt: x.result.ok && !x.result.simulated ? new Date() : undefined,
      error: x.result.error ?? (x.result.simulated ? 'Not sent — email is not connected yet' : undefined),
      kind: x.kind, attachments: x.attachments, simulated: x.result.simulated,
    }));
  }

  async emailLog(q: { kind?: string; guardianId?: string; limit?: number }) {
    const qb = this.log.createQueryBuilder('c').leftJoinAndSelect('c.guardian', 'g')
      .where('c.channel = :ch', { ch: CommunicationChannel.EMAIL })
      .orderBy('c.createdAt', 'DESC').take(Math.min(q.limit ?? 100, 500));
    if (q.kind) qb.andWhere('c.kind = :k', { k: q.kind });
    if (q.guardianId) qb.andWhere('c.guardianId = :g', { g: q.guardianId });
    const rows = await qb.getMany();
    return rows.map((c) => ({
      id: c.id, at: c.createdAt, kind: c.kind, to: c.toAddress, subject: c.subject, status: c.status,
      simulated: c.simulated, error: c.error ?? null, sentAt: c.sentAt ?? null, attachments: c.attachments ?? [],
      parent: c.guardian ? { id: c.guardian.id, ref: c.guardian.reference, name: c.guardian.fullName } : null,
    }));
  }

  async emailBody(id: string) {
    const c = await this.log.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Email not found');
    return c.body;
  }
}

/** "Omar Ahmed" — or "Omar and Yousef Ahmed" when brothers and sisters were registered together just now. */
function siblingsNamed(kids: Array<{ id: string; firstName: string; lastName: string; createdAt: Date }>, child: { id: string; firstName: string; lastName: string; createdAt: Date } | null) {
  if (!child) return 'Your child';
  const together = kids.filter((k) => Math.abs(new Date(k.createdAt).getTime() - new Date(child.createdAt).getTime()) < 30 * 60000)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  if (together.length <= 1) return `${child.firstName} ${child.lastName}`;
  const sameLast = together.every((k) => k.lastName === together[0].lastName);
  const names = together.map((k) => (sameLast ? k.firstName : `${k.firstName} ${k.lastName}`));
  const list = names.length === 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return sameLast ? `${list} ${together[0].lastName}` : list;
}

