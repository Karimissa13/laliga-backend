import { ManualDiscount, manualAmount, resolveManualDiscount } from './manual-discounts';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import {
  AppliedDiscount, DiscountRule, Enrolment, Fee, Guardian, Invoice, InvoiceLineItem,
  InvoiceStatus, InvoiceType, Payment, PaymentDirection, PaymentStatus, Player, Term,
  Product, RevenueStream, TermPackage, InvoiceInstalment,
} from '../../database/entities';
import { PricingService } from './pricing.service';
import { Proration, ProrationService } from './proration.service';
import { amountsFor } from './instalments';
import { PACKAGE_LABEL, defaultSessionsPerWeek, lineVat, splitIncl } from './pricing';

/** An item added to an invoice besides the term fee: a kit, the league, or a custom charge. */
export interface ExtraItem {
  playerId?: string;
  productId?: string;
  quantity?: number;
  /** Custom item (no product): what it is, its VAT-inclusive price and where it is reported. */
  description?: string;
  amountInclVat?: number;
  stream?: RevenueStream;
}

const LEVEL_WORD: Record<string, string> = { DEVELOPMENT: 'Development', ADVANCED: 'Advanced', HPC: 'HPC' };
import { ReferenceService } from '../../common/reference.service';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';
import { DiscountEngine } from './discount-engine.service';

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Settlement tolerance. Splitting a total across instalments can leave a
 * sub-cent residue (e.g. 3591.95 paid as 2 × 1795.97 = 3591.94). Without a
 * tolerance such invoices sit in PART_PAID forever and pollute the outstanding
 * report, so anything within this window counts as settled.
 */
const SETTLEMENT_TOLERANCE = 0.05;

@Injectable()
export class InvoicesService {
  constructor(
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private readonly lines: Repository<InvoiceLineItem>,
    @InjectRepository(AppliedDiscount) private readonly applied: Repository<AppliedDiscount>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    @InjectRepository(Fee) private readonly fees: Repository<Fee>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(InvoiceInstalment) private readonly instalmentRows: Repository<InvoiceInstalment>,
    private readonly refs: ReferenceService,
    private readonly discountEngine: DiscountEngine,
    private readonly pricing: PricingService,
    private readonly proration: ProrationService,
  ) {}

  // ---------------------------------------------------------------- queries
  async list(q: PaginationDto & { status?: InvoiceStatus; guardianId?: string; overdueOnly?: string }) {
    const qb = this.invoices.createQueryBuilder('i')
      .leftJoinAndSelect('i.guardian', 'g')
      .leftJoinAndSelect('i.lineItems', 'li')
      .orderBy('i.createdAt', 'DESC')
      .skip(q.skip).take(q.limit);
    if (q.status) qb.andWhere('i.status = :st', { st: q.status });
    if (q.guardianId) qb.andWhere('i.guardianId = :gid', { gid: q.guardianId });
    if (q.overdueOnly === 'true') {
      qb.andWhere('i.status IN (:...st)', { st: [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID] })
        .andWhere('i.dueDate IS NOT NULL AND i.dueDate < now()');
    }
    if (q.search) {
      qb.andWhere(new Brackets((w) => {
        w.where('i.number ILIKE :s', { s: `%${q.search}%` })
          .orWhere('g.fullName ILIKE :s', { s: `%${q.search}%` })
          .orWhere('g.email ILIKE :s', { s: `%${q.search}%` });
      }));
    }
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  async findOne(id: string) {
    const inv = await this.invoices.findOne({
      where: { id },
      relations: { guardian: true, lineItems: { player: true }, payments: true, discounts: true },
    });
    if (!inv) throw new NotFoundException('Invoice not found');
    return inv;
  }

  // ------------------------------------------------------------- generation
  /** Resolve the catalog price for a term (optionally narrowed by age group / location). */
  async resolveFee(termId: string, ageGroupId?: string, locationId?: string): Promise<Fee | null> {
    const all = await this.fees.find({ where: { termId, isActive: true } });
    if (!all.length) return null;
    // most specific match wins
    return (
      all.find((f) => f.ageGroupId === ageGroupId && f.locationId === locationId) ??
      all.find((f) => f.ageGroupId === ageGroupId) ??
      all.find((f) => !f.ageGroupId && !f.locationId) ??
      all[0]
    );
  }

  /**
   * Generate an invoice for one or more enrolments. Prices come from the fee
   * catalog, discounts are applied automatically by the rule engine, and VAT is
   * computed per line. Nothing is typed in by hand.
   */
  async generateForEnrolments(input: {
    enrolmentIds: string[]; type?: InvoiceType; dueInDays?: number; installments?: number; notes?: string;
    /**
     * Optional per-child manual discount, keyed by playerId. Replaces the automatic
     * sibling discount for that child — discounts never stack (academy policy).
     */
    manualDiscounts?: Record<string, ManualDiscount>;
    /** Optional kits, league and other items to add to the same invoice. */
    extras?: ExtraItem[];
  }) {
    const enrolments = await this.enrolments.find({
      where: { id: In(input.enrolmentIds) },
      relations: { player: { guardian: true, ageGroup: true }, term: true, team: { location: true } },
    });
    if (!enrolments.length) throw new BadRequestException('No enrolments found');

    const guardianIds = [...new Set(enrolments.map((e) => e.player.guardianId))];
    if (guardianIds.length > 1) {
      throw new BadRequestException('All enrolments must belong to the same guardian');
    }
    const guardianId = guardianIds[0];

    const invoice = await this.invoices.save(this.invoices.create({
      number: await this.refs.next('LA'),
      guardianId,
      type: input.type ?? InvoiceType.STANDARD,
      status: InvoiceStatus.DRAFT,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + (input.dueInDays ?? 14) * 86400000).toISOString().slice(0, 10),
      installments: input.installments ?? 1,
      notes: input.notes,
    }));

    const { subtotal: s0, vatTotal: v0, discountTotal, discountNotes } = await this.writeTrainingLines(invoice.id, guardianId, enrolments, input.manualDiscounts);
    let subtotal = s0, vatTotal = v0;

    if (input.extras?.length) {
      const x = await this.addExtraLines(invoice.id, guardianId, input.extras);
      subtotal += x.subtotal; vatTotal += x.vat;
    }

    const total = money(subtotal + vatTotal);
    await this.invoices.update(invoice.id, {
      subtotal: money(subtotal).toFixed(2),
      vatTotal: money(vatTotal).toFixed(2),
      discountTotal: money(discountTotal).toFixed(2),
      total: total.toFixed(2),
    });

    const result = await this.findOne(invoice.id);
    return { invoice: result, appliedDiscounts: discountNotes };
  }

  /**
   * The training-fee lines of an invoice: one per child (or per term without a
   * price list), the sibling ladder across the family, any manual discount
   * replacing it for that child, and proration from a start date.
   */
  private async writeTrainingLines(invoiceId: string, guardianId: string, enrolments: Enrolment[], manualDiscounts?: Record<string, ManualDiscount>) {
    let subtotal = 0;   // excl VAT, after discount
    let vatTotal = 0;
    let discountTotal = 0;
    const discountNotes: string[] = [];

    // Resolve every child's list price FIRST, so the sibling ladder can be costed
    // across the whole family in one pass. Asking per child (as this used to) gave
    // each child in a family its own discount instead of one per family position.
    //
    // With a price list for the season, a child's enrolments on this invoice are
    // ONE purchase (Term 1, Terms 1 & 2, Full season …) and get one line at the
    // VAT-inclusive list price. Without one, the older per-term fee rows are used.
    type Priced = {
      playerId: string; player: Player; group: typeof enrolments; unit: number; vatRate: number;
      incl: number | null; description: string; pkg: TermPackage | null;
    };
    const priced: Priced[] = [];
    const seasonId = enrolments[0].seasonId;
    const usePriceList = await this.pricing.hasPriceList(seasonId);
    const groups = new Map<string, typeof enrolments>();
    for (const e of enrolments) {
      const key = usePriceList ? e.playerId : e.id;
      groups.set(key, [...(groups.get(key) ?? []), e]);
    }
    for (const group of groups.values()) {
      const e = group[0];
      const name = `${e.player.firstName} ${e.player.lastName}`;
      // A start date after the first day prorates this child's training fee by sessions left.
      const starts = group.map((g) => g.startDate).filter(Boolean).sort() as string[];
      const pr = await this.proration.forPurchase(group.map((g) => g.term).filter(Boolean), group.find((g) => g.team)?.team ?? null, starts[0]);
      const prNote = pr ? ` · from ${pr.startDate.split('-').reverse().join('/')} (${pr.sessionsLeft} of ${pr.sessionsTotal} sessions)` : '';
      if (usePriceList) {
        const pkg = await this.pricing.packageFor(seasonId, group.map((g) => g.termId));
        const team = group.find((g) => g.team)?.team ?? null;
        const spw = e.sessionsPerWeek ?? defaultSessionsPerWeek(team);
        const code = e.player.ageGroup?.code ?? team?.ageCodes?.[0] ?? null;
        const r = await this.pricing.resolve({ seasonId, package: pkg, sessionsPerWeek: spw, category: code, girlsOnly: team?.girlsOnly });
        if (!r.ok) throw new BadRequestException(`${name}: ${r.reason}`);
        const level = team?.level ?? e.player.level;
        priced.push({
          playerId: e.playerId, player: e.player, group, pkg,
          ...(pr && r.inclVat != null
            ? { incl: money(r.inclVat * pr.ratio), unit: splitIncl(money(r.inclVat * pr.ratio), r.vatRate).net }
            : { incl: r.inclVat, unit: pr ? money(r.net * pr.ratio) : r.net }),
          vatRate: r.vatRate,
          description: `${name} — ${PACKAGE_LABEL[pkg]} · ${team ? team.name : `${r.category}${level ? ' ' + LEVEL_WORD[level] : ''}`} · ` +
            `${spw} session${spw === 1 ? '' : 's'}/week${prNote}`,
        });
      } else {
        const fee = await this.resolveFee(e.termId, e.player.ageGroupId ?? undefined, e.team?.locationId ?? undefined);
        if (!fee) throw new BadRequestException(`No fee configured for term "${e.term?.name}"`);
        priced.push({
          playerId: e.playerId, player: e.player, group, unit: pr ? money(Number(fee.amount) * pr.ratio) : Number(fee.amount), vatRate: Number(fee.vatRate), incl: null, pkg: null,
          description: `${name} — ${e.term?.name}${e.team ? ` (${e.team.name})` : ''}${prNote}`,
        });
      }
    }

    const baseByPlayer: Record<string, number> = {};
    for (const { playerId, unit } of priced) baseByPlayer[playerId] = unit;
    const automatic = await this.discountEngine.automaticForFamily({
      guardianId,
      seasonId,
      baseByPlayer,
    });

    // One discount per child: a manual discount passed in for a child replaces the
    // automatic one rather than stacking on top of it.
    const manual = new Map<string, ManualDiscount>(
      Object.entries(manualDiscounts ?? {}).map(([playerId, m]) => [playerId, m]),
    );

    for (const { playerId, player, group, unit, vatRate, incl, description, pkg } of priced) {
      const override = manual.get(playerId);
      const auto = automatic.get(playerId);
      const best = override
        ? {
            discountId: undefined as string | undefined,
            label: override.label,
            rule: override.rule ?? DiscountRule.MANUAL,
            amount: manualAmount(override, unit),   // training fee only — extras are separate lines
            reason: override.reason ?? undefined,
            isAutomatic: false,
          }
        : auto ?? null;
      const lineDiscount = best ? best.amount : 0;
      const netLine = money(unit - lineDiscount);
      const vat = lineVat(netLine, vatRate, incl, lineDiscount > 0);

      await this.lines.save(this.lines.create({
        invoiceId,
        playerId,
        description,
        quantity: 1,
        unitAmount: unit.toFixed(2),
        vatRate: vatRate.toFixed(2),
        lineTotal: netLine.toFixed(2),
        stream: RevenueStream.ACADEMY,
        package: pkg,
      }));

      if (best) {
        await this.applied.save(this.applied.create({
          invoiceId, discountId: best.discountId, label: best.label,
          rule: best.rule, amount: lineDiscount.toFixed(2),
          playerId,
          wasAutomatic: best.isAutomatic,
          reason: best.reason,
        }));
        discountNotes.push(`${player.firstName}: ${best.label}${best.reason ? ` — ${best.reason}` : ""}`);
      }

      subtotal += netLine;
      vatTotal += vat;
      discountTotal += lineDiscount;

      // link the enrolments to this invoice
      for (const e of group) await this.enrolments.update(e.id, { invoiceId, package: pkg });
    }

    return { subtotal, vatTotal, discountTotal, discountNotes };
  }

  /**
   * Add kits, the league or custom items to an invoice. Catalogue prices are
   * VAT-inclusive, so a AED 350 kit invoices as exactly 350.00. Sibling and
   * manual discounts never touch these lines — they apply to the term fee only.
   */
  private async addExtraLines(invoiceId: string, guardianId: string, items: ExtraItem[]) {
    const productIds = [...new Set(items.map((i) => i.productId).filter(Boolean) as string[])];
    const products = new Map((await this.pricing.productsByIds(productIds)).map((p) => [p.id, p]));
    const playerIds = [...new Set(items.map((i) => i.playerId).filter(Boolean) as string[])];
    const players = playerIds.length ? await this.players.find({ where: { id: In(playerIds) } }) : [];
    for (const id of playerIds) {
      const p = players.find((x) => x.id === id);
      if (!p || p.guardianId !== guardianId) throw new BadRequestException('Every item must be for a child of this family.');
    }
    let subtotal = 0, vat = 0;
    for (const item of items) {
      const qty = Math.max(1, Math.floor(item.quantity ?? 1));
      const product: Product | undefined = item.productId ? products.get(item.productId) : undefined;
      if (!product && !(item.description && Number(item.amountInclVat) > 0)) {
        throw new BadRequestException('A custom item needs a description and a price.');
      }
      const unitIncl = product ? Number(product.priceInclVat) : money(Number(item.amountInclVat));
      const vatRate = product ? Number(product.vatRate) : 5;
      const split = splitIncl(money(unitIncl * qty), vatRate);
      const child = players.find((x) => x.id === item.playerId);
      const what = product ? product.name : item.description!;
      await this.lines.save(this.lines.create({
        invoiceId, playerId: item.playerId,
        description: `${child ? `${child.firstName} ${child.lastName} — ` : ''}${what}${qty > 1 ? ` × ${qty}` : ''}`,
        quantity: qty,
        unitAmount: splitIncl(unitIncl, vatRate).net.toFixed(2),
        vatRate: vatRate.toFixed(2),
        lineTotal: split.net.toFixed(2),
        stream: product ? product.stream : (item.stream ?? RevenueStream.OTHER),
        productId: product?.id ?? null,
        kitItems: product?.kitItems?.length ? product.kitItems.map((k) => ({ type: k.type, qty: k.qty * qty })) : null,
      }));
      subtotal += split.net; vat += split.vat;
    }
    return { subtotal: money(subtotal), vat: money(vat) };
  }

  /**
   * An invoice for items only — kits, the league, a tournament — for a family
   * that is already registered (the desk's "User term").
   */
  async generateAdditional(input: { guardianId: string; items: ExtraItem[]; dueInDays?: number; notes?: string }) {
    if (!input.items?.length) throw new BadRequestException('Choose at least one item');
    const g = await this.guardians.findOne({ where: { id: input.guardianId } });
    if (!g) throw new BadRequestException('Invalid guardianId');
    const invoice = await this.invoices.save(this.invoices.create({
      number: await this.refs.next('LA'),
      guardianId: g.id,
      type: InvoiceType.ADDITIONAL,
      status: InvoiceStatus.DRAFT,
      issueDate: new Date().toISOString().slice(0, 10),
      dueDate: new Date(Date.now() + (input.dueInDays ?? 14) * 86400000).toISOString().slice(0, 10),
      notes: input.notes,
    }));
    const x = await this.addExtraLines(invoice.id, g.id, input.items);
    await this.invoices.update(invoice.id, {
      subtotal: x.subtotal.toFixed(2), vatTotal: x.vat.toFixed(2), discountTotal: '0.00',
      total: money(x.subtotal + x.vat).toFixed(2),
    });
    return this.findOne(invoice.id);
  }

  /**
   * Change a child's start date or manual discount on an invoice that hasn't
   * been paid yet, and re-price its training lines in place (same invoice
   * number). Kits, the league and other items are kept exactly as they were.
   * `discount: null` removes a manual discount (the sibling discount comes back);
   * `startDate: null` charges from the first day again.
   */
  async adjustTraining(id: string, input: {
    children: Array<{ playerId: string; startDate?: string | null; discount?: { preset?: string; percent?: number; reason?: string } | null }>;
  }) {
    const inv = await this.findOne(id);
    if (![InvoiceStatus.DRAFT, InvoiceStatus.ISSUED].includes(inv.status)) {
      throw new BadRequestException('Only a draft or an unpaid issued invoice can be adjusted.');
    }
    const anyMoney = (inv.payments || []).some((p) => p.status === PaymentStatus.COMPLETED) || Number(inv.amountPaid) > 0;
    if (anyMoney || Number(inv.writeOffAmount) > 0 || inv.isSponsored) {
      throw new BadRequestException('This invoice already has a payment, write-off or sponsorship — adjust it before any money is recorded.');
    }
    const relations = { player: { guardian: true, ageGroup: true }, term: true, team: { location: true } } as const;
    let enrolments = await this.enrolments.find({ where: { invoiceId: id }, relations });
    if (!enrolments.length) throw new BadRequestException('This invoice has no training fee to adjust.');
    const kids = new Set(enrolments.map((e) => e.playerId));

    // Start dates first — checked against each child's sessions before anything changes.
    for (const c of input.children) {
      if (!kids.has(c.playerId)) throw new BadRequestException('That child has no training fee on this invoice.');
      if (c.startDate === undefined) continue;
      const mine = enrolments.filter((e) => e.playerId === c.playerId);
      let start: string | null = null;
      if (c.startDate) {
        const pr = await this.proration.forPurchase(mine.map((e) => e.term), mine.find((e) => e.team)?.team ?? null, c.startDate);
        start = pr ? pr.startDate : null;
      }
      for (const e of mine) await this.enrolments.update(e.id, { startDate: start });
    }

    // Manual discounts: keep the ones already on the invoice unless this call changes them.
    const manual: Record<string, ManualDiscount> = {};
    for (const d of inv.discounts || []) {
      if (d.wasAutomatic || !d.playerId || !kids.has(d.playerId)) continue;
      const pct = /(\d+(?:\.\d+)?)\s*%/.exec(d.label || '');
      manual[d.playerId] = pct
        ? { percent: Number(pct[1]), label: d.label, reason: d.reason ?? null, rule: d.rule }
        : { amount: Number(d.amount), label: d.label, reason: d.reason ?? null, rule: d.rule };
    }
    for (const c of input.children) {
      if (c.discount === undefined) continue;
      if (c.discount === null) { delete manual[c.playerId]; continue; }
      const m = resolveManualDiscount(c.discount);
      if (!m) throw new BadRequestException('Choose a discount percentage.');
      manual[c.playerId] = m;
    }

    // Replace the training lines and their discounts; everything else stays.
    const termNames = new Set(enrolments.map((e) => e.term?.name).filter(Boolean) as string[]);
    const training = (inv.lineItems || []).filter((l) => l.stream === RevenueStream.ACADEMY && !l.productId && l.playerId && kids.has(l.playerId)
      && (l.package || [...termNames].some((t) => l.description.includes(t))));
    const others = (inv.lineItems || []).filter((l) => !training.includes(l));
    if (training.length) await this.lines.delete(training.map((l) => l.id));
    const childDiscounts = (inv.discounts || []).filter((d) => d.playerId && kids.has(d.playerId));
    if (childDiscounts.length) await this.applied.delete(childDiscounts.map((d) => d.id));

    enrolments = await this.enrolments.find({ where: { invoiceId: id }, relations });
    const t = await this.writeTrainingLines(id, inv.guardianId, enrolments, manual);

    // The other lines' VAT, recovered exactly from their net and rate.
    let otherNet = 0, otherVat = 0;
    for (const l of others) {
      const net = Number(l.lineTotal), rate = Number(l.vatRate);
      let incl = money(net * (1 + rate / 100));
      for (const tryIncl of [incl, money(incl - 0.01), money(incl + 0.01)]) if (splitIncl(tryIncl, rate).net === net) { incl = tryIncl; break; }
      otherNet += net; otherVat += money(incl - net);
    }
    const invoiceLevel = (inv.discounts || []).filter((d) => !d.playerId).reduce((a, d) => a + Number(d.amount), 0);
    const subtotal = money(t.subtotal + otherNet), vatTotal = money(t.vatTotal + otherVat);
    const stamp = new Date().toISOString().slice(0, 10).split('-').reverse().join('/');
    await this.invoices.update(id, {
      subtotal: subtotal.toFixed(2), vatTotal: vatTotal.toFixed(2),
      discountTotal: money(t.discountTotal + invoiceLevel).toFixed(2),
      total: money(subtotal + vatTotal).toFixed(2),
      notes: [inv.notes, `Adjusted ${stamp}: ${t.discountNotes.join('; ') || 'no discount'}`].filter(Boolean).join('\n').slice(-2000),
    });
    // An instalment plan keeps its percentages; the amounts follow the new total.
    const plan = await this.instalmentRows.find({ where: { invoiceId: id }, order: { seq: 'ASC' } });
    if (plan.length) {
      const amounts = amountsFor(money(subtotal + vatTotal), plan.map((r) => Number(r.percent)));
      for (const [k, r] of plan.entries()) await this.instalmentRows.update(r.id, { amount: amounts[k].toFixed(2) });
    }
    return { invoice: await this.findOne(id), appliedDiscounts: t.discountNotes, previousTotal: Number(inv.total) };
  }

  /**
   * Each child's training fee on an invoice, laid out like the old "Generate
   * Invoice" table: start date, terms, amount, sibling ("special") discount,
   * manual discount, net — and whether it can still be adjusted.
   */
  async trainingSummary(id: string) {
    const inv = await this.findOne(id);
    const enrolments = await this.enrolments.find({ where: { invoiceId: id }, relations: { player: true, term: true, team: true } });
    const paid = (inv.payments || []).some((p) => p.status === PaymentStatus.COMPLETED) || Number(inv.amountPaid) > 0;
    const editable = [InvoiceStatus.DRAFT, InvoiceStatus.ISSUED].includes(inv.status) && !paid && !Number(inv.writeOffAmount) && !inv.isSponsored;
    const why = editable ? null
      : paid ? 'A payment is already recorded on this invoice.'
      : ![InvoiceStatus.DRAFT, InvoiceStatus.ISSUED].includes(inv.status) ? 'Only draft or unpaid invoices can be adjusted.'
      : 'This invoice has a write-off or sponsorship.';
    // Oldest child first, like the family invoice and the sibling ladder.
    const kids = [...new Set(enrolments.slice().sort((a, b) => String(a.player.dateOfBirth).localeCompare(String(b.player.dateOfBirth))).map((e) => e.playerId))];
    const children: any[] = [];
    for (const pid of kids) {
      const mine = enrolments.filter((e) => e.playerId === pid).sort((a, b) => String(a.term?.startDate).localeCompare(String(b.term?.startDate)));
      const line = (inv.lineItems || []).find((l) => l.playerId === pid && l.stream === RevenueStream.ACADEMY && !l.productId);
      const disc = (inv.discounts || []).filter((d) => d.playerId === pid);
      const auto = disc.find((d) => d.wasAutomatic) ?? null;
      const man = disc.find((d) => !d.wasAutomatic) ?? null;
      const start = mine.map((e) => e.startDate).filter(Boolean).sort()[0] ?? null;
      let proration: Proration | null = null;
      try { proration = start ? await this.proration.forPurchase(mine.map((e) => e.term), mine.find((e) => e.team)?.team ?? null, start) : null; } catch { proration = null; }
      const pct = man ? /(\d+(?:\.\d+)?)\s*%/.exec(man.label || '') : null;
      children.push({
        playerId: pid, name: `${mine[0].player.firstName} ${mine[0].player.lastName}`, reference: mine[0].player.reference,
        team: mine.find((e) => e.team)?.team?.name ?? null,
        terms: mine.map((e) => e.term?.name).filter(Boolean),
        firstDay: mine[0].term?.startDate ?? null, lastDay: mine[mine.length - 1].term?.endDate ?? null,
        startDate: start, proration,
        amount: line ? Number(line.unitAmount) : null, net: line ? Number(line.lineTotal) : null,
        siblingDiscount: auto ? { label: auto.label, amount: Number(auto.amount) } : null,
        manualDiscount: man ? { label: man.label, amount: Number(man.amount), percent: pct ? Number(pct[1]) : null, reason: man.reason ?? null } : null,
      });
    }
    return { editable, why, children };
  }

  /** Preview what an invoice would cost — no records written. */
  async preview(enrolmentId: string) {
    const e = await this.enrolments.findOne({
      where: { id: enrolmentId },
      relations: { player: { ageGroup: true }, term: true, team: { location: true } },
    });
    if (!e) throw new BadRequestException('Invalid enrolmentId');
    const fee = await this.resolveFee(e.termId, e.player.ageGroupId ?? undefined, e.team?.locationId ?? undefined);
    if (!fee) return { error: 'No fee configured for this term' };
    const unit = Number(fee.amount);
    const candidates = await this.discountEngine.evaluate({
      playerId: e.playerId, baseAmount: unit, seasonId: e.seasonId,
    });
    // The preview must show what WILL happen, not the biggest thing that could.
    // Only automatic discounts apply on their own; the rest are suggestions.
    const best = candidates.find((c) => c.isAutomatic) ?? null;
    const net = money(unit - (best?.amount ?? 0));
    const vat = money(net * (Number(fee.vatRate) / 100));
    return {
      player: `${e.player.firstName} ${e.player.lastName}`,
      term: e.term?.name,
      listPrice: unit,
      candidates,
      appliedDiscount: best,
      netExclVat: net,
      vat,
      totalInclVat: money(net + vat),
    };
  }

  // ------------------------------------------------------------- lifecycle
  async issue(id: string) {
    const inv = await this.findOne(id);
    if (inv.status !== InvoiceStatus.DRAFT) throw new BadRequestException('Only draft invoices can be issued');
    await this.invoices.update(id, { status: InvoiceStatus.ISSUED, issueDate: new Date().toISOString().slice(0, 10) });
    return this.findOne(id);
  }

  /**
   * Recompute status from the payments ledger. The legacy system had 7
   * hand-set, overlapping statuses; here status is always derived.
   */
  async recomputeStatus(invoiceId: string) {
    const inv = await this.invoices.findOne({ where: { id: invoiceId }, relations: { payments: true } });
    if (!inv) throw new NotFoundException('Invoice not found');

    const completed = (inv.payments || []).filter((p) => p.status === PaymentStatus.COMPLETED);
    const paid = completed.filter((p) => p.direction === PaymentDirection.INBOUND)
      .reduce((s, p) => s + Number(p.amount), 0);
    const refunded = completed.filter((p) => p.direction === PaymentDirection.REFUND)
      .reduce((s, p) => s + Number(p.amount), 0);

    const net = money(paid - refunded);
    const total = Number(inv.total);
    const writeOff = Number(inv.writeOffAmount);

    let status: InvoiceStatus = inv.status;
    if (inv.isSponsored) status = InvoiceStatus.SPONSORED;
    else if (inv.status === InvoiceStatus.CANCELLED) status = InvoiceStatus.CANCELLED;
    else if (writeOff > 0 && net + writeOff >= total - SETTLEMENT_TOLERANCE) status = InvoiceStatus.WRITTEN_OFF;
    else if (refunded > 0 && net <= 0) status = InvoiceStatus.REFUNDED;
    else if (total > 0 && net >= total - SETTLEMENT_TOLERANCE) status = InvoiceStatus.PAID;
    else if (net > 0) status = InvoiceStatus.PART_PAID;
    else if (inv.status === InvoiceStatus.DRAFT) status = InvoiceStatus.DRAFT;
    else status = InvoiceStatus.ISSUED;

    await this.invoices.update(invoiceId, {
      amountPaid: money(paid).toFixed(2),
      amountRefunded: money(refunded).toFixed(2),
      status,
    });
    return this.findOne(invoiceId);
  }

  async writeOff(id: string, amount: number, reason: string) {
    const inv = await this.findOne(id);
    await this.invoices.update(id, {
      writeOffAmount: money(Number(inv.writeOffAmount) + amount).toFixed(2),
      writeOffReason: reason,
    });
    return this.recomputeStatus(id);
  }

  async markSponsored(id: string, sponsored: boolean) {
    await this.findOne(id);
    await this.invoices.update(id, { isSponsored: sponsored });
    return this.recomputeStatus(id);
  }

  async cancel(id: string) {
    const inv = await this.findOne(id);
    if (Number(inv.amountPaid) > 0) throw new BadRequestException('Cannot cancel an invoice with payments — refund first');
    await this.invoices.update(id, { status: InvoiceStatus.CANCELLED });
    return this.findOne(id);
  }

  // -------------------------------------------------------------- reporting
  /** Outstanding balances — the number the old dashboard got wrong. */
  async outstanding() {
    const rows = await this.invoices.createQueryBuilder('i')
      .leftJoinAndSelect('i.guardian', 'g')
      .where('i.status IN (:...st)', { st: [InvoiceStatus.ISSUED, InvoiceStatus.PART_PAID] })
      .orderBy('i.dueDate', 'ASC')
      .getMany();

    const now = new Date();
    const items = rows.map((i) => {
      const balance = money(Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount));
      const due = i.dueDate ? new Date(i.dueDate) : null;
      const daysOverdue = due ? Math.floor((now.getTime() - due.getTime()) / 86400000) : 0;
      return {
        id: i.id, number: i.number, guardian: i.guardian?.fullName, email: i.guardian?.email,
        total: Number(i.total), paid: Number(i.amountPaid), balance,
        dueDate: i.dueDate, daysOverdue: daysOverdue > 0 ? daysOverdue : 0,
        overdue: daysOverdue > 0, status: i.status,
      };
    }).filter((i) => i.balance > SETTLEMENT_TOLERANCE);

    return {
      count: items.length,
      totalOutstanding: money(items.reduce((s, i) => s + i.balance, 0)),
      overdueCount: items.filter((i) => i.overdue).length,
      totalOverdue: money(items.filter((i) => i.overdue).reduce((s, i) => s + i.balance, 0)),
      items,
    };
  }
}
