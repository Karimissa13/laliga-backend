import {
  BadRequestException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { RefreshToken, Role, User } from '../../database/entities';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; fullName: string; email: string; role: string; permissions: string[] };
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(RefreshToken) private readonly refreshTokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** Resolve the effective permission keys for a role (super-admin => wildcard). */
  static resolvePermissions(role: Role): string[] {
    if (!role) return [];
    if (role.slug === 'super-admin') return ['*'];
    return (role.permissions || []).map((p) => p.key);
  }

  private async loadUserForAuth(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.role', 'role')
      .leftJoinAndSelect('role.permissions', 'perm')
      .where('LOWER(u.email) = LOWER(:email)', { email })
      .getOne();
  }

  async validateUser(email: string, password: string): Promise<User> {
    const user = await this.loadUserForAuth(email);
    if (!user || !user.isActive) throw new UnauthorizedException('Invalid credentials');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');
    return user;
  }

  async changePassword(userId: string, current: string, next: string) {
    const user = await this.users.createQueryBuilder('u').addSelect('u.passwordHash').where('u.id = :id', { id: userId }).getOne();
    if (!user || !(await bcrypt.compare(current, user.passwordHash))) throw new UnauthorizedException('Your current password is not right');
    if (current === next) throw new BadRequestException('Choose a new password different from the current one');
    await this.users.update(userId, { passwordHash: await bcrypt.hash(next, 10) });
    // Sign out other devices: their refresh tokens stop working.
    await this.refreshTokens.update({ userId, revokedAt: IsNull() } as any, { revokedAt: new Date() });
    return { success: true };
  }

  async login(email: string, password: string): Promise<TokenPair> {
    const user = await this.validateUser(email, password);
    user.lastLoginAt = new Date();
    await this.users.update(user.id, { lastLoginAt: user.lastLoginAt });
    return this.issueTokens(user);
  }

  private async issueTokens(user: User): Promise<TokenPair> {
    const permissions = AuthService.resolvePermissions(user.role);
    const accessTtl = this.config.get<number>('jwt.accessTtl') ?? 900;
    const refreshTtl = this.config.get<number>('jwt.refreshTtl') ?? 1209600;

    const accessToken = await this.jwt.signAsync(
      { sub: user.id, email: user.email, role: user.role?.slug, permissions },
      { secret: this.config.get('jwt.accessSecret'), expiresIn: accessTtl },
    );
    const refreshRaw = crypto.randomBytes(48).toString('hex');
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti: refreshRaw },
      { secret: this.config.get('jwt.refreshSecret'), expiresIn: refreshTtl },
    );
    await this.refreshTokens.insert({
      userId: user.id,
      tokenHash: crypto.createHash('sha256').update(refreshToken).digest('hex'),
      expiresAt: new Date(Date.now() + refreshTtl * 1000),
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtl,
      user: {
        id: user.id, fullName: user.fullName, email: user.email,
        role: user.role?.slug, permissions,
      },
    };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: any;
    try {
      payload = await this.jwt.verifyAsync(refreshToken, {
        secret: this.config.get('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const stored = await this.refreshTokens.findOne({ where: { tokenHash: hash } });
    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired or revoked');
    }
    // rotate
    await this.refreshTokens.update(stored.id, { revokedAt: new Date() });
    const user = await this.users.findOne({
      where: { id: payload.sub },
      relations: { role: { permissions: true } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('User inactive');
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const hash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    await this.refreshTokens.update({ tokenHash: hash }, { revokedAt: new Date() });
  }

  /** Full permission list for the authenticated user's "me" endpoint. */
  async me(userId: string) {
    const user = await this.users.findOne({
      where: { id: userId },
      relations: { role: { permissions: true } },
    });
    if (!user) throw new UnauthorizedException();
    return {
      id: user.id, fullName: user.fullName, email: user.email,
      role: user.role?.slug, roleName: user.role?.name,
      permissions: AuthService.resolvePermissions(user.role),
    };
  }
}
