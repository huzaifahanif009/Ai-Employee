import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RunEntity, WorkItemEntity } from '../database/entities';
import { InprocRunDriver } from './inproc-run-driver';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';

@Module({
  imports: [TypeOrmModule.forFeature([RunEntity, WorkItemEntity])],
  controllers: [RunsController],
  providers: [RunsService, InprocRunDriver],
  exports: [RunsService],
})
export class RunsModule {}
