import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Capability } from './rbac';
import { RequestContext } from './request-context';

export const REQUIRE_CAP = 'praxis:requireCapability';
/** Declare the capability a route requires. A test enumerates routes vs this metadata. */
export const RequireCapability = (cap: Capability) => SetMetadata(REQUIRE_CAP, cap);

export const IS_PUBLIC = 'praxis:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const Ctx = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): RequestContext => {
    const req = ctx.switchToHttp().getRequest();
    return req.praxisCtx as RequestContext;
  },
);
