import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';
import { Ctx, RequireCapability } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { WorkItemsService } from './work-items.service';

class CreateWorkItemDto {
  @IsString() projectId!: string;
  @IsString() title!: string;
  @IsOptional() @IsString() bodyMd?: string;
  @IsOptional() @IsArray() acceptanceCriteria?: string[];
  @IsOptional() @IsArray() labels?: string[];
  @IsOptional() @IsString() priority?: 'low' | 'normal' | 'high' | 'urgent';
}

@ApiTags('work-items')
@Controller('work-items')
export class WorkItemsController {
  constructor(private readonly workItems: WorkItemsService) {}

  @Get()
  list(
    @Ctx() ctx: RequestContext,
    @Query('projectId') projectId?: string,
    @Query('state') state?: string,
  ) {
    return this.workItems.list(ctx.tenantId, { projectId, state });
  }

  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.workItems.get(ctx.tenantId, id);
  }

  @Post()
  @RequireCapability('run:start')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateWorkItemDto) {
    return this.workItems.createManual(ctx.tenantId, dto.projectId, dto);
  }
}
