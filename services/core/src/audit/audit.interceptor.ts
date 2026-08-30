import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, tap } from 'rxjs';
import { REQUIRE_CAP } from '../common/decorators';
import type { RequestContext } from '../common/request-context';
import { AuditService } from './audit.service';

const SKIP_PATHS = [/\/healthz$/, /\/readyz$/, /\/auth\/(login|refresh|register)$/, /\/streams\//, /\/webhooks\/in\//];
const SECRET_KEY = /token|secret|password|apikey|api_key|credential|content|ciphertext/i;

function redact(v: unknown, depth = 0): unknown {
  if (v == null || depth > 3) return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  if (typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(val, depth + 1);
    }
    return out;
  }
  if (typeof v === 'string' && v.length > 300) return v.slice(0, 300) + '…';
  return v;
}

/**
 * Records every successful state-changing request to the hash-chained audit log.
 * Read requests, auth, streams and inbound webhooks are skipped.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(
    private readonly audit: AuditService,
    private readonly reflector: Reflector,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const method: string = req.method ?? 'GET';
    const path: string = req.originalUrl ?? req.url ?? '';

    const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    const skip = SKIP_PATHS.some((re) => re.test(path));
    const rc: RequestContext | undefined = req.praxisCtx;

    if (!mutating || skip || !rc) return next.handle();

    const cap = this.reflector.getAllAndOverride<string | undefined>(REQUIRE_CAP, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const routePath: string = req.route?.path ?? path.split('?')[0];

    return next.handle().pipe(
      tap((body) => {
        void this.audit.record({
          tenantId: rc.tenantId,
          actor: { kind: 'user', id: rc.userId, display: rc.role },
          action: `${method} ${routePath}`,
          target: {
            path: path.split('?')[0],
            params: req.params ?? {},
            capability: cap ?? null,
          },
          after: redact(pickSummary(body)) as Record<string, unknown> | null,
        });
      }),
    );
  }
}

/** keep only a small, useful slice of the response */
function pickSummary(body: unknown): Record<string, unknown> | null {
  if (body == null || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const keys = ['id', 'state', 'status', 'decision', 'name', 'kind', 'ok', 'alias', 'branchName'];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k in b) out[k] = b[k];
  return Object.keys(out).length ? out : null;
}
