import { API_URL } from "./config";
import { TokenStore } from "./token-store";
import type { AuthTokens, ProblemDetails } from "./types";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly meta?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

let refreshInFlight: Promise<AuthTokens | null> | null = null;

async function refreshTokens(): Promise<AuthTokens | null> {
  const tokens = TokenStore.get();
  if (!tokens?.refreshToken) return null;
  if (!refreshInFlight) {
    refreshInFlight = fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: tokens.refreshToken }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<AuthTokens>) : null))
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  const next = await refreshInFlight;
  TokenStore.set(next);
  return next;
}

export interface RequestOpts extends RequestInit {
  /** skip the Authorization header (login/register/refresh) */
  anonymous?: boolean;
  idempotencyKey?: string;
}

async function request<T>(path: string, opts: RequestOpts = {}, retried = false): Promise<T> {
  const tokens = TokenStore.get();
  const headers = new Headers(opts.headers);
  headers.set("content-type", "application/json");
  if (!opts.anonymous && tokens?.accessToken) {
    headers.set("authorization", `Bearer ${tokens.accessToken}`);
  }
  if (opts.idempotencyKey) headers.set("idempotency-key", opts.idempotencyKey);

  const res = await fetch(`${API_URL}${path}`, { ...opts, headers });

  if (res.status === 401 && !opts.anonymous && !retried) {
    const refreshed = await refreshTokens();
    if (refreshed) return request<T>(path, opts, true);
    TokenStore.set(null);
  }

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("json");
  const body = isJson ? await res.json().catch(() => undefined) : undefined;

  if (!res.ok) {
    const problem = body as ProblemDetails | undefined;
    throw new ApiError(
      res.status,
      problem?.code ?? "INTERNAL",
      problem?.detail || problem?.title || res.statusText,
      problem?.meta,
    );
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body?: unknown, opts: RequestOpts = {}) =>
    request<T>(path, { ...opts, method: "POST", body: body ? JSON.stringify(body) : "{}" }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: "DELETE" }),
  anonymous: {
    post: <T>(path: string, body?: unknown) =>
      request<T>(path, { method: "POST", anonymous: true, body: JSON.stringify(body ?? {}) }),
  },
};
