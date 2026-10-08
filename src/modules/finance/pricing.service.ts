import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  PriceListEntry, Product, ProgramType, Season, TeamLevel, Term, TermPackage,
} from '../../database/entities';
import { PACKAGES, PACKAGE_LABEL, PACKAGE_TERMS, hoursPerSession, packageForPositions, splitIncl } from './pricing';

const band = (c: string) => (c === 'GIRLS' ? 99 : Number(c.replace(/\D/g, '')) || 0);

export interface ResolvedPrice {
  ok: true;
  package: TermPackage; packageLabel: string;
  sessionsPerWeek: number; hoursPerSession: number; category: string;
  inclVat: number; net: number; vat: number; vatRate: number; sessionRate: number | null;
  terms: Array<{ id: string; name: string; startDate?: string; endDate?: string }>;
}

/**
 * The academy price list (2026/27): VAT-inclusive prices by sessions a week
 * (1, 2 or 3), category, and term option (Term 1 … Full season). Also owns the
 * product catalogue — kits, the Man City league, tournaments.
 */
@Injectable()
export class PricingService {
  constructor(
    @InjectRepository(PriceListEntry) private readonly prices: Repository<PriceListEntry>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
    @InjectRepository(Term) private readonly terms: Repository<Term>,
    @InjectRepository(Season) private readonly seasons: Repository<Season>,
  ) {}

  /** The season's three terms in order — position 0 is Term 1. */
  async seasonTerms(seasonId: string): Promise<Term[]> {
    return this.terms.find({
      where: { seasonId, type: ProgramType.TERM, isActive: true },
      order: { startDate: 'ASC' },
    });
  }

  async hasPriceList(seasonId?: string | null): Promise<boolean> {
    if (!seasonId) return false;
    return (await this.prices.count({ where: { seasonId, isActive: true } })) > 0;
  }

  /** The terms an option covers, in this season. */
  async packageTerms(seasonId: string, pkg: TermPackage): Promise<Term[]> {
    const all = await this.seasonTerms(seasonId);
    const want = PACKAGE_TERMS[pkg];
    if (want.some((i) => !all[i])) {
      throw new BadRequestException(`${PACKAGE_LABEL[pkg]} needs ${want.length} term(s) set up in this season; it has ${all.length}.`);
    }
    return want.map((i) => all[i]);
  }

  /** The option a set of terms makes up, or a clear error if it is not one of the six. */
  async packageFor(seasonId: string, termIds: string[]): Promise<TermPackage> {
    const all = await this.seasonTerms(seasonId);
    const positions = termIds.map((id) => all.findIndex((t) => t.id === id));
    if (positions.some((p) => p < 0)) throw new BadRequestException('A term on this invoice is not one of the season\'s terms.');
    const pkg = packageForPositions(positions);
    if (!pkg) {
      throw new BadRequestException(
        `${positions.map((p) => all[p].name).join(' + ')} is not one of the price-list options ` +
        '(Term 1, Term 2, Term 3, Terms 1 & 2, Terms 2 & 3, Full season). Invoice them separately.');
    }
    return pkg;
  }

  async resolve(q: {
    seasonId: string; package: TermPackage; sessionsPerWeek: number; category?: string | null; girlsOnly?: boolean;
  }): Promise<ResolvedPrice | { ok: false; reason: string }> {
    const category = q.girlsOnly ? 'GIRLS' : (q.category ?? null);
    if (!category) return { ok: false, reason: 'The child has no age category, so the price list cannot be used.' };
    const row = await this.prices.findOne({
      where: { seasonId: q.seasonId, sessionsPerWeek: q.sessionsPerWeek, category, isActive: true },
    });
    const tier = `${q.sessionsPerWeek} session${q.sessionsPerWeek === 1 ? '' : 's'} a week`;
    if (!row) return { ok: false, reason: `The price list has no ${category} price for ${tier}.` };
    const incl = Number(row.prices?.[q.package]);
    if (!incl) return { ok: false, reason: `The price list has no ${PACKAGE_LABEL[q.package]} price for ${category}, ${tier}.` };
    const vatRate = Number(row.vatRate);
    const { net, vat } = splitIncl(incl, vatRate);
    const terms = await this.packageTerms(q.seasonId, q.package);
    return {
      ok: true, package: q.package, packageLabel: PACKAGE_LABEL[q.package],
      sessionsPerWeek: q.sessionsPerWeek, hoursPerSession: hoursPerSession(q.category), category,
      inclVat: incl, net, vat, vatRate, sessionRate: row.sessionRate != null ? Number(row.sessionRate) : null,
      terms: terms.map((t) => ({ id: t.id, name: t.name, startDate: t.startDate, endDate: t.endDate })),
    };
  }

  /** The whole price list for a season, shaped like the printed sheet. */
  async priceList(seasonId?: string) {
    const season = seasonId
      ? await this.seasons.findOne({ where: { id: seasonId } })
      : await this.seasons.findOne({ where: { isActive: true } });
    if (!season) throw new NotFoundException('Season not found');
    const [rows, terms] = await Promise.all([
      this.prices.find({ where: { seasonId: season.id } }),
      this.seasonTerms(season.id),
    ]);
    const tiers = [1, 2, 3].map((n) => ({
      sessionsPerWeek: n,
      rows: rows.filter((r) => r.sessionsPerWeek === n)
        .sort((a, b) => band(a.category) - band(b.category))
        .map((r) => ({
          id: r.id, category: r.category, isActive: r.isActive,
          sessionRate: r.sessionRate != null ? Number(r.sessionRate) : null,
          prices: r.prices, hoursPerSession: r.category === 'GIRLS' ? null : hoursPerSession(r.category),
        })),
    })).filter((t) => t.rows.length);
    return {
      season: { id: season.id, name: season.name },
      packages: PACKAGES.map((p) => ({
        code: p, label: PACKAGE_LABEL[p],
        terms: PACKAGE_TERMS[p].map((i) => terms[i]?.name).filter(Boolean),
        weeks: PACKAGE_TERMS[p].reduce((s, i) => s + (terms[i]?.weeks ?? 0), 0) || null,
      })),
      tiers,
      vatInclusive: true,
    };
  }

  async updateEntry(id: string, patch: { prices?: Partial<Record<TermPackage, number>>; sessionRate?: number | null; isActive?: boolean }) {
    const row = await this.prices.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Price-list row not found');
    if (patch.prices) {
      for (const [k, v] of Object.entries(patch.prices)) {
        if (!PACKAGES.includes(k as TermPackage)) throw new BadRequestException(`Unknown term option ${k}`);
        if (v != null && !(Number(v) > 0)) throw new BadRequestException(`${PACKAGE_LABEL[k as TermPackage]} price must be positive`);
      }
      row.prices = { ...row.prices, ...patch.prices };
      for (const k of Object.keys(row.prices) as TermPackage[]) if (row.prices[k] == null) delete row.prices[k];
    }
    if (patch.sessionRate !== undefined) row.sessionRate = patch.sessionRate == null ? null : Number(patch.sessionRate).toFixed(2);
    if (patch.isActive !== undefined) row.isActive = patch.isActive;
    return this.prices.save(row);
  }

  // --------------------------------------------------------------- products

  listProducts(q: { activeOnly?: boolean } = {}) {
    return this.products.find({
      where: q.activeOnly ? { isActive: true } : {},
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  /** The optional extras offered on the registration screen for a level. */
  async productsForRegistration(level?: TeamLevel | null) {
    const all = await this.products.find({ where: { isActive: true, offerAtRegistration: true }, order: { sortOrder: 'ASC' } });
    return all.filter((p) => !p.levels?.length || !level || p.levels.includes(level));
  }

  async productsByIds(ids: string[]) {
    if (!ids.length) return [];
    const rows = await this.products.find({ where: { id: In(ids) } });
    const missing = ids.filter((id) => !rows.some((r) => r.id === id && r.isActive));
    if (missing.length) throw new BadRequestException('One of the chosen items is not in the catalogue (or is switched off).');
    return ids.map((id) => rows.find((r) => r.id === id)!);
  }

  async createProduct(dto: Partial<Product> & { priceInclVat: any }) {
    if (await this.products.findOne({ where: { code: dto.code! } })) throw new BadRequestException(`Code ${dto.code} is already used`);
    return this.products.save(this.products.create({ ...dto, priceInclVat: Number(dto.priceInclVat).toFixed(2) }));
  }

  async updateProduct(id: string, dto: Partial<Product> & { priceInclVat?: any }) {
    const p = await this.products.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Product not found');
    Object.assign(p, dto);
    if (dto.priceInclVat !== undefined) p.priceInclVat = Number(dto.priceInclVat).toFixed(2);
    return this.products.save(p);
  }
}
