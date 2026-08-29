import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalsModule } from '../approvals/approvals.module';
import { RunEntity, WorkItemEntity } from '../database/entities';
import { WorkItemsModule } from '../work-items/work-items.module';
import { ControlGateway } from './control.gateway';
import { InprocRunDriver } from './inproc-run-driver';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [TypeOrmModule.forFeature([RunEntity, WorkItemEntity]), ApprovalsModule, WorkItemsModule],
  controllers: [RunsController],
  providers: [RunsService, InprocRunDriver, ControlGateway],
  exports: [RunsService],
})
export class RunsModule {}
