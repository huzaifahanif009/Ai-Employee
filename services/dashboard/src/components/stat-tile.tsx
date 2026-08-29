import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  accent,
  icon: Icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "ok" | "warn" | "err" | "accent";
  icon?: LucideIcon;
}) {
  return (
    <div className="hover-lift group relative flex-1 overflow-hidden rounded-[var(--radius)] border border-line bg-panel px-4 py-3.5 shadow-[var(--shadow)]">
      <div
        className={cn(
          "pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-[0.12] blur-xl transition-opacity group-hover:opacity-25",
          accent === "ok" && "bg-ok",
          accent === "warn" && "bg-warn",
          accent === "err" && "bg-err",
          (accent === "accent" || !accent) && "bg-accent",
        )}
      />
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-2" />}
      </div>
      <div
        className={cn(
          "mt-1.5 text-[26px] font-semibold leading-none tabular-nums",
          accent === "ok" && "text-ok",
          accent === "warn" && "text-warn",
          accent === "err" && "text-err",
          accent === "accent" && "text-gradient",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
