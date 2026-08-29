"use client";

import { AlertTriangle, Pencil, Plus, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { useDecideApproval } from "@/lib/hooks";
import type { Approval } from "@/lib/types";
import { authErrorMessage } from "@/lib/auth";
import { countdown, shortId } from "@/lib/utils";

type PlanStep = {
  index: number;
  title: string;
  rationale?: string;
  files: string[];
  kind: "create" | "edit" | "delete";
};

function readPlan(a: Approval): PlanStep[] | null {
  const ev = a.evidence as { steps?: unknown };
  if (!Array.isArray(ev.steps)) return null;
  return ev.steps.map((s, i) => {
    const o = s as Partial<PlanStep>;
    return {
      index: i + 1,
      title: String(o.title ?? `Step ${i + 1}`),
      rationale: o.rationale ? String(o.rationale) : "",
      files: Array.isArray(o.files) ? o.files.map(String) : [],
      kind: (["create", "edit", "delete"] as const).includes(o.kind as never) ? (o.kind as PlanStep["kind"]) : "edit",
    };
  });
}

function evidenceSummary(a: Approval): string {
  const ev = a.evidence as { summary?: string };
  return ev.summary ?? JSON.stringify(a.evidence);
}

export function ApprovalCard({ approval, showRunLink = true }: { approval: Approval; showRunLink?: boolean }) {
  const decide = useDecideApproval();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const sla = countdown(approval.slaAt);

  const originalPlan = approval.type === "plan" ? readPlan(approval) : null;
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState<PlanStep[]>(originalPlan ?? []);
  const dirty = editing && JSON.stringify(steps) !== JSON.stringify(originalPlan);

  function patchStep(i: number, p: Partial<PlanStep>) {
    setSteps((cur) => cur.map((s, idx) => (idx === i ? { ...s, ...p } : s)));
  }

  async function act(decision: "approve" | "reject") {
    if (decision === "reject" && !note.trim()) {
      setShowNote(true);
      toast.error("A note is required to reject.");
      return;
    }
    const cleaned = steps
      .map((s, i) => ({ ...s, index: i + 1, files: s.files.map((f) => f.trim()).filter(Boolean) }))
      .filter((s) => s.title.trim() && s.files.length);
    const payload =
      decision === "approve" && dirty && cleaned.length ? { editedPlan: cleaned } : undefined;
    try {
      await decide.mutateAsync({ id: approval.id, decision, note: note.trim() || undefined, payload });
      toast.success(decision === "approve" ? (payload ? "Approved with edits" : "Approved") : "Rejected");
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  return (
    <div className="rounded-[10px] border border-line bg-panel-2/40 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-warn" />
          <span className="capitalize">{approval.type.replaceAll("_", " ")} approval</span>
          {showRunLink && <span className="text-muted">· run {shortId(approval.runId)}</span>}
        </div>
        <span className={sla.urgent ? "text-xs font-medium text-err" : "text-xs text-muted"}>⏱ {sla.label}</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-xs text-muted">{evidenceSummary(approval)}</p>

      {originalPlan && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">
              Plan · {steps.length} step{steps.length === 1 ? "" : "s"}
            </span>
            <button
              onClick={() => setEditing((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-accent hover:underline"
            >
              <Pencil className="h-3 w-3" />
              {editing ? "done editing" : "edit plan"}
            </button>
          </div>

          {!editing &&
            steps.map((s) => (
              <div key={s.index} className="rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs">
                <div className="font-medium">
                  #{s.index} {s.title} <span className="text-muted-2">· {s.kind}</span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted">{s.files.join(", ") || "—"}</div>
              </div>
            ))}

          {editing && (
            <div className="space-y-2">
              {steps.map((s, i) => (
                <div key={i} className="rounded-md border border-line bg-panel p-2 text-xs">
                  <div className="flex gap-2">
                    <Input
                      value={s.title}
                      onChange={(e) => patchStep(i, { title: e.target.value })}
                      placeholder="step title"
                      className="h-7 flex-1 text-xs"
                    />
                    <select
                      value={s.kind}
                      onChange={(e) => patchStep(i, { kind: e.target.value as PlanStep["kind"] })}
                      className="h-7 rounded-md border border-line bg-panel-2 px-1.5 text-xs"
                    >
                      <option value="create">create</option>
                      <option value="edit">edit</option>
                      <option value="delete">delete</option>
                    </select>
                    <button
                      onClick={() => setSteps((cur) => cur.filter((_, idx) => idx !== i))}
                      className="grid h-7 w-7 place-items-center rounded-md text-muted hover:bg-panel-2 hover:text-err"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <Input
                    value={s.files.join(", ")}
                    onChange={(e) => patchStep(i, { files: e.target.value.split(",").map((x) => x.trim()) })}
                    placeholder="comma-separated file paths"
                    className="mt-1.5 h-7 w-full font-mono text-[10px]"
                  />
                </div>
              ))}
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  setSteps((cur) => [...cur, { index: cur.length + 1, title: "", rationale: "", files: [], kind: "edit" }])
                }
              >
                <Plus className="h-3.5 w-3.5" /> add step
              </Button>
            </div>
          )}
        </div>
      )}

      {showNote && (
        <Textarea
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="note (required to reject)"
          className="mt-2 text-xs"
          rows={2}
        />
      )}

      <div className="mt-3 flex gap-2">
        <Button size="sm" onClick={() => act("approve")} disabled={decide.isPending}>
          {dirty ? "Approve with changes" : "Approve"}
        </Button>
        <Button size="sm" variant="destructive" onClick={() => act("reject")} disabled={decide.isPending}>
          Reject
        </Button>
        {!showNote && (
          <Button size="sm" variant="ghost" onClick={() => setShowNote(true)}>
            + note
          </Button>
        )}
      </div>
    </div>
  );
}
