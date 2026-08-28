"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { TokenStore } from "./token-store";
import type { AuthTokens, Identity } from "./types";

interface AuthState {
  identity: Identity | null;
  status: "loading" | "authenticated" | "anonymous";
  login: (email: string, password: string) => Promise<void>;
  register: (input: {
    email: string;
    password: string;
    name: string;
    tenantName: string;
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [status, setStatus] = useState<AuthState["status"]>("loading");

  const loadIdentity = useCallback(async () => {
    if (!TokenStore.get()) {
      setIdentity(null);
      setStatus("anonymous");
      return;
    }
    try {
      const me = await api.get<Identity>("/auth/me");
      setIdentity(me);
      setStatus("authenticated");
    } catch {
      setIdentity(null);
      setStatus("anonymous");
    }
  }, []);

  useEffect(() => {
    void loadIdentity();
    return TokenStore.subscribe((tokens) => {
      if (!tokens) {
        setIdentity(null);
        setStatus("anonymous");
      }
    });
  }, [loadIdentity]);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await api.anonymous.post<AuthTokens>("/auth/login", { email, password });
      TokenStore.set(tokens);
      await loadIdentity();
    },
    [loadIdentity],
  );

  const register = useCallback(
    async (input: { email: string; password: string; name: string; tenantName: string }) => {
      const tokens = await api.anonymous.post<AuthTokens>("/auth/register", input);
      TokenStore.set(tokens);
      await loadIdentity();
    },
    [loadIdentity],
  );

  const logout = useCallback(() => {
    TokenStore.set(null);
    setIdentity(null);
    setStatus("anonymous");
  }, []);

  return (
    <AuthContext.Provider value={{ identity, status, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

export function authErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong";
}
