import { Body, Controller, Headers, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { Ctx, Public, RequireCapability } from "../common/decorators";
import { RequestContext } from "../common/request-context";
import { ConnectorsService } from "../connectors/connectors.service";
import { IntakeService } from "./intake.service";

@ApiTags("intake")
@Controller("projects")
export class IntakeController {
  constructor(private readonly intake: IntakeService) {}

  @Post(":id/intake/sync")
  @RequireCapability("run:start")
  sync(@Ctx() ctx: RequestContext, @Param("id") id: string) {
    return this.intake.syncProject(ctx.tenantId, id);
  }
}

@ApiTags("webhooks")
@Controller("webhooks/in")
export class WebhooksController {
  constructor(
    private readonly connectors: ConnectorsService,
    private readonly intake: IntakeService,
  ) {}

  /** Public — GitLab project webhook. URL carries the connector id; optional x-gitlab-token check. */
  @Public()
  @Post(":connectorId")
  async receive(
    @Param("connectorId") connectorId: string,
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const c = await this.connectors.findAnyById(connectorId);
    if (!c) return { ok: false, reason: "unknown connector" };

    const expected = (c.config.webhookSecret as string | undefined) ?? "";
    if (expected && headers["x-gitlab-token"] !== expected) {
      return { ok: false, reason: "bad token" };
    }

    const provider = this.connectors.resolveTracker(c);
    if (!provider.ingressWebhook) return { ok: true, ignored: true };
    const { event, items } = provider.ingressWebhook(headers, body ?? {});
    if (items.length === 0) return { ok: true, event, ignored: true };
    const res = await this.intake.ingest(c.tenantId, connectorId, items);
    return { ok: true, event, ...res, ip: req.ip };
  }
}
