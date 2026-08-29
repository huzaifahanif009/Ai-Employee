"use client";

import { ChevronRight, LogOut, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionIndicator } from "@/components/connection-indicator";
import { useAuth } from "@/lib/auth";
import { useTheme } from "@/lib/theme";

const THEME_CYCLE = ["system", "light", "dark"] as const;
const THEME_ICON = { system: Monitor, light: Sun, dark: Moon };

export function Topbar({ connected, title }: { connected: boolean; title: string }) {
  const { identity, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const ThemeIcon = THEME_ICON[theme];

  return (
    <header className="relative z-10 flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel/70 px-5 surface-glass">
      <div className="flex items-center gap-1.5 text-sm">
        <span className="text-muted-2">Praxis</span>
        <ChevronRight className="h-3.5 w-3.5 text-muted-2" />
        <h1 className="font-semibold">{title}</h1>
      </div>
      <div className="flex items-center gap-3">
        <ConnectionIndicator connected={connected} />
        <Button
          variant="ghost"
          size="icon"
          title={`Theme: ${theme}`}
          onClick={() => setTheme(THEME_CYCLE[(THEME_CYCLE.indexOf(theme) + 1) % 3])}
        >
          <ThemeIcon className="h-4 w-4" />
        </Button>
        {identity && (
          <div className="flex items-center gap-2.5 border-l border-line pl-3 text-xs">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-panel-2 text-[11px] font-semibold text-muted">
              {(identity.name?.[0] ?? "?").toUpperCase()}
            </span>
            <div className="text-right leading-tight">
              <div className="font-medium text-text">{identity.name}</div>
              <div className="text-muted-2">{identity.role}</div>
            </div>
            <Button variant="ghost" size="icon" title="Sign out" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}
