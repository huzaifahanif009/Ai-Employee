"use client";

import { useEffect, useRef } from "react";
import type { StreamEvent } from "@/lib/sse";
import { cn } from "@/lib/utils";

function line(e: StreamEvent): { text: string; tone: "default" | "state" | "tool" | "err" | "ok" } {
  const p = e.payload as Record<string, unknown>;
  switch (e.type) {
    case "run.state_changed":
      return { text: `→ ${p.to}`, tone: "state" };
    case "plan.created":
      return { text: `plan created — ${p.stepCount} steps, risk ${p.risk}`, tone: "default" };
    case "plan.step_defined":
      return { text: `step #${p.index}: ${p.title}`, tone: "default" };
    case "run_step.started":
      return { text: `▸ step #${p.index} (${p.role}) — ${p.title}`, tone: "default" };
    case "run_step.finished":
      return { text: `${p.state === "succeeded" ? "✓" : "✗"} step done (${p.iterations} iter)`, tone: p.state === "succeeded" ? "ok" : "err" };
    case "message.delta":
      return { text: String(p.deltaText ?? ""), tone: "default" };
    case "tool_call.started":
      return { text: `🔧 ${p.tool} ${p.argsPreview ?? ""}`, tone: "tool" };
    case "tool_call.finished":
      return { text: `   ↳ ${p.status} · ${p.outputPreview ?? ""} (${p.durationMs}ms)`, tone: "tool" };
    case "verify.check_started":
      return { text: `verify: ${p.check} running…`, tone: "default" };
    case "verify.check_finished":
      return { text: `verify: ${p.check} → ${p.result} ${p.summary ?? ""}`, tone: p.result === "pass" ? "ok" : "err" };
    case "verify.finished":
      return { text: `verification ${p.overall}`, tone: p.overall === "pass" ? "ok" : "err" };
    case "review.started":
      return { text: "AI review started…", tone: "default" };
    case "review.finished":
      return { text: `AI review verdict: ${p.verdict}`, tone: p.verdict === "pass" ? "ok" : p.verdict === "block" ? "err" : "default" };
    case "git.branch.created":
      return { text: `branch created: ${p.branch}`, tone: "default" };
    case "git.commit.created":
      return { text: `commit ${String(p.sha).slice(0, 7)} — ${p.message}`, tone: "default" };
    case "git.pushed":
      return { text: `pushed ${p.branch} → ${String(p.headSha).slice(0, 7)}`, tone: "default" };
    case "vcs.pr.opened":
      return { text: `PR opened: ${p.url}`, tone: "ok" };
    case "approval.requested":
      return { text: `⏸ approval requested (${p.type})`, tone: "err" };
    case "approval.decided":
      return { text: `approval ${p.decision} by ${String(p.decidedBy).slice(0, 8)}`, tone: p.decision === "approve" ? "ok" : "err" };
    case "approval.expired":
      return { text: "approval expired (SLA)", tone: "err" };
    case "run.paused":
      return { text: "⏸ paused by operator", tone: "state" };
    case "run.resumed":
      return { text: "▶ resumed", tone: "state" };
    case "operator.message":
      return { text: `💬 operator: ${p.text}`, tone: "default" };
    case "run.totals_updated":
      return {
        text: `$${Number(p.costUsd).toFixed(3)} · ${p.tokens} tok · ${p.filesChanged} files`,
        tone: "default",
      };
    case "run.completed":
      return { text: `run completed — ${p.outcome}${p.prUrl ? ` (${p.prUrl})` : ""}`, tone: "ok" };
    case "run.failed":
      return { text: `run failed — ${p.category}: ${p.message}`, tone: "err" };
    default:
      return { text: `${e.type} ${JSON.stringify(p).slice(0, 140)}`, tone: "default" };
  }
}

const TONE_CLASS: Record<string, string> = {
  default: "text-text",
  state: "text-warn font-medium",
  tool: "text-ok",
  err: "text-err",
  ok: "text-ok",
};

/** Skips high-volume events not worth a log line (totals ticks shown separately, message deltas coalesced). */
const SKIP = new Set(["run.totals_updated"]);

export function ActivityFeed({ events }: { events: StreamEvent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [events.length]);

  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      className="scroll-thin h-[420px] overflow-y-auto rounded-lg border border-line bg-bg p-3 font-mono text-[12.5px] leading-relaxed"
    >
      {events.length === 0 && <p className="text-muted">Waiting for activity…</p>}
      {events
        .filter((e) => !SKIP.has(e.type))
        .map((e, i) => {
          const { text, tone } = line(e);
          return (
            <div key={`${e.id}-${i}`} className="flex gap-2">
              <span className="shrink-0 text-muted/60">
                {new Date(e.ts).toLocaleTimeString([], { hour12: false })}
              </span>
              <span className={cn("whitespace-pre-wrap break-all", TONE_CLASS[tone])}>{text}</span>
            </div>
          );
        })}
    </div>
  );
}
