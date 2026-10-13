import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  AppliedDiscount, DiscountRule, Enrolment, EnrolmentStatus, Invoice, InvoiceLineItem, InvoiceStatus, InvoiceType,
  Player, PlayerComment, RevenueStream, Season, Team, TermPackage,
} from '../../database/entities';
import { ReferenceService } from '../../common/reference.service';
import { DomainEvents } from '../../common/domain-events';
import { InvoicesService } from '../finance/invoices.service';
import { PaymentsService } from '../finance/payments.service';
import { InstalmentsService } from '../finance/instalments.service';
import { PricingService } from '../finance/pricing.service';
import { ProrationService } from '../finance/proration.service';
import { PACKAGE_LABEL, defaultSessionsPerWeek, lineVat, splitIncl } from '../finance/pricing';
import { discountPercentOf, evenPercents, moveCharge, MoveCharge } from './squad-move';
import { dubaiToday, dubaiDatePlus } from '../../common/dubai-date';

const r2 = (n: number) => Math.round(n * 100) / 100;
const dmy = (d: string) => d.split('-').reverse().join('/');

export interface MoveOptions {
  toTeamId: string;
  /** First day in the new team (YYYY-MM-DD); today when omitted. */
  moveDate?: string;
  /** Sessions a week in the new team (1, 2 or 3, if the price list has it); the team's schedule when omitted. */
  sessionsPerWeek?: number;
  /** Issue (and auto-email, if switched on) the move-up invoice now; otherwise it stays a draft. Default true. */
  issue?: boolean;
  /** Move-up on an instalment plan: split over the original plan's remaining dates, or one payment. Default 'split'. */
  instalments?: 'split' | 'one';
  /** Move to fewer sessions: credit the prorated difference (write-off on what is owed, then the wallet). Default false. */
  credit?: boolean;
  reason?: string;
}

/** One purchase (term invoice) affected by the move. */
interface GroupQuote {
  invoiceId: string | null; invoiceNumber: string | null; invoiceStatus: string | null;
  package: TermPackage | null; packageLabel: string | null;
  fromTeam: string | null; fromLevel: string | null; fromSessions: number; toSessions: number;
  terms: Array<{ id: string; name: string; enrolmentId: string }>;
  oldPrice: number | null; newPrice: number | null;
  /** The new team's sessions from the move date / in the option, and the old team's. */
  sessionsLeft: number | null; sessionsTotal: number | null; ratio: number;
  oldSessionsLeft: number | null; oldSessionsTotal: number | null; oldRatio: number;
  discountPercent: number; discountLabel: string | null;
  charge: MoveCharge;
  priceNote: string | null;
  /** Remaining instalment due dates of the term invoice (for splitting a move-up). */
  remainingDueDates: string[];
}

/**
 * Squad moves (Karim, 12 Oct 2026): move a child to another team during the season —
 * typically Development → Advanced/HPC when the coaches move them up — and settle the
 * money in the same step. The term invoice is never changed: a move-up is charged on
 * its own linked invoice ("Squad move-up", type ADDITIONAL), a move down may be
 * credited with a tax credit note. History is kept: each moved term's old enrolment
 * stays (TRANSFERRED, on the term invoice) and a new one starts in the new team.
 */
@Injectable()
export class SquadMoveService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private readonly lines: Repository<InvoiceLineItem>,
    @InjectRepository(PlayerComment) private readonly comments: Repository<PlayerComment>,
    private readonly refs: ReferenceService,
    private readonly events: DomainEvents,
    private readonly invoicing: InvoicesService,
    private readonly payments: PaymentsService,
    private readonly instalments: InstalmentsService,
    private readonly pricing: PricingService,
    private readonly proration: ProrationService,
  ) {}

  /** What a move would do — nothing is saved. */
  async quote(playerId: string, opts: Pick<MoveOptions, 'toTeamId' | 'moveDate' | 'sessionsPerWeek'>) {
    const moveDate = opts.moveDate || dubaiToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(moveDate)) throw new BadRequestException('The move date must be a date (YYYY-MM-DD).');
    const player = await this.players.findOne({ where: { id: playerId }, relations: { ageGroup: true, currentTeam: true } });
    if (!player) throw new NotFoundException('Player not found');
    if (player.archivedAt) throw new BadRequestException('This child is archived — restore them first.');
    const toTeam = await this.teams.findOne({ where: { id: opts.toTeamId } });
    if (!toTeam || !toTeam.isActive) throw new BadRequestException('Choose an active team.');
    const season = await this.seasons.findOne({ where: { isActive: true } });
    if (!season) throw new BadRequestException('There is no active season.');

    // The child's current enrolments this season (replaced ones are TRANSFERRED and left out).
    const current = await this.enrolments.find({
      where: { playerId, seasonId: season.id, status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING, EnrolmentStatus.COMPLETED]) },
      relations: { term: true, team: true },
    });
    const movable = current.filter((e) => e.status !== EnrolmentStatus.COMPLETED && e.term && String(e.term.endDate) >= moveDate);
    if (!movable.length) throw new BadRequestException('The child has no term from that date on to move — register the next term in the new team instead.');
    if (movable.every((e) => e.teamId === toTeam.id)) throw new BadRequestException(`${player.firstName} is already in ${toTeam.name}.`);

    const warnings: string[] = [];
    // A move stays within the child's own age category (Karim, 12 Oct 2026): a U12
    // goes from U12 Development to U12 Advanced or U12 HPC, never to another age group.
    const code = player.ageGroup?.code ?? null;
    if (!code) throw new BadRequestException(`${player.firstName} has no age category — check the date of birth first.`);
    if (!toTeam.ageCodes?.includes(code)) {
      throw new BadRequestException(`${toTeam.name} isn't a ${code} team — a move stays within ${player.firstName}'s age category (${code}).`);
    }
    if (player.currentTeamId !== toTeam.id) {
      const inTeam = await this.players.count({ where: { currentTeamId: toTeam.id } });
      if (toTeam.capacity && inTeam >= toTeam.capacity) throw new BadRequestException(`${toTeam.name} is full (${toTeam.capacity}).`);
    }
    // Sessions a week: the new team's schedule unless another tier is chosen; the price
    // list decides which tiers the category can buy (U6, U8 and Girls: 1 or 2 a week).
    const category = toTeam.girlsOnly ? 'GIRLS' : code;
    const list = await this.pricing.priceList(season.id);
    const tiers = list.tiers
      .filter((t) => t.rows.some((r) => r.category === category && r.isActive))
      .map((t) => t.sessionsPerWeek).sort((a, b) => a - b);
    const teamSessions = defaultSessionsPerWeek(toTeam);
    const toSessions = opts.sessionsPerWeek ?? (tiers.length && !tiers.includes(teamSessions) ? tiers[tiers.length - 1] : teamSessions);
    if (![1, 2, 3].includes(toSessions)) throw new BadRequestException('Sessions a week must be 1, 2 or 3.');
    if (tiers.length && !tiers.includes(toSessions)) {
      throw new BadRequestException(`${toSessions}×/week isn't offered for ${category} — the price list has ${tiers.map((t) => t + '×').join(', ')}.`);
    }
    if (toSessions !== teamSessions) warnings.push(`${toTeam.name} trains ${teamSessions}×/week; ${player.firstName} is charged for ${toSessions}×/week.`);

    // One group per purchase (term invoice); terms not yet invoiced move without a charge.
    const groups = new Map<string, Enrolment[]>();
    for (const e of current) {
      const key = e.invoiceId ?? `none:${e.id}`;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    const out: GroupQuote[] = [];
    for (const [key, all] of groups) {
      const moving = all.filter((e) => movable.includes(e) && e.teamId !== toTeam.id);
      if (!moving.length) continue;
      const invoiceId = key.startsWith('none:') ? null : key;
      const inv = invoiceId ? await this.invoicing.findOne(invoiceId) : null;
      const sortedAll = all.slice().sort((a, b) => String(a.term.startDate).localeCompare(String(b.term.startDate)));
      const first = moving[0];
      const fromSessions = first.sessionsPerWeek ?? defaultSessionsPerWeek(first.team ?? null);
      const g: GroupQuote = {
        invoiceId, invoiceNumber: inv?.number ?? null, invoiceStatus: inv?.status ?? null,
        package: null, packageLabel: null,
        fromTeam: first.team?.name ?? null, fromLevel: first.team?.level ?? null, fromSessions, toSessions,
        terms: moving.sort((a, b) => String(a.term.startDate).localeCompare(String(b.term.startDate)))
          .map((e) => ({ id: e.termId, name: e.term.name, enrolmentId: e.id })),
        oldPrice: null, newPrice: null, sessionsLeft: null, sessionsTotal: null, ratio: 1,
        oldSessionsLeft: null, oldSessionsTotal: null, oldRatio: 1,
        discountPercent: 0, discountLabel: null,
        charge: { newPart: 0, oldPart: 0, gross: 0, discount: 0, amount: 0, direction: 'SAME' }, priceNote: null, remainingDueDates: [],
      };
      if (!inv || inv.status === InvoiceStatus.CANCELLED) {
        g.priceNote = 'Not invoiced — the move changes the team only.';
        out.push(g); continue;
      }
      if (fromSessions === toSessions) {
        g.priceNote = `Same price: ${toSessions}×/week before and after.`;
        out.push(g); continue;
      }
      try {
        const pkg = (sortedAll.find((e) => e.package)?.package as TermPackage | undefined)
          ?? await this.pricing.packageFor(season.id, sortedAll.map((e) => e.termId));
        g.package = pkg; g.packageLabel = PACKAGE_LABEL[pkg];
        const price = async (spw: number, team: Team | null) => {
          const r = await this.pricing.resolve({ seasonId: season.id, package: pkg, sessionsPerWeek: spw, category: code ?? team?.ageCodes?.[0] ?? null, girlsOnly: team?.girlsOnly });
          if (!r.ok || (r as any).inclVat == null) throw new BadRequestException((r as any).reason ?? `No ${spw}×/week price for ${code}.`);
          return Number((r as any).inclVat);
        };
        g.oldPrice = await price(fromSessions, first.team ?? null);
        g.newPrice = await price(toSessions, toTeam);
        // Two calendars: the new team's sessions left from the move date, and the old team's
        // sessions not yet trained (from the move date, or the child's own start if later).
        const optionTerms = sortedAll.map((e) => e.term);
        const pr = await this.proration.forPurchase(optionTerms, toTeam, moveDate, toSessions);
        g.ratio = pr ? pr.ratio : 1;
        g.sessionsLeft = pr?.sessionsLeft ?? null; g.sessionsTotal = pr?.sessionsTotal ?? null;
        const childStart = sortedAll.map((e) => e.startDate).filter(Boolean).sort()[0] as string | undefined;
        const oldFrom = childStart && childStart > moveDate ? childStart : moveDate;
        const opr = await this.proration.forPurchase(optionTerms, first.team ?? null, oldFrom, fromSessions).catch(() => null);
        g.oldRatio = opr ? opr.ratio : 1;
        g.oldSessionsLeft = opr?.sessionsLeft ?? null; g.oldSessionsTotal = opr?.sessionsTotal ?? null;
        // The child's discount on the term invoice (sibling or manual — they never stack).
        const unit = (inv.lineItems || []).filter((l) => l.playerId === playerId && l.stream === RevenueStream.ACADEMY && !l.productId)
          .reduce((s, l) => s + Number(l.unitAmount), 0);
        const disc = (inv.discounts || []).filter((d) => d.playerId === playerId);
        g.discountPercent = discountPercentOf(unit, disc.reduce((s, d) => s + Number(d.amount), 0));
        g.discountLabel = disc.length ? disc.map((d) => d.label).join(', ') : null;
        g.charge = moveCharge({ oldPrice: g.oldPrice, newPrice: g.newPrice, oldRatio: g.oldRatio, newRatio: g.ratio, discountPercent: g.discountPercent });
        // Remaining instalment dates of the term invoice, for splitting a move-up the same way.
        const plan = await this.instalments.summary(inv.id).catch(() => null);
        if (plan?.hasPlan) {
          g.remainingDueDates = plan.instalments
            .filter((x: any) => x.state !== 'WAIVED' && x.remaining > 0.005 && x.dueDate >= dubaiToday())
            .map((x: any) => x.dueDate);
        }
      } catch (e: any) {
        g.priceNote = `Can't price the move: ${e?.response?.message ?? e?.message}`;
      }
      out.push(g);
    }

    const toPay = r2(out.filter((g) => g.charge.amount > 0).reduce((s, g) => s + g.charge.amount, 0));
    const toCredit = r2(out.filter((g) => g.charge.amount < 0).reduce((s, g) => s - g.charge.amount, 0));
    return {
      player: { id: player.id, name: `${player.firstName} ${player.lastName}`, reference: player.reference, category: code },
      fromTeam: player.currentTeam?.name ?? null,
      toTeam: { id: toTeam.id, name: toTeam.name, level: toTeam.level, sessionsPerWeek: toSessions, teamSessionsPerWeek: teamSessions },
      tiers,
      moveDate, groups: out, toPay, toCredit,
      direction: toPay > 0 ? 'UP' : toCredit > 0 ? 'DOWN' : 'SAME',
      warnings,
    };
  }

  /** Move the child and settle the money. */
  async apply(playerId: string, opts: MoveOptions, actorId?: string) {
    const q = await this.quote(playerId, opts);
    const unpriced = q.groups.find((g) => g.priceNote?.startsWith("Can't price"));
    if (unpriced) throw new BadRequestException(unpriced.priceNote!);
    const toTeam = (await this.teams.findOne({ where: { id: opts.toTeamId } }))!;
    const player = (await this.players.findOne({ where: { id: playerId } }))!;
    const reason = (opts.reason || '').trim().slice(0, 200);
    const name = `${player.firstName} ${player.lastName}`;

    // 1) Team change + move-up invoices, all or nothing.
    const created: Array<{ invoiceId: string; group: GroupQuote }> = [];
    await this.ds.transaction(async (m) => {
      for (const g of q.groups) {
        let moveUpInvoiceId: string | null = null;
        if (g.charge.amount > 0.005 && g.invoiceId) {
          const vatRate = 5;
          const grossNet = splitIncl(g.charge.gross, vatRate).net;            // list difference, excl. VAT
          const discountNet = r2(grossNet * g.discountPercent / 100);
          const netLine = r2(grossNet - discountNet);
          const vat = lineVat(netLine, vatRate, g.charge.gross, discountNet > 0);
          const sessions = g.sessionsLeft != null
            ? ` (new team: ${g.sessionsLeft} of ${g.sessionsTotal} sessions left${g.oldSessionsLeft != null ? `; unused in old team: ${g.oldSessionsLeft} of ${g.oldSessionsTotal}` : ''})` : '';
          const inv = await m.getRepository(Invoice).save(m.getRepository(Invoice).create({
            number: await this.refs.next('LA'), guardianId: player.guardianId,
            type: InvoiceType.ADDITIONAL, purpose: 'MOVE_UP', relatedInvoiceId: g.invoiceId,
            status: InvoiceStatus.DRAFT, issueDate: dubaiToday(),
            dueDate: g.remainingDueDates[0] && opts.instalments !== 'one'
              ? g.remainingDueDates[0] : dubaiDatePlus(14),
            subtotal: netLine.toFixed(2), vatTotal: vat.toFixed(2), discountTotal: discountNet.toFixed(2),
            total: r2(netLine + vat).toFixed(2),
            notes: [`Squad move-up for ${g.invoiceNumber}`, reason].filter(Boolean).join(' — '),
          }));
          await m.getRepository(InvoiceLineItem).save(m.getRepository(InvoiceLineItem).create({
            invoiceId: inv.id, playerId,
            description: `${name} — Squad move-up: ${g.fromTeam ?? '—'} (${g.fromSessions}×/week) → ${toTeam.name} (${g.toSessions}×/week) from ${dmy(q.moveDate)} · ${g.packageLabel}${sessions} · for ${g.invoiceNumber}`,
            quantity: 1, unitAmount: grossNet.toFixed(2), vatRate: vatRate.toFixed(2), lineTotal: netLine.toFixed(2),
            stream: RevenueStream.ACADEMY, package: g.package,
          }));
          if (discountNet > 0) {
            await m.getRepository(AppliedDiscount).save(m.getRepository(AppliedDiscount).create({
              invoiceId: inv.id, playerId, label: `Same discount as ${g.invoiceNumber} (${g.discountPercent}%)`,
              rule: DiscountRule.MANUAL, amount: discountNet.toFixed(2), wasAutomatic: false,
              reason: g.discountLabel ? `On ${g.invoiceNumber}: ${g.discountLabel}` : undefined,
            }));
          }
          moveUpInvoiceId = inv.id;
          created.push({ invoiceId: inv.id, group: g });
        }
        for (const t of g.terms) {
          const old = (await m.getRepository(Enrolment).findOne({ where: { id: t.enrolmentId }, relations: { term: true } }))!;
          await m.getRepository(Enrolment).update(old.id, { status: EnrolmentStatus.TRANSFERRED, endedAt: new Date(`${q.moveDate}T00:00:00+04:00`) });
          const termStarted = String(old.term.startDate) < q.moveDate;
          await m.getRepository(Enrolment).save(m.getRepository(Enrolment).create({
            playerId, seasonId: old.seasonId, termId: old.termId, teamId: toTeam.id,
            status: old.status === EnrolmentStatus.PENDING ? EnrolmentStatus.PENDING : EnrolmentStatus.ACTIVE,
            sessionsPerWeek: g.toSessions, package: old.package ?? g.package ?? null,
            startDate: termStarted ? (old.startDate && old.startDate > q.moveDate ? old.startDate : q.moveDate) : (old.startDate ?? null),
            invoiceId: old.invoiceId ?? undefined, movedFromId: old.id, moveUpInvoiceId,
          }));
        }
      }
      await m.getRepository(Player).update(playerId, { currentTeamId: toTeam.id, level: toTeam.level as any });
    });

    // 2) Instalments, issue + email (finance services: same checks and logs as anywhere else).
    const invoicesOut: any[] = [];
    for (const c of created) {
      const dates = opts.instalments === 'one' ? [] : c.group.remainingDueDates;
      if (dates.length >= 2) {
        const pcts = evenPercents(Math.min(dates.length, 5));
        await this.instalments.setPlan(c.invoiceId, pcts.map((percent, i) => ({ percent, dueDate: dates[i] })));
      }
      if (opts.issue !== false) {
        await this.invoicing.issue(c.invoiceId);
        await this.events.emit({ type: 'invoice.issued', invoiceId: c.invoiceId, actorId });
      }
      invoicesOut.push(await this.invoicing.findOne(c.invoiceId));
    }

    // 3) A move to fewer sessions, if the desk chose to credit it: first what is still owed
    //    (write-off with a credit note), then the wallet (refund to wallet, with a credit note).
    const credits: Array<{ invoiceNumber: string | null; writtenOff: number; toWallet: number }> = [];
    if (opts.credit) {
      for (const g of q.groups.filter((x) => x.charge.amount < -0.005 && x.invoiceId)) {
        const amt = -g.charge.amount;
        const inv = await this.invoicing.findOne(g.invoiceId!);
        const owed = r2(Number(inv.total) - Number(inv.amountPaid) - Number(inv.writeOffAmount));
        const why = `Squad move: ${g.fromTeam} (${g.fromSessions}×/week) → ${toTeam.name} (${g.toSessions}×/week) from ${dmy(q.moveDate)}`;
        const wo = [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID].includes(inv.status) ? r2(Math.min(owed, amt)) : 0;
        if (wo > 0.005) await this.invoicing.writeOff(inv.id, wo, why, { creditNote: true, actorId });
        const netPaid = r2(Number(inv.amountPaid) - Number(inv.amountRefunded));
        const toWallet = r2(Math.min(amt - wo, netPaid));
        if (toWallet > 0.005) await this.payments.refund({ invoiceId: inv.id, amount: toWallet, reason: why, toWallet: true, recordedById: actorId });
        credits.push({ invoiceNumber: g.invoiceNumber, writtenOff: wo, toWallet });
      }
    }

    // 4) The child's history, in words.
    const money = invoicesOut.length
      ? invoicesOut.map((i) => `move-up invoice ${i.number}, AED ${Number(i.total).toFixed(2)}`).join('; ')
      : credits.length ? credits.map((c) => `credited AED ${(c.writtenOff + c.toWallet).toFixed(2)} on ${c.invoiceNumber}`).join('; ')
      : q.toCredit > 0 ? `AED ${q.toCredit.toFixed(2)} not credited` : 'no change in price';
    await this.comments.save(this.comments.create({
      playerId, authorId: actorId,
      body: `Moved from ${q.fromTeam ?? '—'} to ${toTeam.name} on ${dmy(q.moveDate)} — ${money}.${reason ? ` ${reason}` : ''}`,
    }));

    return { moved: q.groups.reduce((s, g) => s + g.terms.length, 0), quote: q, invoices: invoicesOut, credits };
  }
}
