import { cn } from "@/lib/utils";

export function ConnectionIndicator({ connected }: { connected: boolean }) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-muted">
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          connected ? "bg-ok" : "animate-pulse-dot bg-warn",
        )}
      />
      {connected ? "live" : "reconnecting…"}
    </div>
  );
}
