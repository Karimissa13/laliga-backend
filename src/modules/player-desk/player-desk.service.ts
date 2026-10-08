import { currentPurchase, summarisePurchases } from '../registration/purchases';
import { manualAmount, resolveManualDiscount } from '../finance/manual-discounts';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Not, Repository } from 'typeorm';
import {
  AgeGroup, Coach, Enrolment, EnrolmentStatus, Guardian, Invoice, InvoiceLineItem, InvoiceStatus,
  Player, PlayerComment, PlayerStatus, Season, Team, TeamLevel, Term, TermPackage, Wallet,
} from '../../database/entities';
import { PricingService } from '../finance/pricing.service';
import { ProrationService } from '../finance/proration.service';
import { InstalmentsService } from '../finance/instalments.service';
import { planProblem } from '../finance/instalments';
import { DomainEvents } from '../../common/domain-events';
import { PACKAGE_TERMS, defaultSessionsPerWeek, hoursPerSession, lineVat, splitIncl, tierAllowed } from '../finance/pricing';
import { PlayersService } from '../people/players.service';
import { EnrolmentService } from '../registration/enrolment.service';
import { InvoicesService } from '../finance/invoices.service';
import { DiscountEngine } from '../finance/discount-engine.service';
import { SiblingCreditResult, SiblingCreditService } from '../finance/sibling-credit.service';
import { PAYMENT_STATE_LABEL, isOverdue, paymentStateOf } from '../finance/payment-state';
import { levelExplainer, levelRank, slotLabel } from '../teams/team-label';
import { ordinal } from '../finance/sibling-ladder';

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Everything the player page does, in one place: the profile the left panel and
 * main view render, adding a term with its invoice, archiving, permanent removal,
 * the parent-account view, and coach assignment.
 *
 * It composes the people, registration, finance and team modules rather than
 * duplicating any of their rules: categories come from PlayersService, placement
 * checks from EnrolmentService, prices and the sibling ladder from finance.
 */
@Injectable()
export class PlayerDeskService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(Team) private readonly teams: Repository<Team>,
    @InjectRepository(Coach) private readonly coaches: Repository<Coach>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private readonly lines: Repository<InvoiceLineItem>,
    @InjectRepository(PlayerComment) private readonly comments: Repository<PlayerComment>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
    @InjectRepository(AgeGroup) private readonly ageGroups: Repository<AgeGroup>,
    private readonly playersSvc: PlayersService,
    private readonly enrol: EnrolmentService,
    private readonly invoicing: InvoicesService,
    private readonly discounts: DiscountEngine,
    private readonly siblingCredits: SiblingCreditService,
    private readonly pricing: PricingService,
    private readonly events: DomainEvents,
    private readonly proration: ProrationService,
    private readonly instalments: InstalmentsService,
  ) {}

  private teamView(t?: Team | null) {
    if (!t) return null;
    const coachName = (t as any).headCoach?.user?.fullName ?? null;
    return {
      id: t.id,
      name: t.name,
      level: t.level,
      levelExplainer: levelExplainer(t),
      levelRank: levelRank(t),
      ageCodes: t.ageCodes,
      schedule: slotLabel(t.trainingDays, t.startTime, t.endTime),
      location: (t as any).location?.name ?? null,
      capacity: t.capacity,
      coach: t.headCoachId ? { id: t.headCoachId, name: coachName } : null,
    };
  }

  // ------------------------------------------------------------------ profile

  async profile(id: string) {
    const player = await this.players.findOne({
      where: { id },
      relations: { guardian: true, ageGroup: true, currentTeam: { location: true, headCoach: { user: true } } },
    });
    if (!player) throw new NotFoundException('Player not found');

    const [wallet, siblings, history, comments, invoiceRows, placement, activeSeason] = await Promise.all([
      this.wallets.findOne({ where: { guardianId: player.guardianId } }),
      this.players.find({
        where: { guardianId: player.guardianId, id: Not(player.id) },
        relations: { ageGroup: true, currentTeam: true },
        order: { dateOfBirth: 'ASC' },
      }),
      this.enrolments.find({
        where: { playerId: id },
        relations: { term: true, season: true, team: true },
        order: { enrolledAt: 'DESC' },
      }),
      this.comments.find({ where: { playerId: id }, relations: { author: true }, order: { createdAt: 'DESC' } }),
      this.lines.createQueryBuilder('li')
        .innerJoinAndSelect('li.invoice', 'i')
        .where('li.playerId = :id', { id })
        .andWhere('i.status != :c', { c: InvoiceStatus.CANCELLED })
        .orderBy('i.createdAt', 'DESC')
        .getMany(),
      this.playersSvc.placeByDob(player.dateOfBirth),
      this.seasons.findOne({ where: { isActive: true } }),
    ]);
    const credits = await this.siblingCredits.listForPlayer(id);

    // One entry per invoice — a family invoice has a line for each child.
    const seen = new Set<string>();
    const invoices = invoiceRows.filter((l) => !seen.has(l.invoiceId) && seen.add(l.invoiceId)).map((l) => {
      const i = (l as any).invoice as Invoice;
      const balance = money(Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount));
      const state = paymentStateOf(i.status);
      return {
        id: i.id, number: i.number, status: i.status, issueDate: i.issueDate, dueDate: i.dueDate,
        total: Number(i.total), paid: Number(i.amountPaid), balance,
        line: { description: l.description, amount: Number(l.lineTotal) },
        payment: { state, label: PAYMENT_STATE_LABEL[state], overdue: isOverdue(i.status, i.dueDate) },
      };
    });
    const latest = invoices[0];

    const plan = activeSeason
      ? await this.discounts.siblingPlan({ guardianId: player.guardianId, seasonId: activeSeason.id })
      : null;
    const myRung = plan?.entries.find((e) => e.playerId === player.id) ?? null;

    const purchases = summarisePurchases(history as any);
    const current = currentPurchase(purchases);

    return {
      player: {
        id: player.id, reference: player.reference,
        firstName: player.firstName, lastName: player.lastName, name: `${player.firstName} ${player.lastName}`,
        dateOfBirth: player.dateOfBirth, gender: player.gender, status: player.status,
        level: player.level ?? player.currentTeam?.level ?? null,
        email: player.email, mobile: player.mobile, kitSize: player.kitSize,
        previousAcademy: player.previousAcademy,
        emergencyContactName: player.emergencyContactName, emergencyContactPhone: player.emergencyContactPhone,
        medicalNotes: player.medicalNotes,
        registeredAt: player.createdAt,
        archivedAt: player.archivedAt ?? null, archiveReason: player.archiveReason ?? null,
      },
      category: {
        code: player.ageGroup?.code ?? null,
        ageGroupId: player.ageGroupId ?? null,
        isOverride: player.ageGroupOverride,
        fromDob: placement.code,
        note: player.ageGroupOverride && placement.code !== player.ageGroup?.code
          ? `Set manually to ${player.ageGroup?.code ?? '—'} (date of birth gives ${placement.code ?? placement.exact})`
          : placement.note,
      },
      team: this.teamView(player.currentTeam),
      guardian: {
        id: player.guardian.id, reference: player.guardian.reference, fullName: player.guardian.fullName,
        relationship: player.guardian.relationship, email: player.guardian.email,
        secondaryEmail: player.guardian.secondaryEmail, secondaryEmailName: player.guardian.secondaryEmailName ?? null, mobile: player.guardian.mobile,
        emirate: player.guardian.emirate, city: player.guardian.city,
        wallet: { balance: Number(wallet?.balance ?? 0) },
      },
      siblings: siblings.map((s) => ({
        id: s.id, reference: s.reference, name: `${s.firstName} ${s.lastName}`,
        category: (s as any).ageGroup?.code ?? null, team: (s as any).currentTeam?.name ?? null,
        archived: !!s.archivedAt,
      })),
      siblingDiscount: myRung
        ? { position: ordinal(myRung.rank), percent: myRung.percent, reason: myRung.reason, overridden: plan!.isOverridden }
        : null,
      // The option bought ("Full season"), with the term in progress — not whichever enrolment sorts first.
      currentTerm: current
        ? { id: current.currentTerm?.id ?? null, name: current.label, package: current.package, terms: current.termsText,
            inProgress: current.currentTerm?.name ?? null, season: current.season, status: current.status,
            sessionsPerWeek: current.sessionsPerWeek }
        : null,
      purchases,
      payment: latest
        ? { ...latest.payment, invoiceNumber: latest.number, balance: latest.balance }
        : { state: paymentStateOf(null), label: PAYMENT_STATE_LABEL[paymentStateOf(null)], overdue: false, invoiceNumber: null, balance: null },
      history: history.map((e) => ({
        id: e.id, termId: e.termId, term: e.term?.name, season: e.season?.name, team: e.team?.name ?? null,
        status: e.status, enrolledAt: e.enrolledAt, invoiceId: e.invoiceId ?? null,
        package: e.package ?? null, sessionsPerWeek: e.sessionsPerWeek ?? null,
      })),
      invoices,
      siblingCredits: credits.map((c) => ({
        id: c.id, at: c.createdAt, percentBefore: c.percentBefore, percentAfter: c.percentAfter,
        total: Number(c.totalAmount), appliedToInvoice: Number(c.appliedToInvoice), reason: c.reason,
      })),
      comments: comments.map((c) => ({
        id: c.id, body: c.body, at: c.createdAt, author: c.author?.fullName ?? 'System',
      })),
    };
  }

  // -------------------------------------------------------- add term + invoice

  /** Which season a purchase belongs to: the term's, else the active one. */
  private async seasonFor(termId?: string) {
    if (termId) {
      const t = await this.terms.findOne({ where: { id: termId } });
      if (!t) throw new BadRequestException('Invalid termId');
      return { seasonId: t.seasonId, term: t };
    }
    const s = await this.seasons.findOne({ where: { isActive: true } });
    if (!s) throw new BadRequestException('No active season');
    return { seasonId: s.id, term: null as Term | null };
  }

  /**
   * Turn what the desk picked into a term option. A single termId is the old
   * way of asking and still works: it means that one term.
   */
  private async purchaseFor(input: { termId?: string; package?: TermPackage }) {
    const { seasonId, term } = await this.seasonFor(input.termId);
    const usePriceList = await this.pricing.hasPriceList(seasonId);
    if (!usePriceList) {
      if (!term) throw new BadRequestException('Choose a term');
      return { seasonId, usePriceList, pkg: null as TermPackage | null, terms: [term] };
    }
    const pkg = input.package ?? (term ? await this.pricing.packageFor(seasonId, [term.id]) : null);
    if (!pkg) throw new BadRequestException('Choose a term option');
    return { seasonId, usePriceList, pkg, terms: await this.pricing.packageTerms(seasonId, pkg) };
  }

  /**
   * One pricing rule for every quote: the price-list fee for the term option and
   * sessions a week, the sibling rung on that fee, VAT, and any optional extras
   * (kits, league) at their VAT-inclusive price. Extras are never discounted.
   */
  private async pricePurchase(ctx: {
    seasonId: string; pkg: TermPackage | null; usePriceList: boolean; terms: Term[];
    team: Team | null; ageCode: string | null; ageGroupId?: string | null; sessionsPerWeek?: number; level?: TeamLevel | null;
    rung?: { rank: number; percent: number; reason: string } | null; productIds?: string[];
    manualPreset?: string; manualPercent?: number; startDate?: string | null;
  }) {
    let base: { list: number; incl: number | null; vatRate: number; label: string; spw: number | null; hours: number | null; category: string | null };
    if (ctx.usePriceList && ctx.pkg) {
      const spw = ctx.sessionsPerWeek ?? defaultSessionsPerWeek(ctx.team);
      const level = ctx.team?.level ?? ctx.level ?? null;
      if (!tierAllowed(level, spw)) {
        return { ok: false as const, reason: `${spw} session${spw === 1 ? '' : 's'} a week isn't offered at ${level === 'HPC' ? 'HPC' : level === 'ADVANCED' ? 'Advanced' : 'Development'} level.` };
      }
      const r = await this.pricing.resolve({
        seasonId: ctx.seasonId, package: ctx.pkg, sessionsPerWeek: spw, category: ctx.ageCode, girlsOnly: ctx.team?.girlsOnly,
      });
      if (!r.ok) return { ok: false as const, reason: r.reason };
      base = { list: r.net, incl: r.inclVat, vatRate: r.vatRate, label: r.packageLabel, spw, hours: r.hoursPerSession, category: r.category };
    } else {
      const fee = await this.invoicing.resolveFee(ctx.terms[0].id, ctx.ageGroupId ?? undefined, ctx.team?.locationId ?? undefined);
      if (!fee) return { ok: false as const, reason: `No fee is configured for ${ctx.terms[0].name}${ctx.ageCode ? ' / ' + ctx.ageCode : ''}.` };
      base = { list: Number(fee.amount), incl: null, vatRate: Number(fee.vatRate), label: ctx.terms[0].name, spw: null, hours: null, category: ctx.ageCode };
    }
    // A start date after the first day prorates the training fee by sessions left.
    const full = { list: base.list, incl: base.incl };
    const proration = await this.proration.forPurchase(ctx.terms, ctx.team, ctx.startDate);
    if (proration) {
      // Prorate the VAT-inclusive price and take the net from it, so net + VAT = the prorated price exactly.
      const incl = base.incl != null ? money(base.incl * proration.ratio) : null;
      base = { ...base, incl, list: incl != null ? splitIncl(incl, base.vatRate).net : money(base.list * proration.ratio) };
    }
    // A manual discount replaces the sibling rung; either comes off the training fee only.
    // On the full-price child there is no sibling rung, so it is simply an extra discount.
    const manual = resolveManualDiscount(ctx.manualPercent ? { percent: ctx.manualPercent } : ctx.manualPreset ? { preset: ctx.manualPreset } : null);
    const rung = manual ? null : ctx.rung;
    const discount = manual ? manualAmount(manual, base.list) : rung && rung.percent > 0 ? money(base.list * (rung.percent / 100)) : 0;
    const net = money(base.list - discount);
    const vat = lineVat(net, base.vatRate, base.incl, discount > 0);
    const products = await this.pricing.productsByIds(ctx.productIds ?? []);
    const extras = products.map((p) => {
      const sp = splitIncl(Number(p.priceInclVat), Number(p.vatRate));
      return { id: p.id, code: p.code, name: p.name, description: p.description ?? null, inclVat: Number(p.priceInclVat), net: sp.net, vat: sp.vat };
    });
    const extrasTotal = money(extras.reduce((t, x) => t + x.inclVat, 0));
    const total = money(net + vat);
    return {
      ok: true as const,
      package: ctx.pkg, packageLabel: base.label,
      term: { id: ctx.terms[0].id, name: base.label },
      terms: ctx.terms.map((t) => ({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate, weeks: t.weeks })),
      sessionsPerWeek: base.spw, hoursPerSession: base.hours, category: base.category,
      listPriceInclVat: base.incl, listPrice: base.list,
      proration: proration ? { ...proration, fullPriceInclVat: full.incl, fullPrice: full.list } : null,
      siblingDiscount: rung && rung.percent > 0
        ? { position: ordinal(rung.rank), percent: rung.percent, amount: discount, reason: rung.reason }
        : null,
      manualDiscount: manual ? { percent: manual.percent ?? null, label: manual.label, amount: discount, extra: !(ctx.rung && ctx.rung.percent > 0) } : null,
      netExclVat: net, vatRate: base.vatRate, vat, total,
      extras, extrasTotal, grandTotal: money(total + extrasTotal),
    };
  }

  /** An instalment plan sent with a purchase is checked before anything is written. */
  private checkPlan(items?: Array<{ percent: number; dueDate: string }>) {
    if (!items?.length) return;
    const problem = planProblem(items);
    if (problem) throw new BadRequestException(problem);
  }

  /** A start date that changes the price, or null (on/before the first day = full price). Throws if it can't be used. */
  private async checkStart(terms: Term[], teamId: string | undefined, startDate?: string | null): Promise<string | null> {
    if (!startDate) return null;
    const team = teamId ? await this.teams.findOne({ where: { id: teamId } }) : null;
    const pr = await this.proration.forPurchase(terms, team, startDate);
    return pr ? pr.startDate : null;
  }

  /** What adding this term option would cost, before anything is written. */
  async quote(playerId: string, q: { termId?: string; package?: TermPackage; teamId?: string; sessionsPerWeek?: number; productIds?: string[]; manualPreset?: string; manualPercent?: number; startDate?: string }) {
    const player = await this.players.findOne({ where: { id: playerId }, relations: { ageGroup: true, currentTeam: true } });
    if (!player) throw new NotFoundException('Player not found');
    const purchase = await this.purchaseFor(q);
    const team = q.teamId ? await this.teams.findOne({ where: { id: q.teamId } }) : player.currentTeam ?? null;

    const plan = await this.discounts.siblingPlan({
      guardianId: player.guardianId, seasonId: purchase.seasonId, assumeEnrolled: [player.id],
    });
    const priced = await this.pricePurchase({
      ...purchase, team, ageCode: player.ageGroup?.code ?? null, ageGroupId: player.ageGroupId, level: player.level ?? null,
      sessionsPerWeek: q.sessionsPerWeek, rung: plan.entries.find((e) => e.playerId === player.id), productIds: q.productIds, manualPreset: q.manualPreset,
      manualPercent: q.manualPercent, startDate: q.startDate,
    });
    if (!priced.ok) return priced;

    const alreadyIn = await this.enrolments.find({
      where: { playerId, termId: In(purchase.terms.map((t) => t.id)), status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]) },
      relations: { term: true },
    });

    let categoryWarning: string | null = null;
    if (team && team.ageCodes?.length && player.ageGroup && !team.ageCodes.includes(player.ageGroup.code)) {
      categoryWarning = `${team.name} takes ${team.ageCodes.join(' / ')}; this child is ${player.ageGroup.code}.`;
    }

    return {
      ...priced,
      ok: !alreadyIn.length,
      reason: alreadyIn.length ? `Already enrolled in ${alreadyIn.map((e) => e.term?.name).join(' and ')}.` : null,
      team: team ? { id: team.id, name: team.name, schedule: slotLabel(team.trainingDays, team.startTime, team.endTime) } : null,
      categoryWarning,
    };
  }

  /**
   * Price a child who is being registered and doesn't exist yet. The sibling
   * engine ranks them with the family by date of birth, so the parent hears the
   * real figure before anything is saved.
   */
  async quoteNew(q: {
    guardianId?: string; ageGroupId?: string; dob: string; termId?: string; package?: TermPackage; teamId?: string;
    sessionsPerWeek?: number; productIds?: string[]; firstName?: string; lastName?: string; manualPreset?: string; manualPercent?: number; startDate?: string;
  }) {
    const purchase = await this.purchaseFor(q);
    const team = q.teamId ? await this.teams.findOne({ where: { id: q.teamId } }) : null;
    const ag = q.ageGroupId ? await this.ageGroups.findOne({ where: { id: q.ageGroupId } }) : null;
    const code = ag?.code ?? (await this.playersSvc.placeByDob(q.dob)).code ?? null;
    const NEW = '__new__';
    const plan = await this.discounts.siblingPlan({
      guardianId: q.guardianId, seasonId: purchase.seasonId,
      phantoms: [{ id: NEW, firstName: q.firstName ?? 'New', lastName: q.lastName ?? 'child', dateOfBirth: q.dob }],
    });
    const priced = await this.pricePurchase({
      ...purchase, team, ageCode: code, ageGroupId: ag?.id ?? null, sessionsPerWeek: q.sessionsPerWeek,
      rung: plan.entries.find((e) => e.playerId === NEW), productIds: q.productIds, manualPreset: q.manualPreset,
      manualPercent: q.manualPercent, startDate: q.startDate,
    });
    if (!priced.ok) return priced;
    return {
      ...priced, reason: null,
      team: team ? { id: team.id, name: team.name, schedule: slotLabel(team.trainingDays, team.startTime, team.endTime) } : null,
    };
  }

  /**
   * What the registration screen offers for a child: the six term options with
   * their dates, the sessions-a-week tiers the price list has for the category,
   * and the optional extras for the level.
   */
  async registrationOptions(q: { ageGroupId?: string; teamId?: string; level?: TeamLevel }) {
    const season = await this.seasons.findOne({ where: { isActive: true } });
    if (!season) throw new BadRequestException('No active season');
    const team = q.teamId ? await this.teams.findOne({ where: { id: q.teamId } }) : null;
    const ag = q.ageGroupId ? await this.ageGroups.findOne({ where: { id: q.ageGroupId } }) : null;
    const level = team?.level ?? q.level ?? null;
    const [list, terms, products] = await Promise.all([
      this.pricing.priceList(season.id),
      this.pricing.seasonTerms(season.id),
      this.pricing.productsForRegistration(level),
    ]);
    const today = new Date().toISOString().slice(0, 10);
    const category = team?.girlsOnly ? 'GIRLS' : ag?.code ?? null;
    const tiers = list.tiers
      .filter((t) => !category || t.rows.some((r) => r.category === category && r.isActive))
      .filter((t) => tierAllowed(level, t.sessionsPerWeek))
      .map((t) => ({ sessionsPerWeek: t.sessionsPerWeek, hoursPerSession: ag ? hoursPerSession(ag.code) : null }));
    const firstOpen = terms.findIndex((t) => (t.endDate ?? '') >= today);
    const defaultPackage = ([TermPackage.T1, TermPackage.T2, TermPackage.T3] as TermPackage[])[firstOpen] ?? TermPackage.T1;
    return {
      season: { id: season.id, name: season.name },
      usePriceList: list.tiers.length > 0,
      packages: list.packages.map((p) => {
        const covered = PACKAGE_TERMS[p.code].map((i) => terms[i]).filter(Boolean);
        return {
          ...p,
          startDate: covered[0]?.startDate ?? null, endDate: covered[covered.length - 1]?.endDate ?? null,
          started: !!covered[0]?.startDate && covered[0].startDate! <= today,
          finished: !!covered[covered.length - 1]?.endDate && covered[covered.length - 1].endDate! < today,
        };
      }),
      defaultPackage,
      tiers,
      defaultSessionsPerWeek: team ? defaultSessionsPerWeek(team) : (level && level !== TeamLevel.DEVELOPMENT ? 3 : 2),
      products: products.map((p) => ({ id: p.id, code: p.code, name: p.name, description: p.description, priceInclVat: Number(p.priceInclVat), stream: p.stream })),
    };
  }

  /** Enrol into a term option and raise its invoice in one step — the most common desk task. */
  async addTerm(playerId: string, input: {
    termId?: string; package?: TermPackage; teamId?: string; sessionsPerWeek?: number; productIds?: string[];
    allowCategoryOverride?: boolean;
    manualDiscount?: { preset?: string; percent?: number; amount?: number; label?: string; reason?: string };
    issue?: boolean; dueInDays?: number; startDate?: string; instalments?: Array<{ percent: number; dueDate: string }>;
  }, actorId?: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    this.checkPlan(input.instalments);
    if (!player) throw new NotFoundException('Player not found');
    if (player.archivedAt) throw new BadRequestException('This child is archived — restore them before adding a term.');
    const purchase = await this.purchaseFor(input);

    // Check every term first, so a Full-season purchase never half-happens.
    const clash = await this.enrolments.find({
      where: { playerId, termId: In(purchase.terms.map((t) => t.id)), status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]) },
      relations: { term: true },
    });
    if (clash.length) throw new BadRequestException(`Already enrolled in ${clash.map((e) => e.term?.name).join(' and ')}.`);

    const teamId = input.teamId ?? player.currentTeamId ?? undefined;
    // Check the start date before anything is written.
    const startDate = await this.checkStart(purchase.terms, teamId, input.startDate);
    const enrolmentIds: string[] = [];
    let waitlisted = false;
    for (const t of purchase.terms) {
      const r = await this.enrol.enrol({ playerId, termId: t.id, teamId, allowCategoryOverride: input.allowCategoryOverride });
      enrolmentIds.push(r.enrolment.id);
      waitlisted = waitlisted || r.waitlisted;
      const patch: Partial<Enrolment> = {};
      if (input.sessionsPerWeek) patch.sessionsPerWeek = input.sessionsPerWeek;
      if (startDate) patch.startDate = startDate;
      if (Object.keys(patch).length) await this.enrolments.update(r.enrolment.id, patch);
    }

    const { invoice, appliedDiscounts } = await this.invoicing.generateForEnrolments({
      enrolmentIds,
      dueInDays: input.dueInDays,
      manualDiscounts: resolveManualDiscount(input.manualDiscount) ? { [playerId]: resolveManualDiscount(input.manualDiscount)! } : undefined,
      extras: (input.productIds ?? []).map((productId) => ({ playerId, productId })),
    });
    if (invoice && input.instalments?.length) await this.instalments.setPlan(invoice.id, input.instalments);
    // Issuing is what can re-rank siblings (an older child joining moves the
    // younger ones down the ladder), so credits are worked out at that moment.
    let siblingCredits: SiblingCreditResult[] = [];
    if (input.issue !== false && invoice) {
      await this.invoicing.issue(invoice.id);
      siblingCredits = await this.siblingCredits.reconcileForInvoice(invoice.id, actorId);
      // After the credits, so the emailed PDF shows any credit already applied.
      await this.events.emit({ type: 'invoice.issued', invoiceId: invoice.id, actorId });
    }

    return {
      id: playerId,
      enrolmentId: enrolmentIds[0],
      enrolmentIds,
      package: purchase.pkg,
      waitlisted,
      invoice: invoice ? await this.invoicing.findOne(invoice.id) : null,
      appliedDiscounts,
      siblingCredits,
    };
  }

  /**
   * Siblings registered together: every child's term option on ONE family
   * invoice, with the sibling ladder applied across the family (oldest first)
   * and any manual discount replacing it for that child only.
   */
  async addFamilyTerms(guardianId: string, input: {
    items: Array<{ playerId: string; termId?: string; package?: TermPackage; teamId?: string; sessionsPerWeek?: number; productIds?: string[];
      allowCategoryOverride?: boolean; manualDiscount?: { preset?: string; percent?: number; amount?: number; label?: string; reason?: string };
      startDate?: string }>;
    issue?: boolean; dueInDays?: number; instalments?: Array<{ percent: number; dueDate: string }>;
  }, actorId?: string) {
    this.checkPlan(input.instalments);
    const ids = input.items.map((i) => i.playerId);
    if (new Set(ids).size !== ids.length) throw new BadRequestException('Each child can appear once');
    const players = await this.players.find({ where: { id: In(ids) } });
    if (players.length !== ids.length) throw new NotFoundException('Player not found');
    if (players.some((p) => p.guardianId !== guardianId)) throw new BadRequestException('Every child must belong to this parent');
    const archived = players.find((p) => p.archivedAt);
    if (archived) throw new BadRequestException(`${archived.firstName} is archived — restore them first.`);

    // Work out every purchase and check every clash before enrolling anyone.
    const plans: Array<{ item: (typeof input.items)[number]; player: Player; terms: Term[]; startDate: string | null }> = [];
    for (const item of input.items) {
      const player = players.find((p) => p.id === item.playerId)!;
      const purchase = await this.purchaseFor(item);
      const clash = await this.enrolments.find({
        where: { playerId: player.id, termId: In(purchase.terms.map((t) => t.id)), status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]) },
        relations: { term: true },
      });
      if (clash.length) throw new BadRequestException(`${player.firstName} is already enrolled in ${clash.map((e) => e.term?.name).join(' and ')}.`);
      let startDate: string | null = null;
      try { startDate = await this.checkStart(purchase.terms, item.teamId ?? player.currentTeamId ?? undefined, item.startDate); }
      catch (e: any) { throw new BadRequestException(`${player.firstName}: ${e?.message ?? 'check the start date'}`); }
      plans.push({ item, player, terms: purchase.terms, startDate });
    }

    const enrolmentIds: string[] = [];
    const waitlisted: string[] = [];
    for (const { item, player, terms, startDate } of plans) {
      const teamId = item.teamId ?? player.currentTeamId ?? undefined;
      for (const t of terms) {
        const r = await this.enrol.enrol({ playerId: player.id, termId: t.id, teamId, allowCategoryOverride: item.allowCategoryOverride });
        enrolmentIds.push(r.enrolment.id);
        if (r.waitlisted && !waitlisted.includes(player.id)) waitlisted.push(player.id);
        const patch: Partial<Enrolment> = {};
        if (item.sessionsPerWeek) patch.sessionsPerWeek = item.sessionsPerWeek;
        if (startDate) patch.startDate = startDate;
        if (Object.keys(patch).length) await this.enrolments.update(r.enrolment.id, patch);
      }
    }
    const manualDiscounts: Record<string, any> = {};
    for (const { item } of plans) { const m = resolveManualDiscount(item.manualDiscount); if (m) manualDiscounts[item.playerId] = m; }
    const { invoice, appliedDiscounts } = await this.invoicing.generateForEnrolments({
      enrolmentIds, dueInDays: input.dueInDays,
      manualDiscounts: Object.keys(manualDiscounts).length ? manualDiscounts : undefined,
      extras: plans.flatMap(({ item }) => (item.productIds ?? []).map((productId) => ({ playerId: item.playerId, productId }))),
    });
    if (invoice && input.instalments?.length) await this.instalments.setPlan(invoice.id, input.instalments);
    let siblingCredits: SiblingCreditResult[] = [];
    if (input.issue !== false && invoice) {
      await this.invoicing.issue(invoice.id);
      siblingCredits = await this.siblingCredits.reconcileForInvoice(invoice.id, actorId);
      await this.events.emit({ type: 'invoice.issued', invoiceId: invoice.id, actorId });
    }
    return {
      guardianId, enrolmentIds, waitlisted,
      invoice: invoice ? await this.invoicing.findOne(invoice.id) : null,
      appliedDiscounts, siblingCredits,
    };
  }

  /** Price siblings being registered together, before anything is saved — the sibling ladder across all of them. */
  async quoteFamily(q: { guardianId?: string; children: Array<{ key: string; playerId?: string; dob?: string; firstName?: string; lastName?: string;
    ageGroupId?: string; package?: TermPackage; sessionsPerWeek?: number; teamId?: string; productIds?: string[]; manualPreset?: string;
    manualPercent?: number; startDate?: string }> }) {
    const existing = q.children.filter((c) => c.playerId);
    const onFile = existing.length ? await this.players.find({ where: { id: In(existing.map((c) => c.playerId!)) }, relations: { ageGroup: true } }) : [];
    const season = await this.seasons.findOne({ where: { isActive: true } });
    const plan = await this.discounts.siblingPlan({
      guardianId: q.guardianId, seasonId: season?.id,
      assumeEnrolled: onFile.map((p) => p.id),
      phantoms: q.children.filter((c) => !c.playerId && c.dob).map((c) => ({ id: `new:${c.key}`, firstName: c.firstName ?? 'New', lastName: c.lastName ?? 'child', dateOfBirth: c.dob! })),
    });
    const out: any[] = [];
    for (const c of q.children) {
      const pl = c.playerId ? onFile.find((p) => p.id === c.playerId) : null;
      const rungId = pl ? pl.id : `new:${c.key}`;
      const rung = plan.entries.find((e) => e.playerId === rungId) ?? null;
      const base = { key: c.key, name: pl ? `${pl.firstName} ${pl.lastName}` : `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim(),
        position: rung ? ordinal(rung.rank) : null, siblingPercent: rung?.percent ?? 0 };
      if (!c.package) { out.push({ ...base, ok: false, reason: 'Choose a term option' }); continue; }
      try {
        const purchase = await this.purchaseFor(c);
        const team = c.teamId ? await this.teams.findOne({ where: { id: c.teamId } }) : null;
        const ag = c.ageGroupId ? await this.ageGroups.findOne({ where: { id: c.ageGroupId } }) : null;
        const code = ag?.code ?? pl?.ageGroup?.code ?? (c.dob ? (await this.playersSvc.placeByDob(c.dob)).code : null) ?? null;
        const priced = await this.pricePurchase({
          ...purchase, team, ageCode: code, ageGroupId: ag?.id ?? pl?.ageGroupId ?? null, sessionsPerWeek: c.sessionsPerWeek,
          rung, productIds: c.productIds, manualPreset: c.manualPreset, manualPercent: c.manualPercent, startDate: c.startDate,
        });
        out.push({ ...base, ...priced });
      } catch (e: any) { out.push({ ...base, ok: false, reason: e?.message ?? 'Cannot price' }); }
    }
    const ok = out.filter((x) => x.ok);
    const sum = (f: (x: any) => number) => Math.round(ok.reduce((t, x) => t + f(x), 0) * 100) / 100;
    return {
      ok: ok.length === out.length,
      children: out,
      total: sum((x) => x.grandTotal ?? x.total),
      siblingSavings: sum((x) => x.siblingDiscount?.amount ?? 0),
      manualSavings: sum((x) => x.manualDiscount?.amount ?? 0),
      prorationSavings: sum((x) => (x.proration ? (x.proration.fullPriceInclVat ?? x.proration.fullPrice) - (x.listPriceInclVat ?? x.listPrice) : 0)),
      ladder: plan.entries.map((e) => ({ id: e.playerId, rank: e.rank, percent: e.percent, reason: e.reason })),
    };
  }

  /**
   * "User term": add kits, a league, a tournament or a custom charge to a child
   * who is already registered. Raises its own invoice; term fees are untouched.
   */
  async addItems(playerId: string, input: {
    items: Array<{ productId?: string; quantity?: number; description?: string; amountInclVat?: number; stream?: any }>;
    issue?: boolean; dueInDays?: number; notes?: string;
  }, actorId?: string) {
    const player = await this.players.findOne({ where: { id: playerId } });
    if (!player) throw new NotFoundException('Player not found');
    if (player.archivedAt) throw new BadRequestException('This child is archived — restore them first.');
    const invoice = await this.invoicing.generateAdditional({
      guardianId: player.guardianId,
      items: input.items.map((i) => ({ ...i, playerId })),
      dueInDays: input.dueInDays, notes: input.notes,
    });
    if (input.issue !== false) {
      await this.invoicing.issue(invoice.id);
      await this.events.emit({ type: 'invoice.issued', invoiceId: invoice.id, actorId });
    }
    const what = invoice.lineItems.map((l) => l.description.replace(/^.*? — /, '')).join(', ');
    await this.comments.save(this.comments.create({
      playerId, authorId: actorId, body: `Added: ${what} — invoice ${invoice.number}, ${'AED ' + Number(invoice.total).toFixed(2)}.`,
    }));
    return { id: playerId, invoice: await this.invoicing.findOne(invoice.id) };
  }

  // ---------------------------------------------------------------- archive

  /**
   * "Delete" at the desk archives: the child disappears from lists and can't be
   * invoiced, but every invoice, payment and attendance record stays intact.
   */
  async archive(id: string, reason: string, actorId?: string) {
    const p = await this.players.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Player not found');
    if (p.archivedAt) throw new BadRequestException('Already archived');
    await this.players.update(id, {
      archivedAt: new Date(), archiveReason: reason, status: PlayerStatus.WITHDRAWN, currentTeamId: null as any,
    });
    // Free their place: future enrolments that were never invoiced are cancelled.
    await this.enrolments.update(
      { playerId: id, invoiceId: IsNull(), status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]) },
      { status: EnrolmentStatus.CANCELLED },
    );
    await this.playersSvc.addComment(id, `Archived: ${reason}`, actorId);
    return { id, archived: true };
  }

  /**
   * Restore an archived child. Archiving freed their team place, so restoring
   * tries to give it back: they return to the team of their latest live
   * enrolment if a place is still free. If the team filled up meanwhile they are
   * restored unplaced, and the response says so instead of silently overfilling.
   */
  async restore(id: string, reason?: string, actorId?: string) {
    const p = await this.players.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Player not found');
    if (!p.archivedAt) throw new BadRequestException('Not archived');

    const live = await this.enrolments.findOne({
      where: { playerId: id, status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]) },
      relations: { team: true },
      order: { enrolledAt: 'DESC' },
    });

    let team: Team | null = live?.team ?? null;
    let note: string | null = null;
    if (team) {
      const taken = await this.players.count({ where: { currentTeamId: team.id, archivedAt: IsNull() } });
      if (taken >= team.capacity) {
        note = `${team.name} is full (${taken}/${team.capacity}) — restored without a team; place them from the player page.`;
        team = null;
      }
    }

    await this.players.update(id, {
      archivedAt: null as any, archiveReason: null as any,
      currentTeamId: (team?.id ?? null) as any,
      status: live && team ? PlayerStatus.ACTIVE : PlayerStatus.REGISTERED,
    });
    await this.playersSvc.addComment(id, `Restored${reason ? ': ' + reason : ''}${note ? ' — ' + note : ''}`, actorId);
    return { id, archived: false, team: team?.name ?? null, note };
  }

  /**
   * Permanent removal — only for a record created by mistake. Refused the moment
   * the child has any financial, attendance or development history, because
   * deleting that would break invoices and VAT records.
   */
  async deletePermanently(id: string) {
    const p = await this.players.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Player not found');

    const count = async (sql: string) => Number((await this.ds.query(sql, [id]))[0].n);
    const blockers: string[] = [];
    if (await count(`SELECT count(*)::int n FROM invoice_line_items WHERE "playerId" = $1`)) blockers.push('invoices');
    if (await count(`SELECT count(*)::int n FROM applied_discounts WHERE "playerId" = $1`)) blockers.push('discounts');
    if (await count(`SELECT count(*)::int n FROM attendances WHERE "playerId" = $1`)) blockers.push('attendance');
    if (await count(`SELECT count(*)::int n FROM evaluations WHERE "playerId" = $1`)) blockers.push('evaluations');
    if (await count(`SELECT count(*)::int n FROM documents WHERE "playerId" = $1`)) blockers.push('documents');
    if (await count(`SELECT count(*)::int n FROM enrolments WHERE "playerId" = $1 AND "invoiceId" IS NOT NULL`)) blockers.push('invoiced enrolments');
    if (blockers.length) {
      throw new BadRequestException({
        error: 'HasHistory',
        message: `This child has ${blockers.join(', ')} on record, so they can't be deleted permanently. Archive them instead — nothing is lost and they can be restored.`,
        blockers,
      });
    }

    await this.ds.transaction(async (m) => {
      await m.query(`DELETE FROM enrolments WHERE "playerId" = $1`, [id]);
      await m.query(`DELETE FROM player_comments WHERE "playerId" = $1`, [id]);
      await m.query(`UPDATE leads SET "playerId" = NULL WHERE "playerId" = $1`, [id]).catch(() => undefined);
      await m.query(`DELETE FROM players WHERE id = $1`, [id]);
    });
    return { id, deleted: true, reference: p.reference };
  }

  // ----------------------------------------------------------- account view

  /**
   * "Account switch": what the parent sees in their account. Read-only by design —
   * the legacy system let an admin sign in AS the parent with no record of it.
   * Here access needs a stated reason and is written to the activity log.
   */
  async accountView(guardianId: string) {
    const g = await this.guardians.findOne({ where: { id: guardianId } });
    if (!g) throw new NotFoundException('Guardian not found');
    const [wallet, children, invs] = await Promise.all([
      this.wallets.findOne({ where: { guardianId } }),
      this.players.find({
        where: { guardianId, archivedAt: IsNull() },
        relations: { ageGroup: true, currentTeam: { location: true, headCoach: { user: true } } },
        order: { dateOfBirth: 'ASC' },
      }),
      this.invoices.find({
        where: { guardianId, status: Not(In([InvoiceStatus.CANCELLED, InvoiceStatus.DRAFT])) },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const outstanding = invs.reduce((s, i) =>
      s + Math.max(0, Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount)), 0);
    return {
      id: g.id,
      viewingAs: { name: g.fullName, reference: g.reference, email: g.email, mobile: g.mobile },
      readOnly: true,
      children: children.map((c) => ({
        name: `${c.firstName} ${c.lastName}`, reference: c.reference, category: (c as any).ageGroup?.code ?? null,
        team: this.teamView(c.currentTeam),
      })),
      invoices: invs.map((i) => {
        const state = paymentStateOf(i.status);
        return {
          number: i.number, issueDate: i.issueDate, dueDate: i.dueDate, total: Number(i.total),
          balance: money(Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount)),
          status: PAYMENT_STATE_LABEL[state] + (isOverdue(i.status, i.dueDate) ? ' · overdue' : ''),
        };
      }),
      outstanding: money(outstanding),
      walletBalance: Number(wallet?.balance ?? 0),
    };
  }

  // ------------------------------------------------------- coach assignment

  /** The coach belongs to the team, so this changes it for every child on that team. */
  async assignTeamCoach(teamId: string, coachId: string | null) {
    const team = await this.teams.findOne({ where: { id: teamId } });
    if (!team) throw new NotFoundException('Team not found');
    if (coachId && !(await this.coaches.findOne({ where: { id: coachId } }))) {
      throw new BadRequestException('Invalid coachId');
    }
    await this.teams.update(teamId, { headCoachId: coachId as any });
    // The team's upcoming sessions follow the new coach (past registers keep who ran them).
    await this.teams.manager.query(
      `UPDATE sessions SET "coachId" = $2 WHERE "teamId" = $1 AND "startsAt" > now() AND type = 'TRAINING'`, [teamId, coachId]);
    const roster = await this.players.count({ where: { currentTeamId: teamId, archivedAt: IsNull() } });
    return { id: teamId, team: team.name, coachId, affectedPlayers: roster };
  }

  // ------------------------------------------------------ registration helpers

  async placement(dob: string) {
    const r = await this.playersSvc.placeByDob(dob);
    return { code: r.code, exact: r.exact, playedUp: r.playedUp, note: r.note, ageGroupId: r.ageGroup?.id ?? null };
  }

  /** Teams that take this category, best level first, with places left. */
  async eligibleTeams(q: { ageGroupId?: string; level?: TeamLevel; seasonId?: string }) {
    const season = q.seasonId
      ? await this.seasons.findOne({ where: { id: q.seasonId } })
      : await this.seasons.findOne({ where: { isActive: true } });
    const ag = q.ageGroupId ? await this.ageGroups.findOne({ where: { id: q.ageGroupId } }) : null;
    const all = await this.teams.find({
      where: { isActive: true, ...(season ? { seasonId: season.id } : {}), ...(q.level ? { level: q.level } : {}) },
      relations: { location: true, headCoach: { user: true } },
    });
    const fits = all.filter((t) => !ag || !t.ageCodes?.length || t.ageCodes.includes(ag.code));
    const counts: Array<{ teamId: string; n: number }> = fits.length
      ? await this.ds.query(
          `SELECT "currentTeamId" AS "teamId", count(*)::int n FROM players
           WHERE "currentTeamId" = ANY($1) AND "archivedAt" IS NULL GROUP BY "currentTeamId"`,
          [fits.map((t) => t.id)])
      : [];
    const byTeam = new Map(counts.map((c) => [c.teamId, c.n]));
    return fits
      .map((t) => {
        const n = byTeam.get(t.id) ?? 0;
        return { ...this.teamView(t)!, enrolled: n, placesLeft: Math.max(0, t.capacity - n), isFull: n >= t.capacity };
      })
      .sort((a, b) => a.levelRank - b.levelRank || a.name.localeCompare(b.name));
  }

  /** Find an existing parent before creating one — duplicates were rife in the legacy data. */
  async guardianLookup(q: string) {
    const text = q.trim();
    const digits = text.replace(/\D/g, '').replace(/^(971|0)/, '');
    const params: any[] = [`%${text}%`];
    const ors = [`g.email ILIKE $1`, `g."fullName" ILIKE $1`, `g.reference ILIKE $1`];
    if (digits.length >= 4) { params.push(`%${digits}%`); ors.push(`regexp_replace(g.mobile, '\\D', '', 'g') LIKE $2`); }
    const rows = await this.ds.query(
      `SELECT g.id, g.reference, g."fullName", g.email, g.mobile,
              (SELECT count(*)::int FROM players p WHERE p."guardianId" = g.id AND p."archivedAt" IS NULL) AS children
       FROM guardians g WHERE ${ors.join(' OR ')} ORDER BY g."createdAt" DESC LIMIT 8`, params);
    return rows;
  }
}
