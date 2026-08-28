import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApprovalsModule } from "../approvals/approvals.module";
import { ModelCallEntity, RunEntity } from "../database/entities";
import { ModelController, RunModelCallsController } from "./model.controller";
import { ModelRouterService } from "./model-router.service";

export const MODEL_ROUTER = Symbol("MODEL_ROUTER");

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ModelCallEntity, RunEntity]), ApprovalsModule],
  controllers: [ModelController, RunModelCallsController],
  providers: [
    ModelRouterService,
    { provide: MODEL_ROUTER, useExisting: ModelRouterService },
  ],
  exports: [ModelRouterService, MODEL_ROUTER],
})
export class ModelModule {}
