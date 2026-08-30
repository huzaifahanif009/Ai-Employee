"use client";

import { Activity, CheckCircle2, Inbox, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useDashSystem } from "@/lib/hooks";
import { relativeTime } from "@/lib/utils";

export default function SystemPage() {
  const { data, isLoading } = useDashSystem();

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">Service health, runtime configuration and current load.</p>
        {data && <span className="text-xs text-muted-2">checked {relativeTime(data.checkedAt)}</span>}
      </div>

      {isLoading && <Skeleton className="h-40 w-full" />}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.services.map((s) => (
              <div
                key={s.name}
                className={`hover-lift flex items-start gap-3 rounded-[var(--radius)] border p-3.5 shadow-[var(--shadow)] ${
                  s.ok ? "border-line bg-panel" : "border-err/40 bg-err/5"
                }`}
              >
                {s.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-ok" />
                ) : (
                  <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-err" />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-medium">{s.name}</div>
                  <div className="truncate text-xs text-muted">{s.detail}</div>
                </div>
                <span
                  className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${
                    s.ok ? "bg-ok/15 text-ok" : "bg-err/15 text-err"
                  }`}
                >
                  {s.ok ? "up" : "down"}
                </span>
              </div>
            ))}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Current load</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-3">
                <div className="rounded-[10px] border border-line bg-panel-2/40 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-2">
                    <Activity className="h-3 w-3" /> Active runs
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{data.load.activeRuns}</div>
                </div>
                <div className="rounded-[10px] border border-line bg-panel-2/40 p-3">
                  <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-2">
                    <Inbox className="h-3 w-3" /> Open approvals
                  </div>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{data.load.openApprovals}</div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Runtime configuration</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
                  {Object.entries(data.config).map(([k, v]) => (
                    <div key={k} className="contents">
                      <dt className="font-mono text-muted-2">{k}</dt>
                      <dd className="font-mono">
                        {typeof v === "boolean" ? (
                          <span className={v ? "text-ok" : "text-muted"}>{String(v)}</span>
                        ) : (
                          String(v)
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
