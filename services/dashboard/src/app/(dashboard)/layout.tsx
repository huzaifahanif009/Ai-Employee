"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { toast } from "sonner";
import { Sidebar } from "@/components/layout/sidebar";
import { Topbar } from "@/components/layout/topbar";
import { useApprovals, useInvalidateApprovals, useInvalidateRuns } from "@/lib/hooks";
import { useFleetStream } from "@/lib/sse";
import { useAuth } from "@/lib/auth";

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/runs": "Runs",
  "/approvals": "Approvals",
  "/work-items": "Work Items",
  "/integrations": "Integrations",
  "/ai": "AI Providers & Models",
};

function titleFor(pathname: string): string {
  if (TITLES[pathname]) return TITLES[pathname];
  if (pathname.startsWith("/runs/")) return "Run detail";
  return "Praxis";
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const invalidateRuns = useInvalidateRuns();
  const invalidateApprovals = useInvalidateApprovals();
  const { data: openApprovals } = useApprovals("open");

  const connected = useFleetStream((e) => {
    if (e.type.startsWith("run.")) invalidateRuns();
    if (e.type.startsWith("approval.")) {
      invalidateApprovals();
      if (e.type === "approval.requested") {
        toast.warning("New approval requested", {
          description: String((e.payload as { type?: string }).type ?? ""),
        });
      }
    }
  }, status === "authenticated");

  useEffect(() => {
    if (status === "anonymous") router.replace("/login");
  }, [status, router]);

  if (status !== "authenticated") {
    return (
      <div className="flex h-full items-center justify-center bg-bg text-muted">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <Sidebar openApprovals={openApprovals?.length ?? 0} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar connected={connected} title={titleFor(pathname)} />
        <main className="scroll-thin flex-1 overflow-y-auto p-5">{children}</main>
      </div>
    </div>
  );
}
