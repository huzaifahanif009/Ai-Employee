"use client";

import {
  Activity,
  Boxes,
  CheckSquare,
  LayoutGrid,
  ListTodo,
  Plug,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/work-items", label: "Work Items", icon: ListTodo },
  { href: "/integrations", label: "Integrations", icon: Plug },
];

const SOON = ["Projects", "Agents & Policies", "Analytics", "System Health", "Audit Log"];

export function Sidebar({ openApprovals }: { openApprovals: number }) {
  const pathname = usePathname();
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r border-line bg-panel">
      <div className="flex items-center gap-2 px-4 py-4 text-sm font-semibold">
        <Sparkles className="h-4 w-4 text-accent" />
        Praxis
      </div>
      <nav className="flex-1 space-y-0.5 px-2">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center justify-between rounded-md px-2.5 py-2 text-sm transition-colors",
                active ? "bg-accent/15 text-accent" : "text-muted hover:bg-panel-2 hover:text-text",
              )}
            >
              <span className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {label}
              </span>
              {label === "Approvals" && openApprovals > 0 && (
                <span
                  className={cn(
                    "rounded-full px-1.5 text-[10px] font-semibold",
                    "bg-warn/20 text-warn",
                  )}
                >
                  {openApprovals}
                </span>
              )}
            </Link>
          );
        })}

        <div className="mt-4 mb-1 px-2.5 text-[10px] font-medium uppercase tracking-wide text-muted/70">
          Roadmap
        </div>
        {SOON.map((label) => (
          <div
            key={label}
            className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-sm text-muted/50"
          >
            <Boxes className="h-3.5 w-3.5" />
            {label}
          </div>
        ))}
      </nav>
      <div className="px-4 py-3 text-[11px] text-muted/60">Phase 2 · prd/phases</div>
    </aside>
  );
}
