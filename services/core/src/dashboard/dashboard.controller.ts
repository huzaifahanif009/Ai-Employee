import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Ctx, RequireCapability } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { DashboardService } from './dashboard.service';

@ApiTags('dashboard')
@Controller('dashboard')
@RequireCapability('dashboard:read')
export class DashboardController {
  constructor(private readonly dash: DashboardService) {}

  @Get('overview')
  overview(@Ctx() ctx: RequestContext) {
    return this.dash.overview(ctx.tenantId);
  }

  @Get('timeseries')
  timeseries(@Ctx() ctx: RequestContext, @Query('hours') hours?: string) {
    return this.dash.timeseries(ctx.tenantId, Math.min(Math.max(Number(hours) || 24, 1), 168));
  }

  @Get('activity')
  activity(@Ctx() ctx: RequestContext, @Query('limit') limit?: string) {
    return this.dash.activity(ctx.tenantId, Math.min(Math.max(Number(limit) || 40, 1), 200));
  }

  @Get('workload')
  workload(@Ctx() ctx: RequestContext) {
    return this.dash.workload(ctx.tenantId);
  }
}
