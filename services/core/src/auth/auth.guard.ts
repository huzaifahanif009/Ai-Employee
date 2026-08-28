import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { v4 as uuidv4 } from 'uuid';
import { IS_PUBLIC, REQUIRE_CAP } from '../common/decorators';
import { Capability, Role, roleHas } from '../common/rbac';
import { RequestContext } from '../common/request-context';

/**
 * Global guard: skips @Public, validates the JWT, builds the RequestContext,
 * and enforces @RequireCapability metadata (prd/14 §3, US-5.3).
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const raw = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (!raw) throw new UnauthorizedException('Missing bearer token');

    let claims: { sub: string; tid: string; role: Role };
    try {
      claims = this.jwt.verify(raw);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const rc: RequestContext = {
      userId: claims.sub,
      tenantId: claims.tid,
      role: claims.role,
      requestId: (req.headers['x-request-id'] as string) || uuidv4(),
    };
    req.praxisCtx = rc;

    const cap = this.reflector.getAllAndOverride<Capability | undefined>(REQUIRE_CAP, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (cap && !roleHas(rc.role, cap)) {
      throw new ForbiddenException(`Requires capability: ${cap}`);
    }
    return true;
  }
}
