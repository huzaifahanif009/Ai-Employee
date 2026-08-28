"use client";

import { useCallback, useEffect, useState } from "react";

type Theme = "light" | "dark" | "system";
const KEY = "praxis.theme";

function apply(theme: Theme) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  useEffect(() => {
    const stored = (localStorage.getItem(KEY) as Theme | null) ?? "system";
    setThemeState(stored);
    apply(stored);
  }, []);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    localStorage.setItem(KEY, t);
    apply(t);
  }, []);

  return { theme, setTheme };
}

/** Inline in <head> to set the theme attribute before first paint (no flash). */
export const themeInitScript = `
try {
  var t = localStorage.getItem('${KEY}');
  if (t && t !== 'system') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
`;
