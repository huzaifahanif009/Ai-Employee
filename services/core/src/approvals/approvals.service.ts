import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { notFound, PraxisError } from '@praxis/contracts';
import { Repository } from 'typeorm';
import { RequestContext } from '../common/request-context';
import { ApprovalEntity } from '../database/entities/approval.entity';
import { RunEventsService } from '../events/run-events.service';
import { requiresNote } from './approval-rules';
import { ApprovalGateService } from './approval-gate.service';
import { ApprovalDecision } from './approvals.types';

export interface DecisionInput {
  decision: ApprovalDecision;
  note?: string;
}

@Injectable()
export class ApprovalsService {
  constructor(
    @InjectRepository(ApprovalEntity) private readonly repo: Repository<ApprovalEntity>,
    private readonly gate: ApprovalGateService,
    private readonly events: RunEventsService,
  ) {}

  list(tenantId: string, opts: { state?: string; runId?: string } = {}) {
    const qb = this.repo
      .createQueryBuilder('a')
      .where('a.tenantId = :tenantId', { tenantId })
      .orderBy('a.slaAt', 'ASC')
      .take(100);
    if (opts.state) qb.andWhere('a.state = :state', { state: opts.state });
    if (opts.runId) qb.andWhere('a.runId = :runId', { runId: opts.runId });
    return qb.getMany();
  }

  async get(tenantId: string, id: string) {
    const a = await this.repo.findOne({ where: { id, tenantId } });
    if (!a) throw notFound('Approval', { id });
    return a;
  }

  async decide(ctx: RequestContext, id: string, input: DecisionInput): Promise<ApprovalEntity> {
    const approval = await this.get(ctx.tenantId, id);
    if (approval.state !== 'open') {
      throw new PraxisError('CONFLICT', `Approval already ${approval.state}`, 409, {
        state: approval.state,
      });
    }
    if (requiresNote(input.decision) && !input.note?.trim()) {
      throw new PraxisError('VALIDATION', 'A note is required to reject or override', 400, {
        decision: input.decision,
      });
    }

    approval.state = input.decision === 'reject' ? 'rejected' : 'approved';
    approval.decidedAt = new Date();
    approval.decidedBy = ctx.userId;
    approval.decisionNote = input.note ?? null;
    await this.repo.save(approval);

    await this.events.append({
      tenantId: ctx.tenantId,
      runId: approval.runId,
      type: 'approval.decided',
      payload: {
        approvalId: approval.id,
        runId: approval.runId,
        decision: input.decision,
        decidedBy: ctx.userId,
        note: input.note,
      },
      actor: { kind: 'user', id: ctx.userId },
    });

    this.gate.notifyDecided(approval.id, {
      decision: input.decision,
      note: input.note,
      decidedBy: ctx.userId,
    });

    return approval;
  }
}
