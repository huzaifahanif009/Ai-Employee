import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { Ctx, RequireCapability } from '../common/decorators';
import { RequestContext } from '../common/request-context';
import { ProjectsService } from './projects.service';

class CreateProjectDto {
  @IsString() name!: string;
  @IsOptional() @IsString() slug?: string;
  @IsOptional() @IsObject() repoRef?: { provider: string; owner: string; name: string; path?: string };
  @IsOptional() @IsString() vcsConnectorId?: string | null;
  @IsOptional() @IsString() baseBranch?: string;
  @IsOptional() @IsObject() verifyPipeline?: Record<string, string>;
  @IsOptional() @IsObject() intake?: any;
  @IsOptional() @IsString() branchTemplate?: string;
  @IsOptional() @IsString() policyPreset?: 'Conservative' | 'Balanced' | 'Autonomous';
  @IsOptional() @IsObject() budgets?: Record<string, number>;
}

@ApiTags('projects')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Get()
  list(@Ctx() ctx: RequestContext) {
    return this.projects.list(ctx.tenantId);
  }

  @Get(':id')
  get(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.projects.get(ctx.tenantId, id);
  }

  @Get(':id/readiness')
  readiness(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.projects.readiness(ctx.tenantId, id);
  }

  @Post()
  @RequireCapability('project:write')
  create(@Ctx() ctx: RequestContext, @Body() dto: CreateProjectDto) {
    return this.projects.create(ctx.tenantId, dto);
  }

  @Patch(':id')
  @RequireCapability('project:write')
  update(@Ctx() ctx: RequestContext, @Param('id') id: string, @Body() dto: Partial<CreateProjectDto>) {
    return this.projects.update(ctx.tenantId, id, dto);
  }

  @Post(':id/archive')
  @RequireCapability('project:write')
  archive(@Ctx() ctx: RequestContext, @Param('id') id: string) {
    return this.projects.archive(ctx.tenantId, id);
  }
}
