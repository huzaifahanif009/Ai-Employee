"use client";

import { useState } from "react";
import { BarList, Donut, TimeChart } from "@/components/charts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashOverview, useDashTimeseries, useDashWorkload } from "@/lib/hooks";
import { formatTokens, formatUsd } from "@/lib/utils";

const RANGES = [
  { h: 24, label: "24h" },
  { h: 72, label: "3d" },
  { h: 168, label: "7d" },
];

export default function AnalyticsPage() {
  const [hours, setHours] = useState(24);
  const { data: ts, isLoading } = useDashTimeseries(hours);
  const { data: ov } = useDashOverview();
  const { data: wl } = useDashWorkload();

  const buckets = ts?.buckets ?? [];
  const tierColors = ["var(--ok)", "var(--accent)", "var(--warn)"];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Run throughput, spend and model/tool usage over time.</p>
        <div className="flex gap-1 rounded-md bg-panel-2 p-1 text-xs">
          {RANGES.map((r) => (
            <button
              key={r.h}
              onClick={() => setHours(r.h)}
              className={`rounded px-2.5 py-1 ${hours === r.h ? "bg-panel text-text" : "text-muted"}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Runs</CardTitle>
            <span className="text-xs text-muted-2">started · succeeded · failed</span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <>
                <TimeChart
                  points={buckets}
                  height={200}
                  series={[
                    { key: "started", label: "started", color: "var(--accent)" },
                    { key: "succeeded", label: "succeeded", color: "var(--ok)" },
                    { key: "failed", label: "failed", color: "var(--err)", type: "line" },
                  ]}
                />
                <Legend items={[["started", "var(--accent)"], ["succeeded", "var(--ok)"], ["failed", "var(--err)"]]} />
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Spend & tokens</CardTitle>
            <span className="text-xs text-muted-2">{formatUsd(ov?.spend.allTimeUsd ?? 0)} all-time</span>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-52 w-full" />
            ) : (
              <>
                <TimeChart
                  points={buckets}
                  height={200}
                  yFormat={(n) => formatTokens(n)}
                  series={[{ key: "tokens", label: "tokens", color: "var(--accent-2)" }]}
                />
                <Legend items={[["tokens / hr", "var(--accent-2)"]]} />
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                  <Stat label="Spend · 24h" value={formatUsd(ov?.spend.last24hUsd ?? 0)} />
                  <Stat label="Tokens · 24h" value={formatTokens(ov?.spend.tokens24h ?? 0)} />
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Outcomes</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col items-center gap-3">
            <Donut
              segments={(wl?.tiers ?? []).map((t, i) => ({ label: t.label, value: t.count, color: tierColors[i] ?? "var(--muted)" }))}
              centerLabel={`${ov?.autonomyPct ?? 0}%`}
              centerSub="autonomous"
              size={150}
            />
            <div className="w-full space-y-1 text-xs">
              {(wl?.byOutcome ?? []).map((o) => (
                <div key={o.state} className="flex justify-between">
                  <span className="capitalize text-muted">{o.state}</span>
                  <span className="tabular-nums">{o.count}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top models</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              color="var(--accent-2)"
              items={(ov?.topModels ?? []).map((m) => ({ label: m.model, value: m.calls, sub: `${m.calls} · ${formatUsd(m.costUsd)}` }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Top tools</CardTitle>
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
      </div>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
      {items.map(([label, color]) => (
        <span key={label} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-line bg-panel-2/40 px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-2">{label}</div>
      <div className="text-sm font-semibold tabular-nums">{value}</div>
    </div>
  );
}
