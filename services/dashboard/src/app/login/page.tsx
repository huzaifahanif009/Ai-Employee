"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authErrorMessage, useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, register, status } = useAuth();
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("admin@praxis.local");
  const [password, setPassword] = useState("ChangeMe123!");
  const [name, setName] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") router.replace("/");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "login") await login(email, password);
      else await register({ email, password, name, tenantName });
      router.replace("/");
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app-backdrop flex min-h-full items-center justify-center px-4">
      <div className="relative z-10 w-full max-w-sm animate-scale-in">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-[10px] [background-image:var(--gradient-accent)] shadow-[var(--glow-accent)]">
            <span className="text-base font-bold text-accent-fg">P</span>
          </span>
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">Praxis</div>
            <div className="text-xs text-muted-2">execution platform · operations console</div>
          </div>
        </div>

        <form
          onSubmit={submit}
          className="space-y-3 rounded-[var(--radius)] border border-line bg-panel p-5 shadow-[var(--shadow-lg)]"
        >
          <div className="mb-1 flex gap-1 rounded-md bg-panel-2 p-1 text-sm">
            <button
              type="button"
              onClick={() => setMode("login")}
              className={`flex-1 rounded px-2 py-1.5 ${mode === "login" ? "bg-panel text-text" : "text-muted"}`}
            >
              Sign in
            </button>
            <button
              type="button"
              onClick={() => setMode("register")}
              className={`flex-1 rounded px-2 py-1.5 ${mode === "register" ? "bg-panel text-text" : "text-muted"}`}
            >
              New tenant
            </button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {mode === "register" && (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tenantName">Tenant / org name</Label>
                <Input
                  id="tenantName"
                  value={tenantName}
                  onChange={(e) => setTenantName(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          {error && <p className="text-xs text-err">{error}</p>}

          <Button type="submit" className="w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {mode === "login" ? "Sign in" : "Create tenant"}
          </Button>

          {mode === "login" && (
            <p className="pt-1 text-center text-xs text-muted">
              Seeded demo: <code className="text-text">admin@praxis.local</code> /{" "}
              <code className="text-text">ChangeMe123!</code>
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
