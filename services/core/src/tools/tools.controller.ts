import { Controller, Get, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Ctx } from "../common/decorators";
import { RequestContext } from "../common/request-context";
import { ToolBrokerService } from "./tool-broker.service";

@ApiTags("tools")
@Controller("tools")
export class ToolsController {
  constructor(private readonly broker: ToolBrokerService) {}

  @Get("catalog")
  catalog() {
    return this.broker.list();
  }
}

@ApiTags("runs")
@Controller("runs")
export class RunToolCallsController {
  constructor(private readonly broker: ToolBrokerService) {}

  @Get(":id/tool-calls")
  list(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.broker.ledgerForRun(ctx.tenantId, id);
  }
}
