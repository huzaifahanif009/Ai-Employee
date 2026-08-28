import { cn } from "@/lib/utils";

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
  accent?: "ok" | "warn" | "err" | "accent";
}) {
  return (
    <div className="flex-1 rounded-xl border border-line bg-panel px-4 py-3">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div
        className={cn(
          "mt-1 text-2xl font-semibold tabular-nums",
          accent === "ok" && "text-ok",
          accent === "warn" && "text-warn",
          accent === "err" && "text-err",
          accent === "accent" && "text-accent",
        )}
      >
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}
