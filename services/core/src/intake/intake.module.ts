import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ProjectEntity } from "../database/entities";
import { RunsModule } from "../runs/runs.module";
import { WorkItemsModule } from "../work-items/work-items.module";
import { IntakeController, WebhooksController } from "./intake.controller";
import { IntakeService } from "./intake.service";

@Module({
  imports: [TypeOrmModule.forFeature([ProjectEntity]), WorkItemsModule, RunsModule],
  controllers: [IntakeController, WebhooksController],
  providers: [IntakeService],
  exports: [IntakeService],
})
export class IntakeModule {}
