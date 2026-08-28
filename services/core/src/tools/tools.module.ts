import { Global, Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { ApprovalsModule } from "../approvals/approvals.module";
import { ToolCallEntity } from "../database/entities";
import { SandboxModule } from "../sandbox/sandbox.module";
import { ToolBrokerService } from "./tool-broker.service";
import { ToolsController, RunToolCallsController } from "./tools.controller";

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([ToolCallEntity]), SandboxModule, ApprovalsModule],
  controllers: [ToolsController, RunToolCallsController],
  providers: [ToolBrokerService],
  exports: [ToolBrokerService],
})
export class ToolsModule {}
