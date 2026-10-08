import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Discount, DiscountKind, DiscountRule, Enrolment, EnrolmentStatus, Guardian, Player,
} from '../../database/entities';
import {
  DEFAULT_SIBLING_LADDER, SiblingLadder, ladderFromParams, ladderPercent, ordinal,
} from './sibling-ladder';

export interface DiscountCandidate {
  discountId?: string;
  label: string;
  rule: DiscountRule;
  kind: DiscountKind;
  value: number;      // percentage, or fixed amount, as configured
  amount: number;     // resolved money amount against the base
  reason: string;     // why it applied — shown to the admin and kept on the invoice
  isAutomatic: boolean;
}

/** One child's place in the family's sibling ladder. */
export interface SiblingPlanEntry {
  playerId: string;
  name: string;
  dateOfBirth: string;
  rank: number;          // 1 = pays full price
  percent: number;       // 0 for rank 1
  reason: string;
}

export interface SiblingPlan {
  guardianId: string;
  ladder: SiblingLadder;
  /** True when an admin has fixed the order by hand. */
  isOverridden: boolean;
  entries: SiblingPlanEntry[];
}

const money = (n: number) => Math.round(n * 100) / 100;

/**
 * Replaces the legacy flat list of percentages an admin had to pick by hand.
 *
 * Two things this engine must get right, both of which the first version did not:
 *
 *  1. The sibling discount is a property of the FAMILY, not of a child. Evaluating
 *     one player at a time gave every child in a family the discount, so a
 *     two-child invoice was discounted twice.
 *  2. Only the sibling rule is automatic. Returning-player and early-bird stay in
 *     the catalogue for deliberate use, but nothing applies them unasked.
 *
 * The percentages live in `sibling-ladder.ts` and can be overridden per discount
 * row via `params: { tiers: [15, 25], beyond: 25 }`.
 */
@Injectable()
export class DiscountEngine {
  constructor(
    @InjectRepository(Discount) private readonly discounts: Repository<Discount>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
  ) {}

  private resolvePercent(d: Discount, base: number, percent: number): number {
    if (d.kind === DiscountKind.PERCENTAGE) return money(base * (percent / 100));
    return Math.min(Number(d.value), base);
  }

  // ------------------------------------------------------------------ siblings

  /** The active sibling discount row, or null when the academy has switched it off. */
  private async siblingDiscount(): Promise<Discount | null> {
    return this.discounts.findOne({
      where: { rule: DiscountRule.SIBLING, isActive: true, isAutomatic: true },
    });
  }

  /**
   * Which children of a guardian count toward the ladder, and in what order.
   *
   * Only children with a live enrolment count — a sibling who has left must not
   * push the remaining children down the ladder. Default order is eldest first,
   * so the discount falls on the youngest, who is usually in the cheaper U6/U8
   * brackets. An admin can fix a different order on the guardian record.
   */
  async siblingPlan(params: {
    guardianId?: string; seasonId?: string;
    /**
     * Treat these children as enrolled even if they are not yet — for a quote
     * before a new term is confirmed, so the admin sees the real discount up front.
     */
    assumeEnrolled?: string[];
    /**
     * Children who don't exist yet — a child being registered right now. They are
     * ranked with the family by date of birth so the quote is right before
     * anything is saved.
     */
    phantoms?: Array<{ id: string; firstName: string; lastName: string; dateOfBirth: string }>;
  }): Promise<SiblingPlan> {
    const discount = await this.siblingDiscount();
    const ladder = discount ? ladderFromParams(discount.params) : DEFAULT_SIBLING_LADDER;

    const guardian = params.guardianId
      ? await this.guardians.findOne({ where: { id: params.guardianId } })
      : null;
    const children = params.guardianId
      ? await this.players.find({ where: { guardianId: params.guardianId }, order: { dateOfBirth: 'ASC' } })
      : [];                                     // a brand-new family has no children on file yet

    // Restrict to children actually enrolled, so withdrawn siblings don't count.
    // (No query at all for a family with no children on file — an empty IN list
    // needs a placeholder, and a non-UUID placeholder is rejected by Postgres.)
    const childIds = children.map((c) => c.id);
    const enrolled = childIds.length
      ? await this.enrolments.find({
          where: {
            playerId: In(childIds),
            status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]),
            ...(params.seasonId ? { seasonId: params.seasonId } : {}),
          },
          select: ['playerId'],
        })
      : [];
    const enrolledIds = new Set([...enrolled.map((e) => e.playerId), ...(params.assumeEnrolled ?? [])]);
    let cohort = children.filter((c) => enrolledIds.has(c.id));

    // No enrolment context at all (e.g. a what-if from the admin screen): fall
    // back to every child on file rather than reporting an empty family.
    if (cohort.length === 0 && !params.phantoms?.length) cohort = children;
    if (params.phantoms?.length) {
      cohort = [...cohort, ...(params.phantoms as any[])]
        .sort((a, b) => String(a.dateOfBirth).localeCompare(String(b.dateOfBirth)));
    }

    const override = guardian?.siblingRankOverride;
    const isOverridden = Array.isArray(override) && override.length > 0;
    if (isOverridden) {
      const pos = new Map(override!.map((id, i) => [id, i]));
      cohort = [...cohort].sort((a, b) => {
        const ai = pos.has(a.id) ? pos.get(a.id)! : Number.MAX_SAFE_INTEGER;
        const bi = pos.has(b.id) ? pos.get(b.id)! : Number.MAX_SAFE_INTEGER;
        if (ai !== bi) return ai - bi;
        return a.dateOfBirth.localeCompare(b.dateOfBirth);
      });
    }

    const total = cohort.length;
    const entries: SiblingPlanEntry[] = cohort.map((c, i) => {
      const rank = i + 1;
      const percent = total > 1 ? ladderPercent(rank, ladder) : 0;
      const name = `${c.firstName} ${c.lastName}`;
      let reason: string;
      if (total < 2) {
        reason = 'Only child enrolled — no sibling discount';
      } else if (rank === 1) {
        reason = isOverridden
          ? `Set by an admin as the full-price child of ${total}`
          : `Eldest of ${total} children — pays full price`;
      } else {
        reason = `${ordinal(rank)} of ${total} children enrolled under the same guardian`;
      }
      return { playerId: c.id, name, dateOfBirth: c.dateOfBirth, rank, percent, reason };
    });

    return { guardianId: params.guardianId ?? '', ladder, isOverridden, entries };
  }

  /**
   * The automatic discount for each child on a family's invoice, keyed by player id.
   * Call this ONCE per invoice — not once per child.
   */
  async automaticForFamily(params: {
    guardianId: string;
    seasonId?: string;
    /** Base amount per child, excluding VAT, before discount. */
    baseByPlayer: Record<string, number>;
  }): Promise<Map<string, DiscountCandidate>> {
    const out = new Map<string, DiscountCandidate>();
    const discount = await this.siblingDiscount();
    if (!discount) return out;

    const plan = await this.siblingPlan({ guardianId: params.guardianId, seasonId: params.seasonId });
    for (const entry of plan.entries) {
      if (entry.percent <= 0) continue;
      const base = params.baseByPlayer[entry.playerId];
      if (base === undefined) continue;        // child not on this invoice
      out.set(entry.playerId, {
        discountId: discount.id,
        label: `${discount.name} — ${ordinal(entry.rank)} child ${entry.percent}%`,
        rule: DiscountRule.SIBLING,
        kind: discount.kind,
        value: entry.percent,
        amount: this.resolvePercent(discount, base, entry.percent),
        reason: entry.reason,
        isAutomatic: true,
      });
    }
    return out;
  }

  /** Move the full-price position to a different child. Audited by the caller. */
  async setSiblingOrder(guardianId: string, orderedPlayerIds: string[]) {
    const guardian = await this.guardians.findOne({ where: { id: guardianId } });
    if (!guardian) throw new BadRequestException('Guardian not found');
    const owned = await this.players.find({ where: { guardianId }, select: ['id'] });
    const ownedIds = new Set(owned.map((p) => p.id));
    const stray = orderedPlayerIds.filter((id) => !ownedIds.has(id));
    if (stray.length) {
      throw new BadRequestException(`These players are not children of this guardian: ${stray.join(', ')}`);
    }
    await this.guardians.update(guardianId, {
      siblingRankOverride: orderedPlayerIds.length ? orderedPlayerIds : null as any,
    });
    return this.siblingPlan({ guardianId });
  }

  // ------------------------------------------------------------- explain / manual

  /**
   * What applies, and what COULD be applied, for one player — used by the admin
   * screen so a discount is never a mystery. Automatic entries are marked; manual
   * ones are suggestions a person still has to choose.
   */
  async evaluate(params: {
    playerId: string; baseAmount: number; seasonId?: string; asOf?: Date;
  }): Promise<DiscountCandidate[]> {
    const asOf = params.asOf ?? new Date();
    const player = await this.players.findOne({ where: { id: params.playerId } });
    if (!player) return [];

    const active = await this.discounts.find({ where: { isActive: true } });
    const out: DiscountCandidate[] = [];

    for (const d of active) {
      const p = (d.params || {}) as any;

      if (d.rule === DiscountRule.SIBLING) {
        const plan = await this.siblingPlan({
          guardianId: player.guardianId, seasonId: params.seasonId,
        });
        const mine = plan.entries.find((e) => e.playerId === player.id);
        if (mine && mine.percent > 0) {
          out.push({
            discountId: d.id,
            label: `${d.name} — ${ordinal(mine.rank)} child ${mine.percent}%`,
            rule: d.rule, kind: d.kind, value: mine.percent,
            amount: this.resolvePercent(d, params.baseAmount, mine.percent),
            reason: mine.reason,
            isAutomatic: d.isAutomatic,
          });
        }
        continue;
      }

      if (d.rule === DiscountRule.RETURNING) {
        const qb = this.enrolments.createQueryBuilder('e').where('e.playerId = :pid', { pid: player.id });
        if (params.seasonId) qb.andWhere('e.seasonId != :sid', { sid: params.seasonId });
        const prior = await qb.getCount();
        if (prior > 0) {
          out.push({
            discountId: d.id, label: d.name, rule: d.rule, kind: d.kind, value: Number(d.value),
            amount: this.resolvePercent(d, params.baseAmount, Number(d.value)),
            reason: `Returning player — ${prior} previous enrolment(s)`,
            isAutomatic: d.isAutomatic,
          });
        }
        continue;
      }

      if (d.rule === DiscountRule.EARLY_BIRD) {
        const cutoff = p.cutoffDate ? new Date(p.cutoffDate) : null;
        if (cutoff && asOf <= cutoff) {
          out.push({
            discountId: d.id, label: d.name, rule: d.rule, kind: d.kind, value: Number(d.value),
            amount: this.resolvePercent(d, params.baseAmount, Number(d.value)),
            reason: `Registered on or before ${cutoff.toISOString().slice(0, 10)}`,
            isAutomatic: d.isAutomatic,
          });
        }
      }
    }

    // Automatic first, then by value — so the admin sees what will happen anyway
    // before what they could choose.
    return out.sort((a, b) =>
      (a.isAutomatic === b.isAutomatic ? b.amount - a.amount : a.isAutomatic ? -1 : 1));
  }

  /**
   * The automatic discount for a single player, if any.
   * Retained for callers that work one player at a time; invoicing uses
   * automaticForFamily() so a family is costed as a unit.
   */
  async best(params: { playerId: string; baseAmount: number; seasonId?: string; asOf?: Date }) {
    const all = await this.evaluate(params);
    return all.find((c) => c.isAutomatic) ?? null;
  }

  // ---- catalog management ----
  list() { return this.discounts.find({ order: { isAutomatic: 'DESC', name: 'ASC' } }); }
  create(input: Partial<Discount>) { return this.discounts.save(this.discounts.create(input)); }
  async update(id: string, input: Partial<Discount>) {
    await this.discounts.update(id, input);
    return this.discounts.findOne({ where: { id } });
  }
  async remove(id: string) { await this.discounts.update(id, { isActive: false }); return { success: true, id }; }
}
