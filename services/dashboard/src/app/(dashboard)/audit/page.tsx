"use client";

import { ShieldCheck, ShieldX } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuditLog, useAuditVerify } from "@/lib/hooks";
import { relativeTime } from "@/lib/utils";

const METHOD_TONE: Record<string, string> = {
  POST: "text-ok",
  PATCH: "text-warn",
  PUT: "text-warn",
  DELETE: "text-err",
};

export default function AuditPage() {
  const [filter, setFilter] = useState("");
  const { data, isLoading } = useAuditLog(filter.trim() || undefined);
  const { data: chain } = useAuditVerify();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Append-only, hash-chained record of every state-changing request. Read-only for admins.
        </p>
        {chain && (
          <span
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${
              chain.ok ? "border-ok/30 bg-ok/10 text-ok" : "border-err/30 bg-err/10 text-err"
            }`}
          >
            {chain.ok ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
            {chain.ok ? `chain verified · ${chain.entries} entries` : `chain broken at #${chain.brokenAt}`}
          </span>
        )}
      </div>

      <Input
        placeholder="filter by action, e.g. /runs or DELETE"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="max-w-sm text-sm"
      />

      <Card>
        <CardContent className="overflow-x-auto pt-4">
          {isLoading && <Skeleton className="h-64 w-full" />}
          {data && (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-2">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Actor</th>
                  <th className="pb-2 font-medium">Action</th>
                  <th className="pb-2 font-medium">Target</th>
                  <th className="pb-2 font-medium">Result</th>
                  <th className="pb-2 font-medium">Hash</th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((e) => {
                  const [method, route] = e.action.split(" ");
                  return (
                    <tr key={e.id} className="border-t border-line align-top">
                      <td className="whitespace-nowrap py-2 text-muted">{relativeTime(e.ts)}</td>
                      <td className="py-2">
                        <span className="text-xs">{e.actor.id.slice(0, 8)}</span>
                        {e.actor.display && <Badge variant="muted" className="ml-1.5">{e.actor.display}</Badge>}
                      </td>
                      <td className="py-2 font-mono text-xs">
                        <span className={METHOD_TONE[method] ?? "text-muted"}>{method}</span> {route}
                      </td>
                      <td className="max-w-[220px] py-2 font-mono text-[11px] text-muted">
                        {Object.entries((e.target.params as Record<string, string>) ?? {})
                          .map(([k, v]) => `${k}=${String(v).slice(0, 12)}`)
                          .join(" ") || "—"}
                      </td>
                      <td className="max-w-[200px] truncate py-2 font-mono text-[11px] text-muted">
                        {e.after ? JSON.stringify(e.after) : "—"}
                      </td>
                      <td className="py-2 font-mono text-[10px] text-muted-2">{e.hash}</td>
                    </tr>
                  );
                })}
                {data.data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-muted">
                      No audit entries{filter ? " for that filter" : " yet"}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
