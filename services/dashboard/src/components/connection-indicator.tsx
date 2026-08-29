import { cn } from "@/lib/utils";

export function ConnectionIndicator({ connected }: { connected: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        connected ? "border-ok/25 bg-ok/10 text-ok" : "border-warn/25 bg-warn/10 text-warn",
      )}
    >
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
