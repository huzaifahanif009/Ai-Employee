import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Ctx, RequireCapability } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { AuditService } from './audit.service';

@ApiTags('audit')
@Controller('audit')
@RequireCapability('tenant:admin')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  list(
    @Ctx() ctx: RequestContext,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
    @Query('action') action?: string,
    @Query('actorId') actorId?: string,
  ) {
    return this.audit.list(ctx.tenantId, {
      limit: limit ? Number(limit) : undefined,
      cursor,
      action,
      actorId,
    });
  }

  @Get('verify')
  verify(@Ctx() ctx: RequestContext) {
    return this.audit.verifyChain(ctx.tenantId);
  }
}
