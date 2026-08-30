"use client";

import {
  Activity,
  BarChart3,
  Bot,
  Boxes,
  BrainCircuit,
  CheckSquare,
  FolderGit2,
  LayoutGrid,
  ListTodo,
  Network,
  Plug,
  ScrollText,
  ServerCog,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; icon: LucideIcon };

const MAIN: NavItem[] = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/runs", label: "Runs", icon: Activity },
  { href: "/approvals", label: "Approvals", icon: CheckSquare },
  { href: "/work-items", label: "Work Items", icon: ListTodo },
  { href: "/agents", label: "Agents & Policies", icon: Bot },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
];

const SYSTEM: NavItem[] = [
  { href: "/projects", label: "Projects", icon: FolderGit2 },
  { href: "/integrations", label: "Integrations", icon: Plug },
  { href: "/ai", label: "AI Providers", icon: BrainCircuit },
  { href: "/audit", label: "Audit Log", icon: ScrollText },
  { href: "/system", label: "System Health", icon: ServerCog },
  { href: "/architecture", label: "Architecture", icon: Network },
];

const SOON: string[] = [];

function NavLink({ item, pathname, badge }: { item: NavItem; pathname: string; badge?: number }) {
  const { href, label, icon: Icon } = item;
  const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex items-center justify-between rounded-[10px] px-2.5 py-2 text-sm transition-all duration-150",
        active
          ? "bg-panel-2 text-text shadow-[inset_0_0_0_1px_var(--line)]"
          : "text-muted hover:bg-panel-2/60 hover:text-text",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full transition-all duration-200",
          active ? "opacity-100 [background-image:var(--gradient-accent)]" : "opacity-0",
        )}
      />
      <span className="flex items-center gap-2.5">
        <Icon
          className={cn(
            "h-4 w-4 transition-colors",
            active ? "text-accent" : "text-muted-2 group-hover:text-text",
          )}
        />
        {label}
      </span>
      {badge != null && badge > 0 && (
        <span className="rounded-full bg-warn/20 px-1.5 text-[10px] font-semibold text-warn">
          {badge}
        </span>
      )}
    </Link>
  );
}

export function Sidebar({ openApprovals }: { openApprovals: number }) {
  const pathname = usePathname();
  return (
    <aside className="relative z-10 flex w-60 shrink-0 flex-col border-r border-line bg-panel/80 surface-glass">
      <div className="flex items-center gap-2.5 px-4 py-4">
        <span className="grid h-8 w-8 place-items-center rounded-[10px] [background-image:var(--gradient-accent)] shadow-[var(--glow-accent)]">
          <span className="text-[15px] font-bold text-accent-fg">P</span>
        </span>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight">Praxis</div>
          <div className="text-[10px] text-muted-2">execution platform</div>
        </div>
      </div>

      <nav className="scroll-thin flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
        {MAIN.map((item) => (
          <NavLink
            key={item.href}
            item={item}
            pathname={pathname}
            badge={item.label === "Approvals" ? openApprovals : undefined}
          />
        ))}

        <div className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
          System
        </div>
        {SYSTEM.map((item) => (
          <NavLink key={item.href} item={item} pathname={pathname} />
        ))}

        {SOON.length > 0 && (
          <>
            <div className="px-2.5 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-muted-2">
              Roadmap
            </div>
            {SOON.map((label) => (
              <div
                key={label}
                className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-1.5 text-sm text-muted-2/60"
              >
                <Boxes className="h-3.5 w-3.5" />
                {label}
              </div>
            ))}
          </>
        )}
      </nav>

      <div className="border-t border-line px-4 py-3 text-[11px] text-muted-2">
        Phase 2 · <span className="text-muted">prd/phases</span>
      </div>
    </aside>
  );
}
