import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  ApprovalEntity,
  ModelCallEntity,
  RunEntity,
  RunEventEntity,
  ToolCallEntity,
  WorkItemEntity,
} from '../database/entities';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      RunEntity,
      RunEventEntity,
      ModelCallEntity,
      ToolCallEntity,
      ApprovalEntity,
      WorkItemEntity,
    ]),
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
