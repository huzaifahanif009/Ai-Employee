import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { AppConfig, CONFIG } from '../config/config';
import { MembershipEntity, TenantEntity, UserEntity } from '../database/entities';
import { Role } from '../common/rbac';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthedIdentity {
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
  name: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(CONFIG) private readonly cfg: AppConfig,
    private readonly jwt: JwtService,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(TenantEntity) private readonly tenants: Repository<TenantEntity>,
    @InjectRepository(MembershipEntity) private readonly memberships: Repository<MembershipEntity>,
  ) {}

  async register(input: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
  }): Promise<TokenPair> {
    const existing = await this.users.findOne({ where: { email: input.email.toLowerCase() } });
    if (existing) throw new UnauthorizedException('Email already registered');

    const slug = slugify(input.tenantName);
    const tenant = await this.tenants.save(
      this.tenants.create({ name: input.tenantName, slug }),
    );
    const user = await this.users.save(
      this.users.create({
        email: input.email.toLowerCase(),
        name: input.name,
        passwordHash: await argon2.hash(input.password, { type: argon2.argon2id }),
      }),
    );
    await this.memberships.save(
      this.memberships.create({ tenantId: tenant.id, userId: user.id, role: 'owner' }),
    );
    return this.issue({
      userId: user.id,
      tenantId: tenant.id,
      role: 'owner',
      email: user.email,
      name: user.name,
    });
  }

  async login(email: string, password: string, tenantId?: string): Promise<TokenPair> {
    const user = await this.users.findOne({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash || user.status !== 'active') {
      throw new UnauthorizedException('Invalid credentials');
    }
    const ok = await argon2.verify(user.passwordHash, password);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    const memberships = await this.memberships.find({ where: { userId: user.id } });
    if (memberships.length === 0) throw new UnauthorizedException('No tenant membership');
    const membership =
      (tenantId ? memberships.find((m) => m.tenantId === tenantId) : undefined) ?? memberships[0];

    user.lastLoginAt = new Date();
    await this.users.save(user);

    return this.issue({
      userId: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
      email: user.email,
      name: user.name,
    });
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    let claims: { sub: string; tid: string; typ?: string };
    try {
      claims = this.jwt.verify(refreshToken);
    } catch {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (claims.typ !== 'refresh') throw new UnauthorizedException('Not a refresh token');
    const membership = await this.memberships.findOne({
      where: { userId: claims.sub, tenantId: claims.tid },
    });
    const user = await this.users.findOne({ where: { id: claims.sub } });
    if (!membership || !user) throw new UnauthorizedException('Membership gone');
    return this.issue({
      userId: user.id,
      tenantId: membership.tenantId,
      role: membership.role,
      email: user.email,
      name: user.name,
    });
  }

  async identity(userId: string, tenantId: string): Promise<AuthedIdentity> {
    const user = await this.users.findOne({ where: { id: userId } });
    const membership = await this.memberships.findOne({ where: { userId, tenantId } });
    if (!user || !membership) throw new UnauthorizedException();
    return {
      userId,
      tenantId,
      role: membership.role,
      email: user.email,
      name: user.name,
    };
  }

  private issue(id: AuthedIdentity): TokenPair {
    const accessToken = this.jwt.sign(
      { sub: id.userId, tid: id.tenantId, role: id.role, email: id.email },
      { expiresIn: this.cfg.jwtAccessTtl },
    );
    const refreshToken = this.jwt.sign(
      { sub: id.userId, tid: id.tenantId, typ: 'refresh' },
      { expiresIn: this.cfg.jwtRefreshTtl },
    );
    return { accessToken, refreshToken, expiresIn: this.cfg.jwtAccessTtl };
  }
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 40) || `t-${Date.now().toString(36)}`
  );
}
