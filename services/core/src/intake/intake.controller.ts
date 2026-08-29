import { Body, Controller, Headers, Logger, Param, Post, Req } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { PraxisError } from "@praxis/contracts";
import type { RawBodyRequest } from "@nestjs/common";
import type { Request } from "express";
import { Ctx, Public, RequireCapability } from "../common/decorators";
import { RequestContext } from "../common/request-context";
import { ConnectorsService } from "../connectors/connectors.service";
import { RunEventsService } from "../events/run-events.service";
import { RunsService } from "../runs/runs.service";
import { WorkItemsService } from "../work-items/work-items.service";
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
  private readonly log = new Logger("Webhooks");

  constructor(
    private readonly connectors: ConnectorsService,
    private readonly intake: IntakeService,
    private readonly runs: RunsService,
    private readonly workItems: WorkItemsService,
    private readonly events: RunEventsService,
  ) {}

  /**
   * Public — GitLab / GitHub project webhook. The URL carries the connector id;
   * the request is authenticated by the connector's stored webhook secret
   * (GitHub HMAC-SHA256 over the raw body, or GitLab's X-Gitlab-Token).
   */
  @Public()
  @Post(":connectorId")
  async receive(
    @Param("connectorId") connectorId: string,
    @Headers() headers: Record<string, string>,
    @Body() body: unknown,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const c = await this.connectors.findAnyById(connectorId);
    if (!c) throw new PraxisError("NOT_FOUND", "unknown connector", 404);

    const verdict = this.connectors.verifyInboundWebhook(c, headers, req.rawBody);
    if (!verdict.ok) {
      this.log.warn(`webhook ${connectorId} rejected: ${verdict.reason}`);
      throw new PraxisError("VALIDATION", `webhook rejected: ${verdict.reason}`, verdict.status ?? 401);
    }

    const results: Record<string, unknown> = {};

    // 1) tracker: issues → work items
    try {
      const tracker = this.connectors.resolveTracker(c);
      if (tracker.ingressWebhook) {
        const { event, items } = tracker.ingressWebhook(headers, body ?? {});
        if (items.length) {
          results.tracker = { event, ...(await this.intake.ingest(c.tenantId, connectorId, items)) };
        }
      }
    } catch (e) {
      this.log.warn(`tracker webhook: ${(e as Error).message}`);
    }

    // 2) vcs: PR/MR merged/closed → close the work item + source issue
    try {
      const vcs = this.connectors.resolveVcs(c);
      for (const ev of vcs.normalizeWebhook(headers, body ?? {})) {
        if (ev.type !== "git.pr.merged" && ev.type !== "git.pr.closed") continue;
        const branch = (ev.payload as { headBranch?: string }).headBranch;
        if (!branch) continue;
        const run = await this.runs.findByBranch(c.tenantId, branch);
        if (!run) continue;

        const merged = ev.type === "git.pr.merged";
        await this.events.append({
          tenantId: c.tenantId,
          runId: run.id,
          type: ev.type,
          payload: { ...ev.payload, repo: `${ev.repo.owner}/${ev.repo.name}` },
        });

        const wi = await this.workItems.findById(c.tenantId, run.workItemId);
        if (wi) {
          await this.workItems.setState(c.tenantId, wi.id, merged ? "closed" : "rejected");
          if (wi.sourceConnectorId && wi.sourceConnectorId !== "manual") {
            const src = await this.connectors.getForTenant(c.tenantId, wi.sourceConnectorId).catch(() => null);
            if (src) {
              await this.connectors
                .resolveTracker(src)
                .transition(wi.externalId, merged ? "done" : "rejected")
                .catch((e) => this.log.warn(`issue transition: ${(e as Error).message}`));
            }
          }
        }
        results.vcs = { event: ev.type, run: run.id, branch, merged };
      }
    } catch (e) {
      this.log.warn(`vcs webhook: ${(e as Error).message}`);
    }

    return { ok: true, ...results };
  }
}
