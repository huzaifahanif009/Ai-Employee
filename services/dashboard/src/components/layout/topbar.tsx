"use client";

import { LogOut, Monitor, Moon, Sun } from "lucide-react";
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
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-line bg-panel px-5">
      <h1 className="text-sm font-semibold">{title}</h1>
      <div className="flex items-center gap-4">
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
          <div className="flex items-center gap-2 border-l border-line pl-4 text-xs">
            <div className="text-right">
              <div className="font-medium text-text">{identity.name}</div>
              <div className="text-muted">{identity.role}</div>
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
