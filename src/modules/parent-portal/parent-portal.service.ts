import { summarisePurchases } from '../registration/purchases';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { In, IsNull, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Enrolment, EnrolmentStatus, Guardian, Invoice, InvoiceLineItem, InvoiceStatus, Player } from '../../database/entities';

const TOKEN_TTL = 2 * 60 * 60;        // 2 hours
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

export interface ParentPrincipal { id: string; mustChangePassword: boolean }

/** Parent sign-in, kept apart from staff sign-in: its own signing key, so a parent token never opens a staff route. */
@Injectable()
export class ParentPortalService {
  private readonly attempts = new Map<string, { n: number; until?: number }>();

  constructor(
    @InjectRepository(Guardian) private readonly guardians: Repository<Guardian>,
    @InjectRepository(Player) private readonly players: Repository<Player>,
    @InjectRepository(Invoice) private readonly invoices: Repository<Invoice>,
    @InjectRepository(InvoiceLineItem) private readonly lines: Repository<InvoiceLineItem>,
    @InjectRepository(Enrolment) private readonly enrolments: Repository<Enrolment>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  secret() { return `${this.config.get<string>('jwt.accessSecret')}::parent-portal`; }

  async verify(token: string): Promise<ParentPrincipal> {
    try {
      const p = await this.jwt.verifyAsync(token, { secret: this.secret() });
      if (p.typ !== 'parent') throw new Error('wrong token type');
      return { id: p.sub, mustChangePassword: !!p.mcp };
    } catch { throw new UnauthorizedException('Please sign in again'); }
  }

  private async token(g: Guardian) {
    return this.jwt.signAsync({ sub: g.id, typ: 'parent', mcp: g.mustChangePassword }, { secret: this.secret(), expiresIn: TOKEN_TTL });
  }

  async login(email: string, password: string) {
    const key = email.trim().toLowerCase();
    const a = this.attempts.get(key);
    if (a?.until && a.until > Date.now()) {
      throw new UnauthorizedException(`Too many attempts. Try again in ${Math.ceil((a.until - Date.now()) / 60000)} minutes.`);
    }
    const g = await this.guardians.createQueryBuilder('g').addSelect('g.passwordHash')
      .where('LOWER(g.email) = :e', { e: key }).andWhere('g.isActive = true').getOne();
    const ok = !!g?.passwordHash && (await bcrypt.compare(password, g.passwordHash));
    if (!ok || !g) {
      const n = (a?.n ?? 0) + 1;
      this.attempts.set(key, n >= MAX_ATTEMPTS ? { n: 0, until: Date.now() + LOCK_MINUTES * 60000 } : { n });
      throw new UnauthorizedException('Email or password is not right');
    }
    if (g.mustChangePassword && g.tempPasswordExpiresAt && g.tempPasswordExpiresAt < new Date()) {
      throw new UnauthorizedException('This temporary password has expired. Ask the academy to send new sign-in details.');
    }
    this.attempts.delete(key);
    await this.guardians.update(g.id, { lastLoginAt: new Date() });
    return { accessToken: await this.token(g), expiresIn: TOKEN_TTL, mustChangePassword: g.mustChangePassword, name: g.fullName };
  }

  static checkStrength(pw: string) {
    if (pw.length < 8) return 'Use at least 8 characters.';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
    return null;
  }

  async changePassword(id: string, current: string, next: string) {
    const g = await this.guardians.createQueryBuilder('g').addSelect('g.passwordHash').where('g.id = :id', { id }).getOne();
    if (!g?.passwordHash || !(await bcrypt.compare(current, g.passwordHash))) throw new BadRequestException('Your current password is not right');
    const weak = ParentPortalService.checkStrength(next);
    if (weak) throw new BadRequestException(weak);
    if (current === next) throw new BadRequestException('Choose a password different from the temporary one');
    await this.guardians.update(id, { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false, tempPasswordExpiresAt: null });
    const fresh = await this.guardians.findOne({ where: { id } });
    return { accessToken: await this.token(fresh!), mustChangePassword: false };
  }

  private requireReady(p: ParentPrincipal) {
    if (p.mustChangePassword) throw new ForbiddenException({ error: 'PasswordChangeRequired', message: 'Choose your own password first' });
  }

  /** What the parent sees: their children, current terms and invoices. */
  async me(p: ParentPrincipal) {
    this.requireReady(p);
    const g = await this.guardians.findOne({ where: { id: p.id } });
    if (!g) throw new NotFoundException();
    const kids = await this.players.find({ where: { guardianId: g.id, archivedAt: IsNull() }, relations: { ageGroup: true, currentTeam: true }, order: { dateOfBirth: 'ASC' } });
    const enrols = kids.length ? await this.enrolments.find({
      where: { playerId: In(kids.map((k) => k.id)), status: In([EnrolmentStatus.ACTIVE, EnrolmentStatus.PENDING]) },
      relations: { term: true, season: true, team: true },
    }) : [];
    const invs = await this.invoices.find({
      where: { guardianId: g.id, status: Not(In([InvoiceStatus.DRAFT, InvoiceStatus.CANCELLED])) },
      order: { createdAt: 'DESC' }, take: 50,
    });
    return {
      parent: { name: g.fullName, email: g.email, reference: g.reference },
      children: kids.map((k) => ({
        name: `${k.firstName} ${k.lastName}`, reference: k.reference, category: (k as any).ageGroup?.code ?? null,
        team: (k as any).currentTeam?.name ?? null, status: k.status,
        // One line per option bought: "Full season (Term 1, Term 2, Term 3)".
        terms: summarisePurchases(enrols.filter((e) => e.playerId === k.id) as any)
          .map((pu) => (pu.package && pu.terms.length > 1 ? `${pu.label} (${pu.termsText})` : pu.label)),
      })),
      invoices: invs.map((i) => {
        const balance = Math.max(0, Number(i.total) - Number(i.amountPaid) + Number(i.amountRefunded) - Number(i.writeOffAmount));
        return { id: i.id, number: i.number, date: i.issueDate, dueDate: i.dueDate, total: Number(i.total), balance: Math.round(balance * 100) / 100, status: i.status };
      }),
    };
  }

  async myChildren(p: ParentPrincipal) {
    this.requireReady(p);
    return this.players.find({ where: { guardianId: p.id }, order: { dateOfBirth: 'ASC' } });
  }

  /** The invoice must be this parent's own. */
  async ownInvoice(p: ParentPrincipal, invoiceId: string) {
    this.requireReady(p);
    const inv = await this.invoices.findOne({ where: { id: invoiceId } });
    if (!inv || inv.guardianId !== p.id || ['DRAFT', 'CANCELLED'].includes(inv.status)) throw new NotFoundException('Invoice not found');
    return inv;
  }
}
