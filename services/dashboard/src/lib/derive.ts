import type { StreamEvent } from "./sse";

export interface PlanStep {
  index: number;
  title: string;
  riskTier?: string;
}
export interface PlanView {
  version: number;
  stepCount: number;
  filesEstimate: string[];
  risk: string;
  steps: PlanStep[];
}

export function derivePlan(events: StreamEvent[]): PlanView | null {
  const created = [...events].reverse().find((e) => e.type === "plan.created");
  if (!created) return null;
  const steps = events
    .filter((e) => e.type === "plan.step_defined")
    .map((e) => ({
      index: Number(e.payload.index),
      title: String(e.payload.title ?? ""),
      riskTier: e.payload.riskTier as string | undefined,
    }))
    .sort((a, b) => a.index - b.index);
  const uniq = Array.from(new Map(steps.map((s) => [s.index, s])).values());
  return {
    version: Number(created.payload.version ?? 1),
    stepCount: Number(created.payload.stepCount ?? uniq.length),
    filesEstimate: (created.payload.filesEstimate as string[]) ?? [],
    risk: String(created.payload.risk ?? "unknown"),
    steps: uniq,
  };
}

export interface StepView {
  index: number;
  title: string;
  role: string;
  state: "running" | "succeeded" | "failed";
  toolCalls: { tool: string; status: string; output: string }[];
  messages: string[];
}

export function deriveSteps(events: StreamEvent[]): StepView[] {
  const byId = new Map<string, StepView & { stepId: string }>();
  const order: string[] = [];
  for (const e of events) {
    const p = e.payload;
    const stepId = p.stepId as string | undefined;
    if (e.type === "run_step.started" && stepId) {
      order.push(stepId);
      byId.set(stepId, {
        stepId,
        index: Number(p.index),
        title: String(p.title ?? ""),
        role: String(p.role ?? ""),
        state: "running",
        toolCalls: [],
        messages: [],
      });
    } else if (e.type === "message.delta" && stepId && byId.has(stepId)) {
      byId.get(stepId)!.messages.push(String(p.deltaText ?? ""));
    } else if (e.type === "tool_call.finished" && stepId && byId.has(stepId)) {
      byId.get(stepId)!.toolCalls.push({
        tool: String(p.tool ?? p.toolCallId ?? ""),
        status: String(p.status ?? ""),
        output: String(p.outputPreview ?? ""),
      });
    } else if (e.type === "run_step.finished" && stepId && byId.has(stepId)) {
      byId.get(stepId)!.state = p.state === "succeeded" ? "succeeded" : "failed";
    }
  }
  return order.map((id) => byId.get(id)!);
}

export interface VerifyCheck {
  check: string;
  status: "running" | "pass" | "fail";
  summary?: string;
}
export function deriveVerification(events: StreamEvent[]): {
  overall: string | null;
  checks: VerifyCheck[];
} {
  const checks = new Map<string, VerifyCheck>();
  let overall: string | null = null;
  for (const e of events) {
    const p = e.payload;
    if (e.type === "verify.check_started") {
      checks.set(String(p.check), { check: String(p.check), status: "running" });
    } else if (e.type === "verify.check_finished") {
      checks.set(String(p.check), {
        check: String(p.check),
        status: p.result === "pass" ? "pass" : "fail",
        summary: p.summary as string | undefined,
      });
    } else if (e.type === "verify.finished") {
      overall = String(p.overall ?? "");
    }
  }
  return { overall, checks: Array.from(checks.values()) };
}

export interface ReviewFinding {
  severity: string;
  message: string;
}
export function deriveReview(
  events: StreamEvent[],
): { verdict: string; findings: ReviewFinding[] } | null {
  const finished = [...events].reverse().find((e) => e.type === "review.finished");
  if (!finished) return null;
  return {
    verdict: String(finished.payload.verdict ?? ""),
    findings: (finished.payload.findings as ReviewFinding[]) ?? [],
  };
}

export interface DeliveryView {
  branch?: string;
  headSha?: string;
  prNumber?: number;
  prUrl?: string;
  prState?: string;
}
export function deriveDelivery(events: StreamEvent[]): DeliveryView {
  const out: DeliveryView = {};
  for (const e of events) {
    const p = e.payload;
    if (e.type === "git.branch.created") out.branch = String(p.branch ?? "");
    if (e.type === "git.pushed") out.headSha = String(p.headSha ?? "");
    if (e.type === "vcs.pr.opened" || e.type === "vcs.pr.updated") {
      out.prNumber = Number(p.prNumber);
      out.prUrl = String(p.url ?? "");
      out.prState = String(p.state ?? "");
    }
  }
  return out;
}
