/** Canonical error codes surfaced by the API (RFC 9457 `code`) and internal layers. */
export type PraxisErrorCode =
  | 'RBAC_DENIED'
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'CONFLICT'
  | 'IDEMPOTENCY_REPLAY'
  | 'BUDGET_EXCEEDED'
  | 'PROJECT_NOT_READY'
  | 'PROVIDER_UNAVAILABLE'
  | 'POLICY_BLOCK'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_EXPIRED'
  | 'SANDBOX_ERROR'
  | 'VCS_ERROR'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export class PraxisError extends Error {
  constructor(
    public readonly code: PraxisErrorCode,
    message: string,
    public readonly status = 500,
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'PraxisError';
  }
}

export const notFound = (what: string, meta: Record<string, unknown> = {}) =>
  new PraxisError('NOT_FOUND', `${what} not found`, 404, meta);

export const rbacDenied = (capability: string) =>
  new PraxisError('RBAC_DENIED', `Requires capability: ${capability}`, 403, { capability });

export const budgetExceeded = (meta: Record<string, unknown>) =>
  new PraxisError('BUDGET_EXCEEDED', 'Run budget exceeded', 409, meta);
