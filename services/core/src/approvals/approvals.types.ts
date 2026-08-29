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
  /** optional structured data from the decision — e.g. an edited plan on a plan gate */
  payload?: Record<string, unknown>;
}
