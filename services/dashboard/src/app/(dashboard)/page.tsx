"use client";

import Link from "next/link";
import { RunStateChip } from "@/components/state-chip";
import { StatTile } from "@/components/stat-tile";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApprovals, useRuns } from "@/lib/hooks";
import { formatUsd, relativeTime, shortId } from "@/lib/utils";

const TERMINAL = new Set(["succeeded", "failed", "cancelled", "timed_out"]);

export default function OverviewPage() {
  const { data: runsPage, isLoading } = useRuns(100);
  const { data: approvals } = useApprovals("open");
  const runs = runsPage?.data ?? [];

  const active = runs.filter((r) => !TERMINAL.has(r.state));
  const succeeded = runs.filter((r) => r.state === "succeeded");
  const failed = runs.filter((r) => r.state === "failed" || r.state === "timed_out");
  const totalCost = runs.reduce((s, r) => s + r.totals.costUsd, 0);
  const successRate =
    succeeded.length + failed.length > 0
      ? Math.round((succeeded.length / (succeeded.length + failed.length)) * 100)
      : null;

  return (
    <div className="space-y-5">
      <div className="flex gap-3">
        <StatTile label="Active runs" value={isLoading ? "…" : active.length} accent="accent" />
        <StatTile label="Open approvals" value={approvals?.length ?? 0} accent={approvals?.length ? "warn" : undefined} />
        <StatTile label="Succeeded" value={succeeded.length} accent="ok" />
        <StatTile label="Failed" value={failed.length} accent={failed.length ? "err" : undefined} />
        <StatTile
          label="Success rate"
          value={successRate === null ? "—" : `${successRate}%`}
        />
        <StatTile label="Spend (window)" value={formatUsd(totalCost)} />
      </div>

      <div className="grid grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <CardTitle>Active agents</CardTitle>
            <Link href="/runs" className="text-xs text-accent hover:underline">
              view all
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {isLoading && <Skeleton className="h-16 w-full" />}
            {!isLoading && active.length === 0 && (
              <p className="py-6 text-center text-sm text-muted">No active runs.</p>
            )}
            {active.slice(0, 6).map((r) => (
              <Link
                key={r.id}
                href={`/runs/${r.id}`}
                className="flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-sm hover:border-accent/50"
              >
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-accent" />
                  <span className="text-muted">run {shortId(r.id)}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted">{formatUsd(r.totals.costUsd)}</span>
                  <RunStateChip state={r.state} />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Open approvals</CardTitle>
            <Link href="/approvals" className="text-xs text-accent hover:underline">
              view all
            </Link>
          </CardHeader>
          <CardContent className="space-y-2">
            {(approvals?.length ?? 0) === 0 && (
              <p className="py-6 text-center text-sm text-muted">No open approvals.</p>
            )}
            {approvals?.slice(0, 6).map((a) => (
              <Link
                key={a.id}
                href={`/runs/${a.runId}`}
                className="flex items-center justify-between rounded-lg border border-line bg-bg px-3 py-2 text-sm hover:border-accent/50"
              >
                <span className="capitalize">{a.type.replaceAll("_", " ")}</span>
                <span className="text-xs text-muted">{relativeTime(a.requestedAt)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent runs</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="pb-2 font-medium">Run</th>
                <th className="pb-2 font-medium">State</th>
                <th className="pb-2 font-medium">Cost</th>
                <th className="pb-2 font-medium">Files</th>
                <th className="pb-2 font-medium">Created</th>
              </tr>
            </thead>
            <tbody>
              {runs.slice(0, 8).map((r) => (
                <tr key={r.id} className="border-t border-line">
                  <td className="py-2">
                    <Link href={`/runs/${r.id}`} className="text-accent hover:underline">
                      {shortId(r.id)}
                    </Link>
                  </td>
                  <td className="py-2">
                    <RunStateChip state={r.state} />
                  </td>
                  <td className="py-2 tabular-nums">{formatUsd(r.totals.costUsd)}</td>
                  <td className="py-2 tabular-nums">{r.totals.filesChanged}</td>
                  <td className="py-2 text-muted">{relativeTime(r.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
