"use client";

import { CheckCircle2 } from "lucide-react";
import { ApprovalCard } from "@/components/approvals/approval-card";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useApprovals } from "@/lib/hooks";

export default function ApprovalsPage() {
  const { data, isLoading } = useApprovals("open");
  const approvals = [...(data ?? [])].sort(
    (a, b) => new Date(a.slaAt).getTime() - new Date(b.slaAt).getTime(),
  );

  return (
    <div className="max-w-2xl space-y-3">
      {isLoading && (
        <>
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </>
      )}
      {!isLoading && approvals.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted">
            <CheckCircle2 className="h-6 w-6 text-ok" />
            No open approvals.
          </CardContent>
        </Card>
      )}
      {approvals.map((a) => (
        <ApprovalCard key={a.id} approval={a} />
      ))}
    </div>
  );
}
