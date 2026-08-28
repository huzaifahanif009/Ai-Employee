import { AsyncLocalStorage } from 'node:async_hooks';
import { Role } from './rbac';

export interface RequestContext {
  userId: string;
  tenantId: string;
  role: Role;
  requestId: string;
}

const als = new AsyncLocalStorage<RequestContext>();

export const RequestContextStore = {
  run<T>(ctx: RequestContext, fn: () => T): T {
    return als.run(ctx, fn);
  },
  get(): RequestContext | undefined {
    return als.getStore();
  },
  require(): RequestContext {
    const ctx = als.getStore();
    if (!ctx) throw new Error('No request context (called outside a request scope)');
    return ctx;
  },
};
