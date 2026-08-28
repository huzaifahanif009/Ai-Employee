"use client";

import { TOKEN_STORAGE_KEY } from "./config";
import type { AuthTokens } from "./types";

type Listener = (tokens: AuthTokens | null) => void;

let current: AuthTokens | null = null;
let hydrated = false;
const listeners = new Set<Listener>();

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(TOKEN_STORAGE_KEY);
    current = raw ? (JSON.parse(raw) as AuthTokens) : null;
  } catch {
    current = null;
  }
}

export const TokenStore = {
  get(): AuthTokens | null {
    hydrate();
    return current;
  },
  set(tokens: AuthTokens | null) {
    hydrate();
    current = tokens;
    try {
      if (typeof window !== "undefined") {
        if (tokens) window.localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
        else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
      }
    } catch {
      /* private browsing / storage blocked — in-memory still works for this tab */
    }
    listeners.forEach((l) => l(current));
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
