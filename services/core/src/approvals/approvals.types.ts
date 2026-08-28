export type ApprovalDecision =
  | 'approve'
  | 'reject'
  | 'request_replan'
  | 'grant_budget'
  | 'deliver_anyway';

export interface GateDecisionResult {
  decision: ApprovalDecision;
  note?: string;
  decidedBy: string;
}
