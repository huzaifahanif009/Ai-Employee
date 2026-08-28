import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { notFound } from '@praxis/contracts';
import { Repository } from 'typeorm';
import { ProjectEntity } from '../database/entities';

export interface CreateProjectInput {
  name: string;
  slug?: string;
  repoRef?: { provider: string; owner: string; name: string; path?: string } | null;
  vcsConnectorId?: string | null;
  trackerConnectorId?: string | null;
  baseBranch?: string;
  pathScope?: string | null;
  verifyPipeline?: Record<string, string>;
  intake?: ProjectEntity['intake'];
  branchTemplate?: string;
  policyPreset?: ProjectEntity['policyPreset'];
  budgets?: Record<string, number>;
}

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(ProjectEntity) private readonly repo: Repository<ProjectEntity>,
  ) {}

  list(tenantId: string) {
    return this.repo.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
    });
  }

  async get(tenantId: string, id: string) {
    const p = await this.repo.findOne({ where: { id, tenantId } });
    if (!p) throw notFound('Project', { id });
    return p;
  }

  create(tenantId: string, input: CreateProjectInput) {
    const slug = input.slug ?? slugify(input.name);
    const p = this.repo.create({
      tenantId,
      name: input.name,
      slug,
      repoRef: input.repoRef ?? null,
      baseBranch: input.baseBranch ?? 'main',
      pathScope: input.pathScope ?? null,
      verifyPipeline: input.verifyPipeline ?? {},
      intake: input.intake ?? { mode: 'manual', labelAllowlist: [] },
      branchTemplate: input.branchTemplate ?? 'praxis/{{tracker-key}}-{{slug}}',
      policyPreset: input.policyPreset ?? 'Balanced',
      budgets: input.budgets ?? {},
    });
    return this.repo.save(p);
  }

  async update(tenantId: string, id: string, patch: Partial<CreateProjectInput>) {
    const p = await this.get(tenantId, id);
    Object.assign(p, patch);
    return this.repo.save(p);
  }

  async archive(tenantId: string, id: string) {
    const p = await this.get(tenantId, id);
    p.archivedAt = new Date();
    return this.repo.save(p);
  }

  /** Minimal readiness check (US-1.4 AC4) — expands in Phase 2. */
  async readiness(tenantId: string, id: string) {
    const p = await this.get(tenantId, id);
    return {
      repoConfigured: !!p.repoRef,
      testCommandDetected: !!(p.verifyPipeline.unit || p.verifyPipeline.build),
      intakeConfigured: p.intake.mode === 'manual' || p.intake.labelAllowlist.length > 0,
      ok: !!p.repoRef && !!(p.verifyPipeline.unit || p.verifyPipeline.build),
    };
  }
}

function slugify(s: string): string {
  return (
    s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40) ||
    `p-${Date.now().toString(36)}`
  );
}
