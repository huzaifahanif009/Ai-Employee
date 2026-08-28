import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ApprovalEntity } from '../database/entities/approval.entity';
import { ApprovalGateService } from './approval-gate.service';
import { ApprovalsController } from './approvals.controller';
import { ApprovalsService } from './approvals.service';

@Module({
  imports: [TypeOrmModule.forFeature([ApprovalEntity])],
  controllers: [ApprovalsController],
  providers: [ApprovalsService, ApprovalGateService],
  exports: [ApprovalGateService, ApprovalsService],
})
export class ApprovalsModule {}
