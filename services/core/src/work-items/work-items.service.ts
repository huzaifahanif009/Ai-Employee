import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { notFound } from '@praxis/contracts';
import { WorkItemDraft } from '@praxis/contracts';
import { Repository } from 'typeorm';
import { WorkItemEntity } from '../database/entities';

@Injectable()
export class WorkItemsService {
  constructor(
    @InjectRepository(WorkItemEntity) private readonly repo: Repository<WorkItemEntity>,
  ) {}

  list(tenantId: string, opts: { projectId?: string; state?: string } = {}) {
    const qb = this.repo
      .createQueryBuilder('w')
      .where('w.tenantId = :tenantId', { tenantId })
      .orderBy('w.createdAt', 'DESC')
      .take(200);
    if (opts.projectId) qb.andWhere('w.projectId = :projectId', { projectId: opts.projectId });
    if (opts.state) qb.andWhere('w.state = :state', { state: opts.state });
    return qb.getMany();
  }

  async get(tenantId: string, id: string) {
    const w = await this.repo.findOne({ where: { id, tenantId } });
    if (!w) throw notFound('WorkItem', { id });
    return w;
  }

  findByExternal(projectId: string, connectorId: string, externalId: string) {
    return this.repo.findOne({
      where: { projectId, sourceConnectorId: connectorId, externalId },
    });
  }

  findById(tenantId: string, id: string) {
    return this.repo.findOne({ where: { id, tenantId } });
  }

  /** Manual creation (FR-INTAKE-4). */
  createManual(
    tenantId: string,
    projectId: string,
    input: { title: string; bodyMd?: string; acceptanceCriteria?: string[]; labels?: string[]; priority?: WorkItemEntity['priority'] },
  ) {
    const w = this.repo.create({
      tenantId,
      projectId,
      sourceConnectorId: 'manual',
      externalId: `manual-${Date.now().toString(36)}`,
      externalUrl: null,
      title: input.title,
      bodyMd: input.bodyMd ?? '',
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      labels: input.labels ?? [],
      priority: input.priority ?? 'normal',
      state: 'ready',
    });
    return this.repo.save(w);
  }

  /**
   * Idempotent upsert from a tracker draft (FR-INTAKE-2,3). Phase 2 wires connectors;
   * exposed now for tests and the seed.
   */
  async upsertFromDraft(tenantId: string, projectId: string, connectorId: string, draft: WorkItemDraft) {
    const existing = await this.repo.findOne({
      where: { projectId, sourceConnectorId: connectorId, externalId: draft.externalId },
    });
    const base: Partial<WorkItemEntity> = {
      tenantId,
      projectId,
      sourceConnectorId: connectorId,
      externalId: draft.externalId,
      externalUrl: draft.externalUrl,
      title: draft.title,
      bodyMd: draft.bodyMd,
      acceptanceCriteria: draft.acceptanceCriteria,
      labels: draft.labels,
      priority: draft.priority ?? 'normal',
      assigneeExt: draft.assigneeExternalId ?? null,
      attachments: draft.attachments,
      raw: draft.raw,
    };
    if (existing) {
      Object.assign(existing, base);
      return this.repo.save(existing);
    }
    return this.repo.save(this.repo.create({ ...base, state: 'received' }));
  }

  async setState(tenantId: string, id: string, state: WorkItemEntity['state']) {
    const w = await this.get(tenantId, id);
    w.state = state;
    return this.repo.save(w);
  }
}
