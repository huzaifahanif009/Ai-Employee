"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { useDecideApproval } from "@/lib/hooks";
import type { Approval } from "@/lib/types";
import { authErrorMessage } from "@/lib/auth";
import { countdown, shortId } from "@/lib/utils";

function evidenceSummary(a: Approval): string {
  const ev = a.evidence as { summary?: string; steps?: { index: number; title: string }[] };
  if (ev.summary) return ev.summary;
  if (ev.steps) return ev.steps.map((s) => `#${s.index} ${s.title}`).join("\n");
  return JSON.stringify(a.evidence);
}

export function ApprovalCard({ approval, showRunLink = true }: { approval: Approval; showRunLink?: boolean }) {
  const decide = useDecideApproval();
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const sla = countdown(approval.slaAt);

  async function act(decision: "approve" | "reject") {
    if (decision === "reject" && !note.trim()) {
      setShowNote(true);
      toast.error("A note is required to reject.");
      return;
    }
    try {
      await decide.mutateAsync({ id: approval.id, decision, note: note.trim() || undefined });
      toast.success(decision === "approve" ? "Approved" : "Rejected");
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  return (
    <div className="rounded-lg border border-line bg-bg p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <AlertTriangle className="h-4 w-4 text-warn" />
          <span className="capitalize">{approval.type.replaceAll("_", " ")} approval</span>
          {showRunLink && <span className="text-muted">· run {shortId(approval.runId)}</span>}
        </div>
        <span className={sla.urgent ? "text-xs font-medium text-err" : "text-xs text-muted"}>
          ⏱ {sla.label}
        </span>
      </div>
      <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-muted">{evidenceSummary(approval)}</pre>

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
          Approve
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
