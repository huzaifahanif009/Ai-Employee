/**
 * The browser talks to `core` directly (it already sets permissive CORS — see
 * services/core/src/main.ts) rather than through a reverse proxy, so SSE streams
 * are never buffered by an intermediary. Override at build/run time with
 * NEXT_PUBLIC_API_URL if core isn't reachable at localhost:3000 from the browser.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:3000/api/v1";

export const TOKEN_STORAGE_KEY = "praxis.tokens";
