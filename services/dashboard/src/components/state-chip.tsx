import { Badge } from "@/components/ui/badge";

const RUN_STATE_VARIANT: Record<string, "default" | "accent" | "ok" | "warn" | "err" | "muted"> = {
  queued: "muted",
  planning: "accent",
  awaiting_plan_approval: "warn",
  executing: "accent",
  verifying: "accent",
  reviewing: "accent",
  awaiting_delivery_approval: "warn",
  delivering: "accent",
  succeeded: "ok",
  failed: "err",
  cancelled: "muted",
  timed_out: "err",
};

const WORK_ITEM_VARIANT: Record<string, "default" | "accent" | "ok" | "warn" | "err" | "muted"> = {
  received: "muted",
  triaging: "accent",
  ready: "accent",
  needs_info: "warn",
  rejected: "err",
  in_progress: "accent",
  delivered: "ok",
  failed: "err",
  closed: "muted",
};

const APPROVAL_VARIANT: Record<string, "default" | "accent" | "ok" | "warn" | "err" | "muted"> = {
  open: "warn",
  approved: "ok",
  rejected: "err",
  expired: "muted",
  auto_resolved: "ok",
};

export function RunStateChip({ state }: { state: string }) {
  return (
    <Badge variant={RUN_STATE_VARIANT[state] ?? "default"}>{state.replaceAll("_", " ")}</Badge>
  );
}

export function WorkItemStateChip({ state }: { state: string }) {
  return (
    <Badge variant={WORK_ITEM_VARIANT[state] ?? "default"}>{state.replaceAll("_", " ")}</Badge>
  );
}

export function ApprovalStateChip({ state }: { state: string }) {
  return (
    <Badge variant={APPROVAL_VARIANT[state] ?? "default"}>{state.replaceAll("_", " ")}</Badge>
  );
}
