import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalsModule } from '../approvals/approvals.module';
import { ModelCallEntity, RunEntity, ToolCallEntity, WorkItemEntity } from '../database/entities';
import { WorkItemsModule } from '../work-items/work-items.module';
import { CoderAgentService } from './coder-agent.service';
import { ControlGateway } from './control.gateway';
import { InprocRunDriver } from './inproc-run-driver';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([RunEntity, WorkItemEntity, ModelCallEntity, ToolCallEntity]),
    ApprovalsModule,
    WorkItemsModule,
  ],
  controllers: [RunsController],
  providers: [RunsService, InprocRunDriver, ControlGateway, CoderAgentService],
  exports: [RunsService],
})
export class RunsModule {}
