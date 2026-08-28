import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { Ctx } from "../common/decorators";
import { RequestContext } from "../common/request-context";
import { ModelRouterService } from "./model-router.service";

@ApiTags("model")
@Controller("model")
export class ModelController {
  constructor(private readonly router: ModelRouterService) {}

  @Get("catalog")
  catalog() {
    return this.router.catalog();
  }

  @Get("health")
  health() {
    return this.router.healthCheck();
  }

  @Get("calls")
  callsForRun(@Ctx() ctx: RequestContext, @Query("runId") runId: string) {
    return this.router.ledgerForRun(ctx.tenantId, runId);
  }
}

@ApiTags("runs")
@Controller("runs")
export class RunModelCallsController {
  constructor(private readonly router: ModelRouterService) {}

  @Get(":id/model-calls")
  list(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.router.ledgerForRun(ctx.tenantId, id);
  }
}
