import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApprovalEntity, ApprovalType } from '../database/entities/approval.entity';
import { RunEventsService } from '../events/run-events.service';
import { GateDecisionResult } from './approvals.types';

export interface RaiseInput {
  tenantId: string;
  runId: string;
  runStepId?: string;
  type: ApprovalType;
  evidence: Record<string, unknown>;
  actionPreview: Record<string, unknown>;
  slaSeconds?: number;
}

/**
 * The HITL primitive (prd/06 §5, FR-APPROVE-1..6): persist an Approval, emit the event,
 * and — for the in-process driver — hand back a promise that resolves the moment a human
 * decides (or the SLA lapses). A Temporal-driven Run (Phase 2+) uses the same `create()` to
 * raise the row/event but resumes via a workflow *signal* instead of this in-memory waiter.
 */
@Injectable()
export class ApprovalGateService {
  private readonly log = new Logger('ApprovalGate');
  private waiters = new Map<string, (d: GateDecisionResult) => void>(); // approvalId -> resolver

  constructor(
    @InjectRepository(ApprovalEntity) private readonly repo: Repository<ApprovalEntity>,
    private readonly events: RunEventsService,
  ) {}

  async create(input: RaiseInput): Promise<ApprovalEntity> {
    const slaAt = new Date(Date.now() + (input.slaSeconds ?? 24 * 3600) * 1000);
    const approval = await this.repo.save(
      this.repo.create({
        tenantId: input.tenantId,
        runId: input.runId,
        runStepId: input.runStepId ?? null,
        type: input.type,
        state: 'open',
        evidence: input.evidence,
        actionPreview: input.actionPreview,
        slaAt,
        channel: 'dashboard',
      }),
    );
    await this.events.append({
      tenantId: input.tenantId,
      runId: input.runId,
      type: 'approval.requested',
      payload: {
        approvalId: approval.id,
        runId: input.runId,
        type: input.type,
        evidence: input.evidence,
        actionPreview: input.actionPreview,
        slaAt: slaAt.toISOString(),
      },
    });
    return approval;
  }

  /** Raise + block the caller until a decision arrives or the SLA expires (in-process drivers only). */
  async raiseAndWait(input: RaiseInput, timeoutMs = 2 * 24 * 60 * 60 * 1000): Promise<GateDecisionResult> {
    const approval = await this.create({ ...input, slaSeconds: Math.floor(timeoutMs / 1000) });
    return new Promise<GateDecisionResult>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(approval.id);
        this.expire(approval.id)
          .catch((e) => this.log.warn(`expire ${approval.id}: ${(e as Error).message}`))
          .finally(() =>
            resolve({ decision: 'reject', note: 'SLA expired', decidedBy: 'system' }),
          );
      }, timeoutMs);
      this.waiters.set(approval.id, (d) => {
        clearTimeout(timer);
        resolve(d);
      });
    });
  }

  /** Called by ApprovalsService after persisting a human decision. Wakes an in-process waiter, if any. */
  notifyDecided(approvalId: string, decision: GateDecisionResult): void {
    const w = this.waiters.get(approvalId);
    if (w) {
      this.waiters.delete(approvalId);
      w(decision);
    }
  }

  private async expire(approvalId: string): Promise<void> {
    const a = await this.repo.findOne({ where: { id: approvalId } });
    if (a && a.state === 'open') {
      a.state = 'expired';
      a.decidedAt = new Date();
      await this.repo.save(a);
      await this.events.append({
        tenantId: a.tenantId,
        runId: a.runId,
        type: 'approval.expired',
        payload: { approvalId: a.id, runId: a.runId },
      });
    }
  }
}
