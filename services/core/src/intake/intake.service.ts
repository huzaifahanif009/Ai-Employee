import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { InjectRepository } from "@nestjs/typeorm";
import { notFound } from "@praxis/contracts";
import type { WorkItemDraft } from "@praxis/contracts";
import { Repository } from "typeorm";
import { v4 as uuidv4 } from "uuid";
import { ConnectorsService } from "../connectors/connectors.service";
import { ProjectEntity } from "../database/entities";
import { RunsService } from "../runs/runs.service";
import { WorkItemsService } from "../work-items/work-items.service";

export interface SyncResult {
  polled: number;
  upserted: number;
  created: number;
  started: number;
  cursor: string | null;
}

@Injectable()
export class IntakeService {
  private readonly log = new Logger("Intake");

  constructor(
    @InjectRepository(ProjectEntity) private readonly projects: Repository<ProjectEntity>,
    private readonly connectors: ConnectorsService,
    private readonly workItems: WorkItemsService,
    private readonly runs: RunsService,
  ) {}

  @Cron("15 */1 * * * *") // once a minute at :15s
  async pollAll(): Promise<void> {
    const withTracker = await this.projects
      .createQueryBuilder("p")
      .where('p."trackerConnectorId" IS NOT NULL')
      .andWhere('p."archivedAt" IS NULL')
      .getMany();
    for (const p of withTracker) {
      try {
        await this.syncProject(p.tenantId, p.id);
      } catch (e) {
        this.log.warn(`intake poll ${p.slug}: ${(e as Error).message}`);
      }
    }
  }

  async syncProject(tenantId: string, projectId: string): Promise<SyncResult> {
    const project = await this.projects.findOne({ where: { id: projectId, tenantId } });
    if (!project) throw notFound("Project", { id: projectId });
    const resolved = await this.connectors.resolveTrackerForProject(tenantId, projectId);
    if (!resolved) return { polled: 0, upserted: 0, created: 0, started: 0, cursor: null };

    const since = project.intakeCursor ?? new Date(Date.now() - 7 * 864e5).toISOString();
    const { items, cursor } = await resolved.provider.poll(since);
    const allow = project.intake?.labelAllowlist ?? [];
    const filtered = allow.length
      ? items.filter((i) => i.labels.some((l) => allow.includes(l)))
      : items;

    let created = 0;
    let started = 0;
    for (const draft of filtered) {
      const before = await this.existing(projectId, resolved.connector.id, draft.externalId);
      const wi = await this.workItems.upsertFromDraft(tenantId, projectId, resolved.connector.id, draft);
      if (!before) {
        created++;
        if (project.intake?.mode === "auto") {
          await this.runs
            .start(this.systemCtx(tenantId), { workItemId: wi.id })
            .then(() => started++)
            .catch((e) => this.log.warn(`auto-start ${wi.id}: ${(e as Error).message}`));
        }
      }
    }

    if (cursor && cursor !== project.intakeCursor) {
      await this.projects.update({ id: projectId }, { intakeCursor: cursor });
    }
    return { polled: items.length, upserted: filtered.length, created, started, cursor };
  }

  /** Called by the webhook route — same upsert path, no cursor bump. */
  async ingest(
    tenantId: string,
    connectorId: string,
    drafts: WorkItemDraft[],
  ): Promise<{ created: number; started: number }> {
    const projects = await this.projects.find({ where: { tenantId, trackerConnectorId: connectorId } });
    let created = 0;
    let started = 0;
    for (const project of projects) {
      const allow = project.intake?.labelAllowlist ?? [];
      for (const draft of drafts) {
        if (allow.length && !draft.labels.some((l) => allow.includes(l))) continue;
        const before = await this.existing(project.id, connectorId, draft.externalId);
        const wi = await this.workItems.upsertFromDraft(tenantId, project.id, connectorId, draft);
        if (!before) {
          created++;
          if (project.intake?.mode === "auto") {
            await this.runs
              .start(this.systemCtx(tenantId), { workItemId: wi.id })
              .then(() => started++)
              .catch(() => undefined);
          }
        }
      }
    }
    return { created, started };
  }

  private async existing(projectId: string, connectorId: string, externalId: string) {
    return this.workItems.findByExternal(projectId, connectorId, externalId);
  }

  private systemCtx(tenantId: string) {
    return { userId: "00000000-0000-0000-0000-000000000000", tenantId, role: "service" as const, requestId: uuidv4() };
  }
}
