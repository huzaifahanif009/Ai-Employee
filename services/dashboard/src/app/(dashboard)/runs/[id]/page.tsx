"use client";

import { ExternalLink, GitBranch, Loader2, Pause, Play, Send, XCircle } from "lucide-react";
import { useParams } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { ActivityFeed } from "@/components/runs/activity-feed";
import { RunStateChip } from "@/components/state-chip";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authErrorMessage } from "@/lib/auth";
import { deriveDelivery, derivePlan, deriveReview, deriveSteps, deriveVerification } from "@/lib/derive";
import { useApprovals, useRun, useRunControl, useRunModelCalls, useRunToolCalls } from "@/lib/hooks";
import { useRunStream } from "@/lib/sse";
import { formatTokens, formatUsd, shortId } from "@/lib/utils";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export default function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: run } = useRun(id);
  const { events, connected } = useRunStream(id);
  const { data: openApprovals } = useApprovals("open");
  const control = useRunControl(id);
  const [comment, setComment] = useState("");

  const terminalNow = !!run && TERMINAL.has(run.state);
  const { data: modelCalls } = useRunModelCalls(id, !terminalNow);
  const { data: toolCalls } = useRunToolCalls(id, !terminalNow);
  const lastDiff = [...(toolCalls ?? [])].reverse().find((t) => t.toolName === "git.diff")?.outputPreview;
  const writes = (toolCalls ?? []).filter((t) => t.toolName === "fs.write" && t.status === "ok");

  const runApprovals = (openApprovals ?? []).filter((a) => a.runId === id);
  const plan = derivePlan(events);
  const steps = deriveSteps(events);
  const verification = deriveVerification(events);
  const review = deriveReview(events);
  const delivery = deriveDelivery(events);

  if (!run) {
    return (
      <div className="flex h-40 items-center justify-center text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const terminal = TERMINAL.has(run.state);

  async function act(op: "pause" | "resume" | "cancel") {
    try {
      await control.mutateAsync({ op });
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  async function sendComment() {
    if (!comment.trim()) return;
    try {
      await control.mutateAsync({ op: "comment", body: { text: comment } });
      setComment("");
      toast.success("Comment sent");
    } catch (err) {
      toast.error(authErrorMessage(err));
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm text-muted">run {shortId(run.id)}</span>
            <RunStateChip state={run.state} />
            {run.branchName && (
              <span className="flex items-center gap-1 text-xs text-muted">
                <GitBranch className="h-3.5 w-3.5" />
                {run.branchName}
              </span>
            )}
            {run.prRef && (
              <a
                href={run.prRef.url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                PR #{run.prRef.number}
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="flex items-center gap-4 text-xs text-muted">
            <span>{formatUsd(run.totals.costUsd)}</span>
            <span>{formatTokens(run.totals.tokens)} tok</span>
            <span>{run.totals.toolCalls} tool calls</span>
            <span>{run.totals.filesChanged} files</span>
          </div>

          {!terminal && (
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => act("pause")} disabled={control.isPending}>
                <Pause className="h-3.5 w-3.5" />
                Pause
              </Button>
              <Button size="sm" variant="outline" onClick={() => act("resume")} disabled={control.isPending}>
                <Play className="h-3.5 w-3.5" />
                Resume
              </Button>
              <Button size="sm" variant="destructive" onClick={() => act("cancel")} disabled={control.isPending}>
                <XCircle className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {run.failureMessage && (
        <Card className="border-err/40">
          <CardContent className="pt-4 text-sm">
            <span className="font-medium text-err">{run.failureCategory}</span>
            <span className="ml-2 text-muted">{run.failureMessage}</span>
          </CardContent>
        </Card>
      )}

      {runApprovals.map((a) => (
        <ApprovalCard key={a.id} approval={a} showRunLink={false} />
      ))}

      <Card>
        <CardContent className="pt-4">
          <Tabs defaultValue="activity">
            <TabsList>
              <TabsTrigger value="activity">Activity</TabsTrigger>
              <TabsTrigger value="plan">Plan{plan ? ` (${plan.stepCount})` : ""}</TabsTrigger>
              <TabsTrigger value="changes">Changes{writes.length ? ` (${writes.length})` : ""}</TabsTrigger>
              <TabsTrigger value="tools">Tools{toolCalls?.length ? ` (${toolCalls.length})` : ""}</TabsTrigger>
              <TabsTrigger value="verify">Verification</TabsTrigger>
              <TabsTrigger value="review">Review</TabsTrigger>
              <TabsTrigger value="delivery">Delivery</TabsTrigger>
              <TabsTrigger value="cost">Cost{modelCalls?.length ? ` (${modelCalls.length})` : ""}</TabsTrigger>
            </TabsList>

            <TabsContent value="activity">
              <ActivityFeed events={events} />
              {!connected && (
                <p className="mt-2 text-xs text-muted">
                  not live — showing last known state; will reconnect automatically
                </p>
              )}
              {!terminal && (
                <div className="mt-3 flex gap-2">
                  <Input
                    placeholder="inject a comment for the agent…"
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && sendComment()}
                  />
                  <Button size="sm" onClick={sendComment} disabled={control.isPending || !comment.trim()}>
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}
            </TabsContent>

            <TabsContent value="plan">
              {!plan && <p className="text-sm text-muted">No plan yet.</p>}
              {plan && (
                <div className="space-y-3">
                  <p className="text-xs text-muted">
                    v{plan.version} · risk {plan.risk} · touches{" "}
                    {plan.filesEstimate.join(", ") || "—"}
                  </p>
                  <ol className="space-y-2">
                    {plan.steps.map((s) => {
                      const detail = steps.find((st) => st.index === s.index);
                      return (
                        <li key={s.index} className="rounded-lg border border-line bg-bg p-3 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">
                              #{s.index} {s.title}
                            </span>
                            {detail && (
                              <span
                                className={
                                  detail.state === "succeeded"
                                    ? "text-xs text-ok"
                                    : detail.state === "failed"
                                      ? "text-xs text-err"
                                      : "text-xs text-accent"
                                }
                              >
                                {detail.state}
                              </span>
                            )}
                          </div>
                          {detail && detail.toolCalls.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5 font-mono text-xs text-muted">
                              {detail.toolCalls.map((tc, i) => (
                                <li key={i}>
                                  {tc.tool} → {tc.status} {tc.output}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              )}
            </TabsContent>

            <TabsContent value="changes">
              {!lastDiff && writes.length === 0 && (
                <p className="text-sm text-muted">No file changes yet.</p>
              )}
              {writes.length > 0 && (
                <ul className="mb-3 space-y-1 text-sm">
                  {writes.map((w) => (
                    <li key={w.id} className="font-mono text-xs text-muted">
                      + {String((w.input as { path?: string }).path ?? "")}
                    </li>
                  ))}
                </ul>
              )}
              {lastDiff && (
                <pre className="scroll-thin max-h-[420px] overflow-auto rounded-lg border border-line bg-bg p-3 font-mono text-xs leading-relaxed">
                  {lastDiff.split("\n").map((l, i) => (
                    <div
                      key={i}
                      className={
                        l.startsWith("+") && !l.startsWith("+++")
                          ? "text-ok"
                          : l.startsWith("-") && !l.startsWith("---")
                            ? "text-err"
                            : l.startsWith("@@")
                              ? "text-accent"
                              : "text-text"
                      }
                    >
                      {l || " "}
                    </div>
                  ))}
                </pre>
              )}
            </TabsContent>

            <TabsContent value="tools">
              {(toolCalls?.length ?? 0) === 0 && (
                <p className="text-sm text-muted">No tool calls yet.</p>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="pb-2 font-medium">#</th>
                    <th className="pb-2 font-medium">Tool</th>
                    <th className="pb-2 font-medium">Risk</th>
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium">ms</th>
                    <th className="pb-2 font-medium">Output</th>
                  </tr>
                </thead>
                <tbody className="font-mono text-xs">
                  {toolCalls?.map((t) => (
                    <tr key={t.id} className="border-t border-line align-top">
                      <td className="py-1.5 text-muted">{t.seq}</td>
                      <td className="py-1.5">{t.toolName}</td>
                      <td className="py-1.5 text-muted">{t.riskTier}</td>
                      <td
                        className={`py-1.5 ${t.status === "ok" ? "text-ok" : t.status === "denied" ? "text-warn" : "text-err"}`}
                      >
                        {t.status}
                      </td>
                      <td className="py-1.5 tabular-nums">{t.durationMs}</td>
                      <td className="py-1.5 max-w-md truncate text-muted">
                        {t.outputPreview.replace(/\n/g, " ").slice(0, 120)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TabsContent>

            <TabsContent value="verify">
              {verification.checks.length === 0 && (
                <p className="text-sm text-muted">No verification run yet.</p>
              )}
              <ul className="space-y-2">
                {verification.checks.map((c) => (
                  <li
                    key={c.check}
                    className="flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-sm"
                  >
                    <span className="capitalize">{c.check}</span>
                    <span
                      className={
                        c.status === "pass" ? "text-ok" : c.status === "fail" ? "text-err" : "text-accent"
                      }
                    >
                      {c.status} {c.summary}
                    </span>
                  </li>
                ))}
              </ul>
              {verification.overall && (
                <p className="mt-3 text-sm">
                  overall:{" "}
                  <span className={verification.overall === "pass" ? "text-ok" : "text-err"}>
                    {verification.overall}
                  </span>
                </p>
              )}
            </TabsContent>

            <TabsContent value="review">
              {!review && <p className="text-sm text-muted">No review yet.</p>}
              {review && (
                <div className="space-y-2">
                  <p className="text-sm">
                    verdict:{" "}
                    <span
                      className={
                        review.verdict === "pass"
                          ? "text-ok"
                          : review.verdict === "block"
                            ? "text-err"
                            : "text-warn"
                      }
                    >
                      {review.verdict}
                    </span>
                  </p>
                  <ul className="space-y-1.5">
                    {review.findings.map((f, i) => (
                      <li key={i} className="rounded-lg border border-line bg-bg px-3 py-2 text-sm">
                        <span className="mr-2 text-xs uppercase text-muted">{f.severity}</span>
                        {f.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </TabsContent>

            <TabsContent value="cost">
              {(modelCalls?.length ?? 0) === 0 && (
                <p className="text-sm text-muted">No model calls recorded yet.</p>
              )}
              {modelCalls && modelCalls.length > 0 && (
                <div className="space-y-4">
                  <div className="flex gap-6 text-sm">
                    <span>
                      <span className="text-muted">Total </span>
                      {formatUsd(modelCalls.reduce((s, c) => s + parseFloat(c.costUsd), 0))}
                    </span>
                    <span>
                      <span className="text-muted">Tokens </span>
                      {formatTokens(
                        modelCalls.reduce((s, c) => s + c.inputTokens + c.outputTokens, 0),
                      )}
                    </span>
                    <span>
                      <span className="text-muted">Calls </span>
                      {modelCalls.length}
                    </span>
                    {modelCalls.some((c) => c.redactedSpans > 0) && (
                      <span className="text-warn">
                        {modelCalls.reduce((s, c) => s + c.redactedSpans, 0)} redactions
                      </span>
                    )}
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs text-muted">
                        <th className="pb-2 font-medium">Purpose</th>
                        <th className="pb-2 font-medium">Role</th>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">In</th>
                        <th className="pb-2 font-medium">Out</th>
                        <th className="pb-2 font-medium">Cost</th>
                        <th className="pb-2 font-medium">Latency</th>
                        <th className="pb-2 font-medium">Cache</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono text-xs">
                      {modelCalls.map((c) => (
                        <tr key={c.id} className="border-t border-line">
                          <td className="py-1.5">{c.purpose}</td>
                          <td className="py-1.5 text-muted">{c.agentRole ?? "—"}</td>
                          <td className="py-1.5">
                            {c.provider}/{c.model}
                          </td>
                          <td className="py-1.5 tabular-nums">{c.inputTokens}</td>
                          <td className="py-1.5 tabular-nums">{c.outputTokens}</td>
                          <td className="py-1.5 tabular-nums">
                            {formatUsd(parseFloat(c.costUsd))}
                          </td>
                          <td className="py-1.5 tabular-nums">{c.latencyMs}ms</td>
                          <td className="py-1.5">
                            {c.cacheHit === "none" ? (
                              <span className="text-muted">—</span>
                            ) : (
                              <span className="text-ok">{c.cacheHit}</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </TabsContent>

            <TabsContent value="delivery">
              {!delivery.branch && <p className="text-sm text-muted">Nothing delivered yet.</p>}
              {delivery.branch && (
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                  <dt className="text-muted">Branch</dt>
                  <dd className="font-mono">{delivery.branch}</dd>
                  <dt className="text-muted">Head</dt>
                  <dd className="font-mono">{delivery.headSha?.slice(0, 12)}</dd>
                  {delivery.prUrl && (
                    <>
                      <dt className="text-muted">Pull request</dt>
                      <dd>
                        <a href={delivery.prUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          #{delivery.prNumber} ({delivery.prState})
                        </a>
                      </dd>
                    </>
                  )}
                </dl>
              )}
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
