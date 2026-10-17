import { summarisePurchases } from '../registration/purchases';
import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { In, IsNull, Not, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { NotificationsService } from '../notifications/notifications.service';
import { Document, DocumentType, Enrolment, EnrolmentStatus, Guardian, Invoice, InvoiceLineItem, InvoiceStatus, Player, User } from '../../database/entities';
import { PARENT_DOC_TYPES } from './parent-home.service';

const TOKEN_TTL = 2 * 60 * 60;        // 2 hours
const ACT_TTL = 30 * 60;              // staff acting as a parent: 30 minutes
/** Uploads: images arrive shrunk (~200 KB) by the portal; a PDF may be up to 1.5 MB. */
const MAX_DOC_BYTES = 1_500_000;
const DOC_MIME = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_ATTEMPTS = 5;
const LOCK_MINUTES = 15;
const RESET_MINUTES = 60;
const RESET_GAP_MS = 2 * 60000;
const sha256 = (t: string) => createHash('sha256').update(t).digest('hex');

/** `actorId` / `actorName`: a staff member acting as the parent (account switch). */
export interface ParentPrincipal { id: string; mustChangePassword: boolean; actorId?: string | null; actorName?: string | null }

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
    @InjectRepository(Document) private readonly documents: Repository<Document>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
  ) {}

  secret() { return `${this.config.get<string>('jwt.accessSecret')}::parent-portal`; }

  async verify(token: string): Promise<ParentPrincipal> {
    try {
      const p = await this.jwt.verifyAsync(token, { secret: this.secret() });
      if (p.typ !== 'parent') throw new Error('wrong token type');
      return { id: p.sub, mustChangePassword: p.act ? false : !!p.mcp, actorId: p.act ?? null, actorName: p.actn ?? null };
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

  /**
   * "Forgot password". Always answers the same way, so the page never tells whether an
   * email has an account. A link (one-time code, 60 minutes) goes to that email
   * only; asking again within 2 minutes sends nothing new.
   */
  async requestReset(email: string) {
    const key = email.trim().toLowerCase();
    const g = await this.guardians.createQueryBuilder('g')
      .where('LOWER(g.email) = :e', { e: key }).andWhere('g.isActive = true').getOne();
    if (g && !(g.resetRequestedAt && Date.now() - new Date(g.resetRequestedAt).getTime() < RESET_GAP_MS)) {
      const token = randomBytes(32).toString('base64url');
      await this.guardians.update(g.id, {
        resetTokenHash: sha256(token), resetTokenExpiresAt: new Date(Date.now() + RESET_MINUTES * 60000), resetRequestedAt: new Date(),
      });
      await this.notifications.sendPasswordReset(g.id, token, RESET_MINUTES);
    }
    return { ok: true, message: 'If this email has a parent account, we have sent it a link to choose a new password.' };
  }

  /** Set the new password from the emailed link. The link then stops working. */
  async resetPassword(token: string, next: string) {
    const weak = ParentPortalService.checkStrength(next);
    if (weak) throw new BadRequestException(weak);
    const g = await this.guardians.createQueryBuilder('g').addSelect('g.resetTokenHash')
      .where('g.resetTokenHash = :h', { h: sha256(token) }).andWhere('g.isActive = true').getOne();
    if (!g || !g.resetTokenExpiresAt || new Date(g.resetTokenExpiresAt) < new Date()) {
      throw new BadRequestException('This link has expired or was already used. Ask for a new one from the sign-in page.');
    }
    // Single use: the code is cleared in the same update that only succeeds while it is still there.
    const res = await this.guardians.createQueryBuilder().update(Guardian)
      .set({ passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false, tempPasswordExpiresAt: null, resetTokenHash: null, resetTokenExpiresAt: null })
      .where('id = :id AND "resetTokenHash" = :h', { id: g.id, h: sha256(token) }).execute();
    if (!res.affected) throw new BadRequestException('This link has expired or was already used. Ask for a new one from the sign-in page.');
    this.attempts.delete(g.email.trim().toLowerCase());
    return { ok: true, email: g.email };
  }

  /**
   * Account switch (Karim, 17 Oct 2026): a staff member opens the parent's portal as the parent.
   * The token says who is acting (shown as a banner, written on anything they change), lasts
   * 30 minutes, and cannot change the parent's password. The caller writes the audit entry.
   */
  async actAs(guardianId: string, staffId: string) {
    const g = await this.guardians.findOne({ where: { id: guardianId } });
    if (!g) throw new NotFoundException('Parent not found');
    const u = await this.users.findOne({ where: { id: staffId } });
    const token = await this.jwt.signAsync({ sub: g.id, typ: 'parent', mcp: false, act: staffId, actn: u?.fullName ?? 'Staff' },
      { secret: this.secret(), expiresIn: ACT_TTL });
    return { token, expiresIn: ACT_TTL, parent: { name: g.fullName, reference: g.reference } };
  }

  /** What the parent may change themselves. Email (their sign-in) is changed by the academy. */
  async updateProfile(p: ParentPrincipal, input: { fullName?: string; mobile?: string; secondaryEmail?: string | null; secondaryEmailName?: string | null;
    nationality?: string | null; area?: string | null; address?: string | null }) {
    this.requireReady(p);
    const g = await this.guardians.findOne({ where: { id: p.id } });
    if (!g) throw new NotFoundException();
    const patch: Partial<Guardian> = {};
    const t = (v: any) => (v == null ? null : String(v).trim() || null);
    if (input.fullName !== undefined) { const v = t(input.fullName); if (!v || v.length < 3) throw new BadRequestException('Enter your full name.'); patch.fullName = v; }
    if (input.mobile !== undefined) { const v = t(input.mobile); if (!v || v.replace(/\D/g, '').length < 9) throw new BadRequestException('Enter a mobile number.'); patch.mobile = v; }
    if (input.secondaryEmail !== undefined) {
      const v = t(input.secondaryEmail)?.toLowerCase() ?? null;
      if (v && v === g.email.toLowerCase()) throw new BadRequestException('The additional email is the same as your sign-in email.');
      patch.secondaryEmail = v; if (!v) patch.secondaryEmailName = null;
    }
    if (input.secondaryEmailName !== undefined) patch.secondaryEmailName = t(input.secondaryEmailName);
    for (const k of ['nationality', 'area', 'address'] as const) if (input[k] !== undefined) (patch as any)[k] = t(input[k]);
    if (Object.keys(patch).length) await this.guardians.update(g.id, patch);
    return { ok: true, changed: Object.keys(patch) };
  }

  /** Upload a child's photo, Emirates ID (front/back) or medical insurance. The newest of each type is the one shown. */
  async uploadDocument(p: ParentPrincipal, input: { playerId: string; type: string; fileName: string; dataUrl: string }) {
    this.requireReady(p);
    const kid = await this.players.findOne({ where: { id: input.playerId, guardianId: p.id } });
    if (!kid || kid.archivedAt) throw new NotFoundException('Child not found');
    if (!(PARENT_DOC_TYPES as readonly string[]).includes(input.type)) throw new BadRequestException('Choose the kind of document.');
    const m = /^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(input.dataUrl || '');
    if (!m || !DOC_MIME.includes(m[1])) throw new BadRequestException('Upload a photo (JPG, PNG) or a PDF.');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_DOC_BYTES) throw new BadRequestException('The file is too large — 1.5 MB at most.');
    if (input.type === 'PHOTO' && m[1] === 'application/pdf') throw new BadRequestException('The photo must be an image.');
    const name = String(input.fileName || 'document').replace(/[^\w .()-]/g, '_').slice(0, 120);
    const d = await this.documents.save(this.documents.create({
      type: input.type as DocumentType, fileName: name, storageKey: `db:${kid.id}/${input.type}`, mimeType: m[1], sizeBytes: buf.length,
      playerId: kid.id, guardianId: p.id, uploadedById: p.actorId ?? undefined, content: buf,
    }));
    return { id: d.id, type: d.type, fileName: d.fileName, at: d.createdAt };
  }

  /** One of the family's own documents (parents), or any document (staff — see the documents controller). */
  async ownDocument(p: ParentPrincipal, id: string) {
    this.requireReady(p);
    const d = await this.documents.createQueryBuilder('d').addSelect('d.content').where('d.id = :id', { id }).getOne();
    if (!d || !d.content || d.guardianId !== p.id && !(d.playerId && await this.players.exist({ where: { id: d.playerId, guardianId: p.id } }))) {
      throw new NotFoundException('Document not found');
    }
    return d;
  }

  async anyDocument(id: string) {
    const d = await this.documents.createQueryBuilder('d').addSelect('d.content').where('d.id = :id', { id }).getOne();
    if (!d || !d.content) throw new NotFoundException('No file for this document');
    return d;
  }

  static checkStrength(pw: string) {
    if (pw.length < 8) return 'Use at least 8 characters.';
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'Use letters and at least one number.';
    return null;
  }

  async changePassword(id: string, current: string, next: string, actorId?: string | null) {
    if (actorId) throw new ForbiddenException('Staff acting as the parent cannot change their password. Use "Send sign-in details" instead.');
    const g = await this.guardians.createQueryBuilder('g').addSelect('g.passwordHash').where('g.id = :id', { id }).getOne();
    if (!g?.passwordHash || !(await bcrypt.compare(current, g.passwordHash))) throw new BadRequestException('Your current password is not right');
    const weak = ParentPortalService.checkStrength(next);
    if (weak) throw new BadRequestException(weak);
    if (current === next) throw new BadRequestException('Choose a password different from the temporary one');
    await this.guardians.update(id, { passwordHash: await bcrypt.hash(next, 10), mustChangePassword: false, tempPasswordExpiresAt: null });
    const fresh = await this.guardians.findOne({ where: { id } });
    return { accessToken: await this.token(fresh!), mustChangePassword: false };
  }

  requireReady(p: ParentPrincipal) {
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
        const balance = Math.max(0, Number(i.total) - Number(i.amountPaid) - Number(i.writeOffAmount));
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
