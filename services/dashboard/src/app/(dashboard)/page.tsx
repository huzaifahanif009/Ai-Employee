"use client";

import {
  Activity,
  Bot,
  Check,
  CircleDollarSign,
  GitPullRequest,
  Inbox,
  ListChecks,
  Timer,
  TriangleAlert,
  Wrench,
  Zap,
} from "lucide-react";
import Link from "next/link";
import { BarList, Donut, Meter, Sparkline } from "@/components/charts";
import { RunStateChip } from "@/components/state-chip";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  useDashActivity,
  useDashOverview,
  useDashTimeseries,
  useDashWorkload,
  useRuns,
  useWorkItems,
} from "@/lib/hooks";
import { formatTokens, formatUsd, relativeTime, shortId } from "@/lib/utils";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

const ACTIVITY_ICON: Record<string, typeof Activity> = {
  "run.created": ListChecks,
  "run.completed": Check,
  "run.failed": TriangleAlert,
  "plan.created": Bot,
  "approval.requested": Inbox,
  "approval.decided": Check,
  "run_step.started": Activity,
  "run_step.finished": Check,
  "verify.finished": ListChecks,
  "review.finished": ListChecks,
  "vcs.pr.opened": GitPullRequest,
  "git.pushed": GitPullRequest,
  "progress.warning": Zap,
};

function fmtDuration(sec: number) {
  if (!sec) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m}m ${sec % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function HeroTile({
  label,
  value,
  sub,
  spark,
  tone,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  spark?: number[];
  tone?: "accent" | "ok" | "warn" | "err";
  icon: typeof Activity;
}) {
  const col = { accent: "var(--accent)", ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)" }[tone ?? "accent"];
  return (
    <div className="hover-lift relative flex-1 overflow-hidden rounded-[var(--radius)] border border-line bg-panel px-4 pt-3.5 shadow-[var(--shadow)]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</span>
        <Icon className="h-3.5 w-3.5 text-muted-2" />
      </div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <span
          className={cnTone(tone)}
        >
          {value}
        </span>
      </div>
      <div className="mt-0.5 text-[11px] text-muted">{sub ?? " "}</div>
      <div className="-mx-4 mt-1.5 h-[34px]">
        {spark && spark.length > 1 ? <Sparkline data={spark} stroke={col} /> : <div className="h-full" />}
      </div>
    </div>
  );
}
function cnTone(tone?: "accent" | "ok" | "warn" | "err") {
  const base = "text-[26px] font-semibold leading-none tabular-nums ";
  if (tone === "ok") return base + "text-ok";
  if (tone === "warn") return base + "text-warn";
  if (tone === "err") return base + "text-err";
  return base + "text-gradient";
}

export default function OverviewPage() {
  const { data: ov, isLoading } = useDashOverview();
  const { data: ts } = useDashTimeseries(24);
  const { data: activity } = useDashActivity(28);
  const { data: workload } = useDashWorkload();
  const { data: runsPage } = useRuns(12);
  const { data: workItems } = useWorkItems();

  const buckets = ts?.buckets ?? [];
  const wiTitle = new Map((workItems ?? []).map((w) => [w.id, w.title]));
  const runs = runsPage?.data ?? [];
  const agentActive = (ov?.runs.active ?? 0) > 0;

  const tierColors = ["var(--ok)", "var(--accent)", "var(--warn)"];
  const donutSegments =
    workload?.tiers.map((t, i) => ({ label: t.label, value: t.count, color: tierColors[i] ?? "var(--muted)" })) ?? [];

  return (
    <div className="space-y-5">
      {/* hero */}
      <div className="stagger grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <HeroTile
          icon={Check}
          label="Closed · 24h"
          value={isLoading ? "…" : ov?.runs.last24h ?? 0}
          sub={`${ov?.runs.succeeded7d ?? 0} succeeded · 7d`}
          spark={buckets.map((b) => b.succeeded)}
          tone="ok"
        />
        <HeroTile
          icon={Inbox}
          label="Awaiting approval"
          value={ov?.approvals.open ?? 0}
          sub={`${ov?.approvals.awaitingPlan ?? 0} plan gates`}
          tone={ov?.approvals.open ? "warn" : "accent"}
        />
        <HeroTile
          icon={Timer}
          label="Median run"
          value={fmtDuration(ov?.avgRunSeconds ?? 0)}
          sub="succeeded · 7d"
          spark={buckets.map((b) => b.started)}
        />
        <HeroTile
          icon={Activity}
          label="Success rate"
          value={ov?.successRate == null ? "—" : `${ov.successRate}%`}
          sub={`${ov?.runs.failed7d ?? 0} failed · 7d`}
          tone="ok"
        />
        <HeroTile
          icon={Bot}
          label="Autonomy"
          value={`${ov?.autonomyPct ?? 0}%`}
          sub="closed without a correction"
        />
        <HeroTile
          icon={Zap}
          label="Tokens · 24h"
          value={formatTokens(ov?.spend.tokens24h ?? 0)}
          sub={`${formatUsd(ov?.spend.last24hUsd ?? 0)} spend`}
          spark={buckets.map((b) => b.tokens)}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* live agent activity */}
        <Card className="overflow-hidden">
          <CardHeader>
            <div>
              <CardTitle>Live agent activity</CardTitle>
              <p className="text-xs text-muted-2">cross-run event stream</p>
            </div>
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                agentActive ? "border-ok/30 bg-ok/10 text-ok" : "border-line bg-panel-2 text-muted-2"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${agentActive ? "animate-pulse-dot bg-ok" : "bg-muted-2"}`} />
              agent {agentActive ? "active" : "idle"}
            </span>
          </CardHeader>
          <CardContent>
            {!activity && <Skeleton className="h-64 w-full" />}
            {activity && activity.length === 0 && (
              <p className="py-10 text-center text-sm text-muted">No activity yet — start a run.</p>
            )}
            <ol className="scroll-thin max-h-[420px] space-y-0 overflow-y-auto pr-1">
              {(activity ?? []).map((a, i) => {
                const Icon = ACTIVITY_ICON[a.type] ?? Activity;
                const bad = a.type === "run.failed" || /failed|reject/.test(a.summary);
                return (
                  <li key={`${a.runId}-${a.seq}`} className="animate-fade-up" style={{ animationDelay: `${Math.min(i, 8) * 25}ms` }}>
                    <Link
                      href={`/runs/${a.runId}`}
                      className="group flex items-start gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-panel-2/60"
                    >
                      <span
                        className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md ${
                          bad ? "bg-err/12 text-err" : "bg-accent/12 text-accent"
                        }`}
                      >
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm">{a.summary}</span>
                          <span className="shrink-0 text-[10px] tabular-nums text-muted-2">{relativeTime(a.ts)}</span>
                        </span>
                        <span className="truncate text-[11px] text-muted-2">
                          {a.workItem} · run {shortId(a.runId)}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </CardContent>
        </Card>

        {/* workload donut */}
        <Card>
          <CardHeader>
            <CardTitle>Workload distribution</CardTitle>
            <span className="text-xs text-muted-2">{workload?.completed ?? 0} completed</span>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-4">
            <Donut
              segments={donutSegments}
              centerLabel={`${ov?.autonomyPct ?? 0}%`}
              centerSub="autonomous"
            />
            <div className="w-full space-y-1.5">
              {(workload?.tiers ?? []).map((t, i) => (
                <div key={t.key} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: tierColors[i] ?? "var(--muted)" }} />
                    {t.label}
                  </span>
                  <span className="tabular-nums text-muted">{t.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.55fr_1fr]">
        {/* recent runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent runs</CardTitle>
            <Link href="/runs" className="text-xs text-accent hover:underline">
              view all
            </Link>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-2">
                  <th className="pb-2 font-medium">Ticket</th>
                  <th className="pb-2 font-medium">State</th>
                  <th className="pb-2 font-medium">Steps</th>
                  <th className="pb-2 font-medium">Cost</th>
                  <th className="pb-2 font-medium">Files</th>
                  <th className="pb-2 font-medium">When</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const done = r.plan?.steps.filter((s) => s.state && s.state !== "pending").length ?? 0;
                  const total = r.plan?.steps.length ?? 0;
                  return (
                    <tr key={r.id} className="border-t border-line">
                      <td className="max-w-[220px] py-2">
                        <Link href={`/runs/${r.id}`} className="block truncate text-accent hover:underline">
                          {wiTitle.get(r.workItemId) ?? shortId(r.id)}
                        </Link>
                      </td>
                      <td className="py-2">
                        <RunStateChip state={r.state} />
                      </td>
                      <td className="w-24 py-2">
                        {total ? (
                          <div className="flex items-center gap-1.5">
                            <Meter value={done / total} tone={TERMINAL.has(r.state) ? "ok" : "accent"} />
                            <span className="shrink-0 text-[10px] tabular-nums text-muted-2">
                              {done}/{total}
                            </span>
                          </div>
                        ) : (
                          <span className="text-muted-2">—</span>
                        )}
                      </td>
                      <td className="py-2 tabular-nums">{formatUsd(r.totals.costUsd)}</td>
                      <td className="py-2 tabular-nums">{r.totals.filesChanged}</td>
                      <td className="py-2 text-muted">{relativeTime(r.createdAt)}</td>
                    </tr>
                  );
                })}
                {runs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted">
                      No runs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* tool + model usage */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <Wrench className="h-3.5 w-3.5 text-muted-2" /> Tool usage
              </CardTitle>
              <span className="text-xs text-muted-2">{ov?.activity.toolCalls24h ?? 0} calls · 24h</span>
            </CardHeader>
            <CardContent>
              <BarList
                items={(ov?.topTools ?? []).map((t) => ({
                  label: t.tool,
                  value: t.calls,
                  sub: `${t.calls}${t.ok < t.calls ? ` · ${t.calls - t.ok} err` : ""}`,
                }))}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-1.5">
                <CircleDollarSign className="h-3.5 w-3.5 text-muted-2" /> Model usage
              </CardTitle>
              <span className="text-xs text-muted-2">{formatUsd(ov?.spend.allTimeUsd ?? 0)} all-time</span>
            </CardHeader>
            <CardContent>
              <BarList
                color="var(--accent-2)"
                items={(ov?.topModels ?? []).map((m) => ({
                  label: m.model,
                  value: m.calls,
                  sub: `${m.calls} · ${formatUsd(m.costUsd)}`,
                }))}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
