import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Not, Repository } from 'typeorm';
import {
  AppliedDiscount, DiscountRule, Enrolment, EnrolmentStatus, Invoice, InvoiceLineItem, InvoiceStatus,
  Player, PlayerComment, RevenueStream, SiblingCredit, Term,
} from '../../database/entities';
import { DiscountEngine } from './discount-engine.service';
import { PaymentsService } from './payments.service';
import { AuditService } from '../../audit/audit.service';
import { ordinal } from './sibling-ladder';

const money = (n: number) => Math.round(n * 100) / 100;

/** Invoices a credit can sensibly relate to. Drafts, cancelled, refunded, written-off and sponsored are left alone. */
const CREDITABLE: InvoiceStatus[] = [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID, InvoiceStatus.PAID];

export interface SiblingCreditResult {
  playerId: string;
  playerName: string;
  invoiceNumber: string;
  percentBefore: number;
  percentAfter: number;
  total: number;
  appliedToInvoice: number;
  leftInWallet: number;
  reason: string;
}

/**
 * Academy policy (confirmed Oct 2026): when an older child registers after a
 * younger one in the same term, the younger child moves down the sibling ladder
 * and is owed the difference — credited automatically.
 *
 * How, and why this way:
 *  - The younger child's issued invoice is NEVER edited. Issued invoices stay as
 *    issued, which keeps the VAT record clean.
 *  - The difference (plus its VAT) is credited to the family wallet. If that
 *    invoice still has a balance, the credit is applied to it straight away as a
 *    wallet payment; if it is already paid, the credit stays in the wallet for
 *    the next invoice.
 *  - Every credit is a row in `sibling_credits`, so a later re-rank only credits
 *    what is still owed. Running this twice credits nothing the second time.
 *  - A manual discount on the younger child is a deliberate decision and is left
 *    untouched — no automatic credit on top of it.
 *  - Credits only ever go to the parent. A re-rank that would lower a discount
 *    never claws money back.
 *
 * Runs when an invoice is ISSUED (not when a draft is generated), because a draft
 * that is later cancelled must not leave a credit behind.
 */
@Injectable()
export class SiblingCreditService {
  private readonly logger = new Logger('SiblingCredit');

  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private readonly lines: Repository<InvoiceLineItem>,
    @InjectRepository(AppliedDiscount) private readonly applied: Repository<AppliedDiscount>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(PlayerComment) private readonly comments: Repository<PlayerComment>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(SiblingCredit) private readonly credits: Repository<SiblingCredit>,
    private readonly engine: DiscountEngine,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  /** Credit any sibling whose ladder position improved because of this invoice. */
  async reconcileForInvoice(invoiceId: string, actorId?: string): Promise<SiblingCreditResult[]> {
    const trigger = await this.invoices.findOne({ where: { id: invoiceId }, relations: { lineItems: true } });
    if (!trigger || !CREDITABLE.includes(trigger.status)) return [];

    const onThisInvoice = new Set(trigger.lineItems.map((l) => l.playerId).filter(Boolean) as string[]);
    if (!onThisInvoice.size) return [];
    const newcomers = await this.players.find({ where: { id: In([...onThisInvoice]) }, order: { dateOfBirth: 'ASC' } });
    const newcomerNames = newcomers.map((p) => p.firstName).join(' and ');

    const triggerEnrolments = await this.enrolments.find({ where: { invoiceId } });
    const termPairs = [...new Map(triggerEnrolments.map((e) => [e.termId, { termId: e.termId, seasonId: e.seasonId }])).values()];

    const out: SiblingCreditResult[] = [];
    // A multi-term purchase (Terms 1 & 2, Full season) has one enrolment per term
    // but ONE invoice line, so each sibling invoice is considered once.
    const considered = new Set<string>();
    for (const { termId, seasonId } of termPairs) {
      const term = await this.terms.findOne({ where: { id: termId } });
      const plan = await this.engine.siblingPlan({ guardianId: trigger.guardianId, seasonId });
      const rungs = new Map(plan.entries.map((e) => [e.playerId, e]));

      const siblingEnrolments = (await this.enrolments.find({
        where: {
          termId, invoiceId: Not(IsNull()),
          status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]),
        },
        relations: { player: true },
      })).filter((e) => e.player?.guardianId === trigger.guardianId
        && !onThisInvoice.has(e.playerId) && e.invoiceId !== invoiceId);

      for (const e of siblingEnrolments) {
        const key = `${e.invoiceId}:${e.playerId}`;
        if (considered.has(key)) continue;
        considered.add(key);
        const credit = await this.creditOne({
          trigger, termId, termName: term?.name ?? 'this term', enrolment: e,
          rung: rungs.get(e.playerId), newcomerNames, actorId,
        });
        if (credit) out.push(credit);
      }
    }
    return out;
  }

  private async creditOne(ctx: {
    trigger: Invoice; termId: string; termName: string; enrolment: Enrolment;
    rung?: { rank: number; percent: number }; newcomerNames: string; actorId?: string;
  }): Promise<SiblingCreditResult | null> {
    const { trigger, termId, termName, enrolment: e, rung } = ctx;
    if (!rung || rung.percent <= 0) return null;

    const inv = await this.invoices.findOne({ where: { id: e.invoiceId! } });
    if (!inv || !CREDITABLE.includes(inv.status)) return null;
    // The term-fee line only: kits and the league are never sibling-discounted.
    const line = await this.lines.findOne({ where: { invoiceId: inv.id, playerId: e.playerId, stream: RevenueStream.ACADEMY } });
    if (!line) return null;

    const given = await this.applied.find({ where: { invoiceId: inv.id, playerId: e.playerId } });
    if (given.some((a) => a.rule !== DiscountRule.SIBLING)) return null;   // a manual decision stands

    const list = Number(line.unitAmount);
    const vatRate = Number(line.vatRate);
    const givenNet = given.reduce((s, a) => s + Number(a.amount), 0);
    // Credits already made against this invoice for this child (any term of it).
    const prior = await this.credits.find({ where: { playerId: e.playerId, invoiceId: inv.id } });
    const creditedNet = prior.reduce((s, c) => s + Number(c.netAmount), 0);
    const owedNet = money(money(list * (rung.percent / 100)) - givenNet - creditedNet);
    if (owedNet < 0.01) return null;

    const vat = money(owedNet * (vatRate / 100));
    const total = money(owedNet + vat);
    const percentBefore = list ? Math.round(((givenNet + creditedNet) / list) * 100) : 0;
    const childName = `${e.player.firstName} ${e.player.lastName}`;
    const reason = `${ctx.newcomerNames} joined the family — ${e.player.firstName} is now the ${ordinal(rung.rank)} child ` +
      `(${rung.percent}% sibling discount) for ${termName}.`;

    // Claim the credit before moving money, so a failure part-way can never lead
    // to the same difference being credited twice.
    const row = await this.credits.save(this.credits.create({
      guardianId: trigger.guardianId, playerId: e.playerId, termId, invoiceId: inv.id,
      triggeredByInvoiceId: trigger.id, percentBefore, percentAfter: rung.percent,
      netAmount: owedNet.toFixed(2), vatAmount: vat.toFixed(2), totalAmount: total.toFixed(2),
      appliedToInvoice: '0.00', reason,
    }));

    let credited = false;
    let appliedAmt = 0;
    try {
      await this.payments.creditWallet(trigger.guardianId, total,
        `Sibling discount credit — ${childName}, ${termName} (${inv.number})`);
      credited = true;
      const balance = money(Number(inv.total) - Number(inv.amountPaid) + Number(inv.amountRefunded) - Number(inv.writeOffAmount));
      if (balance > 0) {
        appliedAmt = money(Math.min(balance, total));
        await this.payments.payFromWallet(inv.id, appliedAmt, ctx.actorId);
      }
      await this.credits.update(row.id, { appliedToInvoice: appliedAmt.toFixed(2) });
    } catch (err) {
      if (!credited) {
        await this.credits.delete(row.id);   // nothing moved; release the claim
        this.logger.error(`Sibling credit for ${childName} not made: ${(err as Error).message}`);
        return null;
      }
      // The wallet holds the credit; only applying it to the invoice failed.
      this.logger.warn(`Sibling credit for ${childName} is in the wallet but was not applied to ${inv.number}: ${(err as Error).message}`);
    }

    const where = appliedAmt >= total
      ? `applied to ${inv.number}`
      : appliedAmt > 0
        ? `AED ${appliedAmt.toFixed(2)} applied to ${inv.number}, AED ${(total - appliedAmt).toFixed(2)} left in the wallet`
        : `added to the family wallet (${inv.number} was already paid)`;
    await this.comments.save(this.comments.create({
      playerId: e.playerId, authorId: ctx.actorId,
      body: `Sibling discount re-ranked: ${reason} AED ${total.toFixed(2)} credited — ${where}.`,
    }));
    await this.audit.record({
      actorId: ctx.actorId, actorType: ctx.actorId ? 'user' : 'system',
      action: 'discount.sibling_credit', entity: 'player', entityId: e.playerId,
      metadata: {
        reason, invoice: inv.number, triggeredBy: trigger.number,
        percentBefore, percentAfter: rung.percent, total, appliedToInvoice: appliedAmt,
      },
    });

    return {
      playerId: e.playerId, playerName: childName, invoiceNumber: inv.number,
      percentBefore, percentAfter: rung.percent, total,
      appliedToInvoice: appliedAmt, leftInWallet: money(total - appliedAmt), reason,
    };
  }

  /** Credits already made for a child — shown on the player page. */
  listForPlayer(playerId: string) {
    return this.credits.find({ where: { playerId }, order: { createdAt: 'DESC' } });
  }
}
