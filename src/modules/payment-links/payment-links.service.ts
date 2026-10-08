import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { Invoice, InvoiceStatus, PaymentLink } from '../../database/entities';
import { InstalmentsService } from '../finance/instalments.service';
import { PaymentGatewayService } from '../finance/payment-gateway.service';
import { SettingsService } from '../finance/settings.service';
import { NotificationsService } from '../notifications/notifications.service';
import { paymentLinkEmail } from '../notifications/email-templates';

const LINK_DAYS = 30;
const r2 = (n: number) => Math.round(n * 100) / 100;
const fmt = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso?: string | null) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : null);

/**
 * Payment links (Karim, Oct 2026: made by the system, gateway later).
 *
 * A link is a random token for one invoice — or one instalment of it — and the
 * amount that was due when it was made. The parent opens `/pay/#<token>`: the
 * token is in the fragment, so it never reaches server logs or other sites.
 * Until a gateway is connected the page shows how to pay by bank transfer;
 * once it is, the same link opens the card checkout. Any new link for the same
 * invoice and instalment replaces the previous one.
 */
@Injectable()
export class PaymentLinksService {
  constructor(
    @InjectRepository(PaymentLink) private readonly links: Repository<PaymentLink>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    private readonly instalments: InstalmentsService,
    private readonly gateway: PaymentGatewayService,
    private readonly settings: SettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  private async base() {
    const s = await this.settings.notifications();
    try { return new URL(s.portalUrl).origin; } catch { return 'http://localhost:3000'; }
  }
  private async urlFor(token: string) { return `${await this.base()}/pay/#${token}`; }

  /** What is owed now: one instalment's remainder, or the invoice balance. */
  private async due(invoiceId: string, seq?: number | null) {
    const s = await this.instalments.summary(invoiceId);
    if (seq) {
      const v = s.instalments.find((x) => x.seq === seq);
      if (!v) throw new BadRequestException(`This invoice has no instalment ${seq}.`);
      if (v.state === 'WAIVED') throw new BadRequestException(`Instalment ${seq} is waived.`);
      return { amount: v.remaining, what: `instalment ${seq} of ${s.instalments.length}`, dueDate: v.dueDate, summary: s };
    }
    return { amount: s.balance, what: 'the balance', dueDate: null as string | null, summary: s };
  }

  private async load(invoiceId: string) {
    const inv = await this.invoices.findOne({ where: { id: invoiceId }, relations: { guardian: true, lineItems: { player: true } } });
    if (!inv) throw new NotFoundException('Invoice not found');
    if (inv.status === InvoiceStatus.DRAFT) throw new BadRequestException('Issue the invoice before sending a payment link.');
    if (![InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID].includes(inv.status)) throw new BadRequestException(`This invoice is ${String(inv.status).toLowerCase().replace('_', ' ')} — nothing to pay.`);
    return inv;
  }

  /**
   * Which instalment a link is for when the desk doesn't say: on a plan, the one
   * marked "ready to pay", else the next one not yet paid. `balance` forces the
   * whole balance.
   */
  private async pick(invoiceId: string, seq?: number | null, balance?: boolean) {
    if (seq || balance) return seq ?? null;
    const s = await this.instalments.summary(invoiceId);
    if (!s.hasPlan) return null;
    const ready = s.instalments.find((v) => v.flag === 'READY' && v.remaining > 0.005);
    return (ready ?? s.instalments.find((v) => v.remaining > 0.005 && v.state !== 'WAIVED'))?.seq ?? null;
  }

  /** Make (or reuse) the link for an invoice or one instalment. */
  async create(invoiceId: string, seqIn: number | null | undefined, actorId?: string, balance?: boolean) {
    const inv = await this.load(invoiceId);
    const seq = await this.pick(invoiceId, seqIn, balance);
    const d = await this.due(invoiceId, seq);
    if (d.amount <= 0.005) throw new BadRequestException(seq ? `Instalment ${seq} is already paid.` : 'This invoice is already paid.');
    const live = await this.links.find({ where: { invoiceId, status: 'ACTIVE' } });
    const same = live.find((l) => (l.instalmentSeq ?? null) === (seq ?? null) && Math.abs(Number(l.amount) - d.amount) < 0.005 && l.expiresAt > new Date());
    let link = same;
    if (!link) {
      const stale = live.filter((l) => (l.instalmentSeq ?? null) === (seq ?? null));
      if (stale.length) await this.links.update({ id: In(stale.map((l) => l.id)) }, { status: 'CANCELLED' });
      link = await this.links.save(this.links.create({
        token: randomBytes(24).toString('base64url'), invoiceId, instalmentSeq: seq ?? null, amount: d.amount.toFixed(2),
        status: 'ACTIVE', expiresAt: new Date(Date.now() + LINK_DAYS * 86400000), createdById: actorId ?? null,
      }));
    }
    return { id: link.id, url: await this.urlFor(link.token), amount: Number(link.amount), instalmentSeq: link.instalmentSeq ?? null,
      expiresAt: link.expiresAt, what: d.what, number: inv.number, online: this.gateway.isLive };
  }

  /** Email the link to the parent (copied to the additional email). Past due, it reads as a reminder. */
  async send(invoiceId: string, seqIn: number | null | undefined, actorId?: string, balance?: boolean) {
    const link = await this.create(invoiceId, seqIn, actorId, balance);
    const seq = link.instalmentSeq;
    const inv = await this.load(invoiceId);
    const d = await this.due(invoiceId, seq);
    const profile = await this.settings.invoiceProfile();
    const today = new Date().toISOString().slice(0, 10);
    const due = d.dueDate ?? inv.dueDate ?? null;
    const players = [...new Set(inv.lineItems.map((l) => (l.player ? `${l.player.firstName} ${l.player.lastName}` : null)).filter(Boolean))].join(', ');
    const m = paymentLinkEmail({
      parentName: inv.guardian.fullName, number: inv.number, amount: fmt(link.amount), what: d.what, dueDate: dmy(due),
      overdue: !!due && due < today, players, url: link.url, company: profile.companyName, online: link.online,
      bankLine: `Bank transfer: ${profile.bank.accountName}, ${profile.bank.bankName}, IBAN ${profile.bank.iban}. Please write "${profile.academyName} – [Name of Player]" as the payment details.`,
    });
    const r = await this.notifications.sendMessage({ guardianId: inv.guardianId, subject: m.subject, html: m.html, text: m.text, kind: 'payment_link', ref: { type: 'invoice', id: inv.id } });
    await this.links.update(link.id, { sentAt: new Date(), sentTo: r.to });
    return { ...link, email: r };
  }

  /** The links made for an invoice, newest first (the drawer). */
  async forInvoice(invoiceId: string) {
    const rows = await this.links.find({ where: { invoiceId }, order: { createdAt: 'DESC' }, take: 20 });
    const base = await this.base();
    return rows.map((l) => ({ id: l.id, url: l.status === 'ACTIVE' ? `${base}/pay/#${l.token}` : null, amount: Number(l.amount), instalmentSeq: l.instalmentSeq ?? null,
      status: l.status === 'ACTIVE' && l.expiresAt < new Date() ? 'EXPIRED' : l.status, createdAt: l.createdAt, expiresAt: l.expiresAt,
      sentAt: l.sentAt ?? null, sentTo: l.sentTo ?? null, openedAt: l.openedAt ?? null, paidAt: l.paidAt ?? null }));
  }

  // ------------------------------------------------------------------ public

  private async byToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token || '')) throw new NotFoundException('This payment link is not valid.');
    const link = await this.links.findOne({ where: { token } });
    if (!link) throw new NotFoundException('This payment link is not valid.');
    return link;
  }

  /** What the parent sees: the academy, the invoice number, first names, the amount and how to pay. Nothing else. */
  async publicView(token: string) {
    const link = await this.byToken(token);
    const inv = await this.invoices.findOne({ where: { id: link.invoiceId }, relations: { lineItems: { player: true } } });
    const profile = await this.settings.invoiceProfile();
    let amount = Number(link.amount), status = link.status;
    if (status === 'ACTIVE' && link.expiresAt < new Date()) status = 'EXPIRED';
    if (status === 'ACTIVE' && inv) {
      try {
        const d = await this.due(inv.id, link.instalmentSeq);
        amount = r2(Math.min(amount, d.amount));
        if (amount <= 0.005) status = 'PAID';
      } catch { status = 'CANCELLED'; }
      if ([InvoiceStatus.CANCELLED].includes(inv.status)) status = 'CANCELLED';
    }
    if (!link.openedAt) await this.links.update(link.id, { openedAt: new Date() });
    const kids = [...new Set((inv?.lineItems || []).map((l) => l.player?.firstName).filter(Boolean))];
    return {
      academy: profile.academyName, company: profile.companyName, number: inv?.number ?? '', children: kids,
      what: link.instalmentSeq ? `Instalment ${link.instalmentSeq}` : 'Invoice balance', amount, currency: 'AED', status,
      expiresAt: link.expiresAt, online: this.gateway.isLive,
      bank: this.gateway.isLive ? null : { accountName: profile.bank.accountName, bankName: profile.bank.bankName, iban: profile.bank.iban, swift: profile.bank.swift,
        reference: `${profile.academyName} – ${kids.join(', ')}` },
    };
  }

  /** Start the card payment. Refused until a gateway is connected. */
  async checkout(token: string) {
    const v = await this.publicView(token);
    if (v.status !== 'ACTIVE') throw new BadRequestException(v.status === 'PAID' ? 'This has already been paid — thank you.' : 'This payment link is no longer active. Please ask the academy for a new one.');
    if (!this.gateway.isLive) throw new ConflictException('Online card payment is not switched on yet. Please pay by bank transfer using the details on this page.');
    const link = await this.byToken(token);
    const inv = await this.invoices.findOne({ where: { id: link.invoiceId }, relations: { guardian: true } });
    const session = await this.gateway.createCheckout({ invoiceId: link.invoiceId, invoiceNumber: inv!.number, amount: v.amount, customerEmail: inv!.guardian?.email });
    await this.links.update(link.id, { gatewayId: session.gatewayId });
    return { paymentUrl: session.paymentUrl };
  }
}
