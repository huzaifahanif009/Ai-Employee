import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { Ctx, RequireCapability } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { ApprovalsService } from './approvals.service';
import { ApprovalDecision } from './approvals.types';

class DecisionDto {
  @IsIn(['approve', 'reject', 'request_replan', 'grant_budget', 'deliver_anyway'])
  decision!: ApprovalDecision;

  @IsOptional() @IsString() note?: string;

  /** e.g. { editedPlan: AgentStep[] } — used when approving a plan gate with edits */
  @IsOptional() @IsObject() payload?: Record<string, unknown>;
}

@ApiTags('approvals')
@Controller('approvals')
export class ApprovalsController {
  constructor(private readonly approvals: ApprovalsService) {}

  @Get()
  list(
    @Ctx() ctx: RequestContext,
    @Query('state') state?: string,
    @Query('runId') runId?: string,
  ) {
    return this.approvals.list(ctx.tenantId, { state, runId });
  }

  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.approvals.get(ctx.tenantId, id);
  }

  @Post(':id/decision')
  @RequireCapability('approval:decide')
  decide(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: DecisionDto) {
    return this.approvals.decide(ctx, id, dto);
  }
}
