"use client";

import {
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  FileCode2,
  Loader2,
  Minus,
  Wrench,
  X,
} from "lucide-react";
import { useState } from "react";
import { Meter } from "@/components/charts";
import { Badge } from "@/components/ui/badge";
import { useRunSteps } from "@/lib/hooks";
import type { RunStepDetail } from "@/lib/types";
import { formatTokens, formatUsd } from "@/lib/utils";

const STATE_ICON = {
  succeeded: { icon: Check, cls: "text-ok bg-ok/12" },
  no_changes: { icon: Minus, cls: "text-warn bg-warn/12" },
  failed: { icon: X, cls: "text-err bg-err/12" },
  pending: { icon: CircleDot, cls: "text-muted-2 bg-panel-2" },
} as const;

function ToolRow({ t }: { t: RunStepDetail["toolCalls"][number] }) {
  const [open, setOpen] = useState(false);
  const bad = t.status !== "ok";
  return (
    <div className="rounded-md border border-line bg-panel">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs"
      >
        <ChevronRight className={`h-3 w-3 shrink-0 text-muted-2 transition-transform ${open ? "rotate-90" : ""}`} />
        <Wrench className="h-3 w-3 shrink-0 text-muted-2" />
        <span className="font-mono">{t.toolName}</span>
        <span className="truncate font-mono text-[10px] text-muted-2">
          {JSON.stringify(t.input).slice(0, 80)}
        </span>
        <span className="ml-auto shrink-0">
          <Badge variant={bad ? "err" : "ok"}>{t.status}</Badge>
        </span>
        <span className="shrink-0 tabular-nums text-[10px] text-muted-2">{t.durationMs}ms</span>
      </button>
      {open && (
        <pre className="scroll-thin max-h-56 overflow-auto border-t border-line px-2.5 py-2 font-mono text-[10px] leading-relaxed text-muted">
          {t.outputPreview || t.error || "(no output)"}
        </pre>
      )}
    </div>
  );
}

function StepCard({ s, defaultOpen }: { s: RunStepDetail; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const meta = STATE_ICON[s.state] ?? STATE_ICON.pending;
  const Icon = meta.icon;
  return (
    <div className="rounded-[10px] border border-line bg-panel-2/40">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
        <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-md ${meta.cls}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-medium">
              #{s.index} {s.title}
            </span>
            <Badge variant="muted">{s.kind}</Badge>
          </span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-muted-2">
            {(s.filesWritten.length ? s.filesWritten : s.files).join(", ") || "—"}
          </span>
        </span>
        <span className="shrink-0 text-right text-[10px] tabular-nums text-muted-2">
          <span className="block">{formatUsd(s.costUsd)}</span>
          <span className="block">{formatTokens(s.tokens)} tok</span>
        </span>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-2 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && (
        <div className="space-y-3 border-t border-line px-3 py-3">
          {s.rationale && <p className="text-xs text-muted">{s.rationale}</p>}

          {s.modelCalls.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-2">
                <Bot className="h-3 w-3" /> Model calls
              </div>
              <div className="space-y-1">
                {s.modelCalls.map((m, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs">
                    <span className="font-mono">{m.model}</span>
                    <Badge variant="muted">{m.purpose}</Badge>
                    <span className="ml-auto tabular-nums text-muted-2">
                      {m.inputTokens}→{m.outputTokens} tok · {formatUsd(m.costUsd)} · {m.latencyMs}ms
                      {m.cacheHit !== "none" ? ` · ${m.cacheHit}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {s.toolCalls.length > 0 && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-2">
                <Wrench className="h-3 w-3" /> Tool calls
              </div>
              <div className="space-y-1">
                {s.toolCalls.map((t) => (
                  <ToolRow key={t.seq} t={t} />
                ))}
              </div>
            </div>
          )}

          {s.filesWritten.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {s.filesWritten.map((f) => (
                <span key={f} className="flex items-center gap-1 rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-text">
                  <FileCode2 className="h-3 w-3 text-muted-2" />
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function RunSteps({ runId, live }: { runId: string; live: boolean }) {
  const { data, isLoading } = useRunSteps(runId, live);

  if (isLoading) return <Loader2 className="mx-auto my-8 h-5 w-5 animate-spin text-muted" />;
  if (!data) return null;

  const { plan, steps, other } = data;
  const done = plan?.steps.filter((s) => s.state && s.state !== "pending").length ?? 0;
  const total = plan?.steps.length ?? 0;

  return (
    <div className="space-y-4">
      {plan ? (
        <div className="rounded-[10px] border border-line bg-panel-2/40 p-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">Plan</span>
            <Badge variant={plan.risk === "high" ? "err" : plan.risk === "medium" ? "warn" : "muted"}>
              {plan.risk} risk
            </Badge>
            {plan.greenfield && <Badge variant="accent">greenfield</Badge>}
            {plan.edited ? <Badge variant="warn">human-edited</Badge> : <Badge variant="muted">agent</Badge>}
            <span className="ml-auto flex items-center gap-2 text-[10px] text-muted-2">
              {done}/{total} steps
              <span className="w-20">
                <Meter value={total ? done / total : 0} tone="ok" />
              </span>
            </span>
          </div>
          <p className="mt-1.5 text-sm text-muted">{plan.summary}</p>
        </div>
      ) : (
        <p className="text-sm text-muted">No plan recorded for this run.</p>
      )}

      <div className="space-y-2">
        {steps.map((s) => (
          <StepCard key={s.index} s={s} defaultOpen={steps.length <= 3 || s.state === "failed"} />
        ))}
      </div>

      {(other.modelCalls.length > 0 || other.toolCalls.length > 0) && (
        <details className="rounded-[10px] border border-line bg-panel-2/40 p-3">
          <summary className="cursor-pointer text-xs font-medium text-muted">
            Plan / review calls ({other.modelCalls.length + other.toolCalls.length})
          </summary>
          <div className="mt-2 space-y-1">
            {other.modelCalls.map((m, i) => (
              <div key={i} className="flex items-center gap-2 rounded-md border border-line bg-panel px-2.5 py-1.5 text-xs">
                <span className="font-mono">{m.model}</span>
                <Badge variant="muted">{m.purpose}</Badge>
                <span className="ml-auto tabular-nums text-muted-2">
                  {m.inputTokens}→{m.outputTokens} tok · {formatUsd(m.costUsd)} · {m.latencyMs}ms
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
