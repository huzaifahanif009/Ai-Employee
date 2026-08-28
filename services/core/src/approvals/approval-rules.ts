import { ApprovalDecision } from './approvals.types';

/** prd/14 §8 — rejecting or overriding a gate requires a rationale in the audit trail. */
export function requiresNote(decision: ApprovalDecision): boolean {
  return decision === 'reject' || decision === 'deliver_anyway';
}
