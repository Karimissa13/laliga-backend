import { normaliseMobile } from '../../common/contact.util';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Guardian, Player, Wallet } from '../../database/entities';
import { ReferenceService } from '../../common/reference.service';
import { PaginationDto, paginate } from '../../common/dto/pagination.dto';

@Injectable()
export class GuardiansService {
  constructor(
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    private readonly refs: ReferenceService,
  ) {}

  async list(q: PaginationDto) {
    const qb = this.guardians.createQueryBuilder('g')
      .loadRelationCountAndMap('g.playersCount', 'g.players')
      .orderBy('g.createdAt', 'DESC')
      .skip(q.skip).take(q.limit);
    if (q.search) {
      qb.where(new Brackets((w) => {
        w.where('g.fullName ILIKE :s', { s: `%${q.search}%` })
          .orWhere('g.email ILIKE :s', { s: `%${q.search}%` })
          .orWhere('g.mobile ILIKE :s', { s: `%${q.search}%` })
          .orWhere('g.reference ILIKE :s', { s: `%${q.search}%` });
      }));
    }
    const [data, total] = await qb.getManyAndCount();
    return paginate(data, total, q.page, q.limit);
  }

  /**
   * The Guardians screen: one row per family with its children, the additional
   * email, wallet and parent-portal state. Every value is a bound parameter.
   */
  async directory(q: { search?: string; reference?: string; emirate?: string; children?: string; portal?: string; additionalEmail?: string; page?: number; limit?: number }) {
    const params: any[] = [];
    const p = (v: any) => { params.push(v); return `$${params.length}`; };
    const w: string[] = [];
    if (q.search?.trim()) {
      const t = q.search.trim(), like = p(`%${t}%`), digits = t.replace(/\D/g, '');
      const ors = [`g."fullName" ILIKE ${like}`, `g.email ILIKE ${like}`, `coalesce(g."secondaryEmail", '') ILIKE ${like}`,
        `coalesce(g."secondaryEmailName", '') ILIKE ${like}`,
        `EXISTS (SELECT 1 FROM players x WHERE x."guardianId" = g.id AND (x."firstName" || ' ' || x."lastName") ILIKE ${like})`];
      if (digits.length >= 4) ors.push(`regexp_replace(g.mobile, '\\D', '', 'g') LIKE ${p(`%${digits.replace(/^(971|0)/, '')}%`)}`);
      w.push(`(${ors.join(' OR ')})`);
    }
    if (q.reference?.trim()) {
      const n = q.reference.replace(/\D/g, '');
      if (n) w.push(`regexp_replace(g.reference, '\\D', '', 'g')::bigint = ${p(Number(n))}`);
    }
    if (q.emirate) w.push(`g.emirate = ${p(q.emirate)}`);
    if (q.children === 'active') w.push(`EXISTS (SELECT 1 FROM players x WHERE x."guardianId" = g.id AND x."archivedAt" IS NULL)`);
    if (q.children === 'none') w.push(`NOT EXISTS (SELECT 1 FROM players x WHERE x."guardianId" = g.id AND x."archivedAt" IS NULL)`);
    if (q.portal === 'signed_in') w.push(`g."lastLoginAt" IS NOT NULL`);
    if (q.portal === 'sent') w.push(`g."credentialsSentAt" IS NOT NULL AND g."lastLoginAt" IS NULL`);
    if (q.portal === 'never') w.push(`g."credentialsSentAt" IS NULL AND g."lastLoginAt" IS NULL`);
    if (q.additionalEmail === 'yes') w.push(`g."secondaryEmail" IS NOT NULL`);
    if (q.additionalEmail === 'no') w.push(`g."secondaryEmail" IS NULL`);
    const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
    const limit = Math.min(Math.max(q.limit ?? 50, 1), 200), page = Math.max(q.page ?? 1, 1);
    const [{ n }] = await this.guardians.manager.query(`SELECT count(*)::int AS n FROM guardians g ${where}`, params);
    const rows: any[] = await this.guardians.manager.query(`
      SELECT g.id, g.reference, g."fullName", g.relationship, g.email, g."secondaryEmail", g."secondaryEmailName", g.mobile,
             g.emirate, g.city, g."createdAt", g."lastLoginAt", g."credentialsSentAt", g."isActive",
             coalesce(wl.balance, 0)::float AS wallet,
             coalesce((SELECT json_agg(json_build_object('id', x.id, 'reference', x.reference, 'name', x."firstName" || ' ' || x."lastName",
                        'category', ag.code, 'team', t.name, 'archived', x."archivedAt" IS NOT NULL) ORDER BY x."dateOfBirth")
                       FROM players x LEFT JOIN age_groups ag ON ag.id = x."ageGroupId" LEFT JOIN teams t ON t.id = x."currentTeamId"
                       WHERE x."guardianId" = g.id), '[]') AS children
      FROM guardians g LEFT JOIN wallets wl ON wl."guardianId" = g.id
      ${where} ORDER BY g."createdAt" DESC LIMIT ${p(limit)} OFFSET ${p((page - 1) * limit)}`, params);
    return { data: rows, meta: { total: n, page, limit, pages: Math.max(1, Math.ceil(n / limit)) } };
  }

  async findOne(id: string) {
    const guardian = await this.guardians.findOne({
      where: { id },
      relations: { players: true },
    });
    if (!guardian) throw new NotFoundException('Guardian not found');
    return guardian;
  }

  async create(input: {
    fullName: string; relationship?: string; email: string; secondaryEmail?: string;
    mobile: string; emirate?: string; city?: string; marketingConsent?: boolean; password?: string;
  }) {
    if (await this.guardians.findOne({ where: { email: input.email.toLowerCase() } })) {
      throw new BadRequestException('A guardian with this email already exists');
    }
    const guardian = this.guardians.create({
      reference: await this.refs.next('PR'),
      fullName: input.fullName,
      relationship: input.relationship,
      email: input.email.toLowerCase(),
      secondaryEmail: input.secondaryEmail,
      mobile: normaliseMobile(input.mobile) ?? input.mobile,
      emirate: input.emirate,
      city: input.city,
      marketingConsent: input.marketingConsent ?? false,
      passwordHash: input.password ? await bcrypt.hash(input.password, 10) : undefined,
    });
    const saved = await this.guardians.save(guardian);
    // Every guardian gets a wallet (credits/refunds/overpayments).
    await this.wallets.save(this.wallets.create({ guardianId: saved.id, balance: '0' }));
    return this.findOne(saved.id);
  }

  async update(id: string, input: Partial<Guardian> & { password?: string }) {
    const guardian = await this.findOne(id);
    const patch: any = { ...input };
    delete patch.password;
    delete patch.id;
    delete patch.reference; // references are immutable
    delete patch.siblingRankOverride; // changed only through the audited discount endpoint
    if (input.email !== undefined) {
      const email = String(input.email).trim().toLowerCase();
      const clash = await this.guardians.findOne({ where: { email } });
      if (clash && clash.id !== guardian.id) {
        throw new BadRequestException(`${email} already belongs to ${clash.reference} ${clash.fullName}`);
      }
      patch.email = email;
    }
    if (input.mobile !== undefined) patch.mobile = normaliseMobile(input.mobile) ?? input.mobile;
    if (input.secondaryEmail !== undefined) {
      const extra = input.secondaryEmail ? String(input.secondaryEmail).trim().toLowerCase() : null;
      if (extra && extra === (patch.email ?? guardian.email)) throw new BadRequestException('The additional email is the same as the main one');
      patch.secondaryEmail = extra;
      if (!extra) patch.secondaryEmailName = null;
    }
    if (input.secondaryEmailName !== undefined) patch.secondaryEmailName = input.secondaryEmailName ? String(input.secondaryEmailName).trim() : null;
    if (input.password) patch.passwordHash = await bcrypt.hash(input.password, 10);
    await this.guardians.update(id, patch);
    return this.findOne(id);
  }

  /** Siblings = other players under the same guardian. */
  async siblings(guardianId: string, excludePlayerId?: string) {
    const players = await this.players.find({ where: { guardianId } });
    return players.filter((p) => p.id !== excludePlayerId);
  }
}
