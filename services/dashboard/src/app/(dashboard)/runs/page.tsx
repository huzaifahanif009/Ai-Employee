"use client";

import Link from "next/link";
import { RunStateChip } from "@/components/state-chip";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useRuns } from "@/lib/hooks";
import { formatTokens, formatUsd, relativeTime, shortId } from "@/lib/utils";

export default function RunsPage() {
  const { data, isLoading } = useRuns(100);
  const runs = data?.data ?? [];

  return (
    <Card>
      <CardContent className="pt-4">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="pb-2 font-medium">Run</th>
              <th className="pb-2 font-medium">State</th>
              <th className="pb-2 font-medium">Cost</th>
              <th className="pb-2 font-medium">Tokens</th>
              <th className="pb-2 font-medium">Files</th>
              <th className="pb-2 font-medium">PR</th>
              <th className="pb-2 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {isLoading &&
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-2.5" colSpan={7}>
                    <Skeleton className="h-4 w-full" />
                  </td>
                </tr>
              ))}
            {!isLoading && runs.length === 0 && (
              <tr>
                <td colSpan={7} className="py-10 text-center text-muted">
                  No runs yet — start one from a Work Item.
                </td>
              </tr>
            )}
            {runs.map((r) => (
              <tr key={r.id} className="border-t border-line hover:bg-panel-2/50">
                <td className="py-2.5">
                  <Link href={`/runs/${r.id}`} className="font-medium text-accent hover:underline">
                    {shortId(r.id)}
                  </Link>
                </td>
                <td className="py-2.5">
                  <RunStateChip state={r.state} />
                </td>
                <td className="py-2.5 tabular-nums">{formatUsd(r.totals.costUsd)}</td>
                <td className="py-2.5 tabular-nums">{formatTokens(r.totals.tokens)}</td>
                <td className="py-2.5 tabular-nums">{r.totals.filesChanged}</td>
                <td className="py-2.5">
                  {r.prRef ? (
                    <a
                      href={r.prRef.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent hover:underline"
                    >
                      #{r.prRef.number}
                    </a>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="py-2.5 text-muted">{relativeTime(r.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}
