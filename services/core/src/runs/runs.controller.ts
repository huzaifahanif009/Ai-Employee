import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional, IsString } from 'class-validator';
import { Ctx, RequireCapability } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { RunsService } from './runs.service';

class StartRunDto {
  @IsString() workItemId!: string;
  @IsOptional() @IsString() projectId?: string;
  @IsOptional() @IsObject() budgetOverride?: Record<string, number>;
  @IsOptional() @IsIn(['low', 'normal', 'high']) priority?: 'low' | 'normal' | 'high';
}
class ControlDto {
  @IsOptional() @IsString() reason?: string;
  @IsOptional() @IsString() text?: string;
}

@ApiTags('runs')
@Controller('runs')
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Get()
  list(
    @Ctx() ctx: RequestContext,
    @Query('projectId') projectId?: string,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.runs.list(ctx.tenantId, {
      projectId,
      state: state ? state.split(',') : undefined,
      limit: limit ? Number(limit) : undefined,
      cursor,
    });
  }

  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.runs.get(ctx.tenantId, id);
  }

  @Get(':id/events')
  events(
    @Ctx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('afterSeq') afterSeq?: string,
    @Query('limit') limit?: string,
  ) {
    return this.runs.listEvents(
      ctx.tenantId,
      id,
      afterSeq ? Number(afterSeq) : 0,
      limit ? Number(limit) : 200,
    );
  }

  @Post()
  @RequireCapability('run:start')
  start(@Ctx() ctx: RequestContext, @Body() dto: StartRunDto) {
    return this.runs.start(ctx, dto);
  }

  @Post(':id/pause')
  @RequireCapability('run:control')
  pause(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ControlDto) {
    return this.runs.control(ctx, id, 'pause', dto);
  }

  @Post(':id/resume')
  @RequireCapability('run:control')
  resume(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.runs.control(ctx, id, 'resume', {});
  }

  @Post(':id/comment')
  @RequireCapability('run:control')
  comment(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ControlDto) {
    return this.runs.control(ctx, id, 'comment', dto);
  }

  @Post(':id/cancel')
  @RequireCapability('run:control')
  cancel(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ControlDto) {
    return this.runs.control(ctx, id, 'cancel', dto);
  }
}
