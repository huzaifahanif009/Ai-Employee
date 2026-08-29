"use client";

import { EVENT_TYPES, RUN_STATES } from "@praxis/event-schemas";
import {
  Boxes,
  Database,
  GitBranch,
  Globe,
  KeyRound,
  Layers,
  MonitorSmartphone,
  Radio,
  Server,
  ShieldCheck,
  Workflow,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useConnectors, useProviderKinds } from "@/lib/hooks";
import { cn } from "@/lib/utils";

/* ─────────────────────────────────────────────────────────────────────────────
   This screen is a living map of the ACTUAL implementation. Per the team rule
   it is updated in the same change as any phase / feature / API / schema shift.
   Last synced: 2026-08-29 — webhook signature verification + WS control channel.
   ──────────────────────────────────────────────────────────────────────────── */

type Node = {
  id: string;
  label: string;
  sub: string;
  icon: typeof Server;
  tone: "accent" | "ok" | "warn" | "muted";
  detail: {
    what: string;
    points: string[];
    tech?: string[];
  };
};

const TIERS: { title: string; nodes: Node[] }[] = [
  {
    title: "Client",
    nodes: [
      {
        id: "dashboard",
        label: "Praxis Dashboard",
        sub: "Next.js 16 · React 19",
        icon: MonitorSmartphone,
        tone: "accent",
        detail: {
          what: "Operator console. Talks to Core directly (CORS open) — no reverse proxy, so SSE/WS are never buffered.",
          points: [
            "Screens: Overview, Runs, Run detail, Approvals, Work Items, Integrations, AI Providers, Architecture",
            "TanStack Query for REST, native EventSource for run/fleet streams, native WebSocket for control",
            "Tailwind v4 tokens, dark-first, light/system themes, @praxis/event-schemas as the shared event catalog",
          ],
          tech: ["next", "react", "@tanstack/react-query", "tailwindcss v4", "radix"],
        },
      },
    ],
  },
  {
    title: "Control plane — Core API (NestJS · :3000/api/v1)",
    nodes: [
      {
        id: "auth",
        label: "Auth & RBAC",
        sub: "JWT · argon2 · capability matrix",
        icon: ShieldCheck,
        tone: "ok",
        detail: {
          what: "Global AuthGuard verifies the JWT, builds a RequestContext, and enforces @RequireCapability metadata.",
          points: [
            "Access + refresh tokens; passwords hashed with argon2; refresh rotation",
            "13 capabilities × 6 roles (owner/admin/maintainer/operator/viewer/service)",
            "RFC 9457 Problem Details on every error",
          ],
        },
      },
      {
        id: "runs",
        label: "Runs",
        sub: "state machine · driver · control gateway",
        icon: Workflow,
        tone: "accent",
        detail: {
          what: "Owns the Run lifecycle. InprocRunDriver advances a run today (Temporal RunWorkflow swaps in next).",
          points: [
            "REST: list/get/start + pause/resume/cancel/comment",
            "WebSocket ControlGateway at /api/v1/control — JWT handshake, per-run subscribe, control:ack, run:control RBAC",
            "Gap-free per-run event seq via a Postgres advisory lock",
          ],
        },
      },
      {
        id: "approvals",
        label: "Approvals (HITL)",
        sub: "plan · delivery · budget gates",
        icon: ShieldCheck,
        tone: "warn",
        detail: {
          what: "ApprovalGateService.raiseAndWait() blocks a run until a human decides. Driver-agnostic — a Temporal-signalled version drops in unchanged.",
          points: [
            "Gate types wired: plan, delivery, budget (soft-over-budget)",
            "Decision endpoint is RBAC-gated; reject / override require a note",
            "SLA timer; decisions surface over SSE as approval.* events",
          ],
        },
      },
      {
        id: "model",
        label: "Model Router",
        sub: "tenant resolve · adapters · stub fallback",
        icon: Zap,
        tone: "accent",
        detail: {
          what: "Resolves the tenant's model + key, calls the provider adapter directly, and falls back to the always-on stub when no valid key resolves.",
          points: [
            "AiRegistryService.resolve(modelHint | routingClass | purpose)",
            "Redacts every active provider secret from prompts before the call",
            "model_call cost ledger + model_call.* events (incl. model_call.fallback); exact Redis cache",
          ],
        },
      },
      {
        id: "aireg",
        label: "AI Providers",
        sub: "providers · keys · models",
        icon: KeyRound,
        tone: "ok",
        detail: {
          what: "Per-tenant, dashboard-managed registry. No provider keys in env.",
          points: [
            "ai_provider / ai_provider_key / ai_model tables; keys AES-256-GCM at rest",
            "API returns only a masked last-4 + test status — never ciphertext, never logged",
            "Extensible ProviderClient adapters: openai / openai-compatible / azure-openai / anthropic / google",
          ],
        },
      },
      {
        id: "connectors",
        label: "Connectors",
        sub: "VCS + Tracker · encrypted secrets",
        icon: GitBranch,
        tone: "ok",
        detail: {
          what: "GitLab & GitHub, each serving both the VcsProvider and TrackerProvider contracts.",
          points: [
            "Tokens AES-256-GCM at rest; API returns a ••••1234 hint only",
            "Inbound webhooks authenticated: GitHub X-Hub-Signature-256 HMAC over the raw body / GitLab X-Gitlab-Token, constant-time",
            "POST /connectors/:id/webhook-secret rotates the secret (shown once)",
          ],
        },
      },
      {
        id: "intake",
        label: "Intake",
        sub: "cron poll · sync · webhooks",
        icon: Radio,
        tone: "muted",
        detail: {
          what: "Turns tracker issues into WorkItems and drives the close-loop.",
          points: [
            "@Cron poll (once/min) + POST /projects/:id/intake/sync + public POST /webhooks/in/:connectorId",
            "Idempotent upsertFromDraft; per-project intakeCursor",
            "On PR/MR merged/closed → close the WorkItem + transition the source issue",
          ],
        },
      },
      {
        id: "sandbox",
        label: "Sandbox + Tool Broker",
        sub: "Docker backend · native tools",
        icon: Boxes,
        tone: "warn",
        detail: {
          what: "DockerSandboxProvider shells the docker CLI against a mounted socket. ADR-0005: the docker backend is NOT an isolation boundary — Firecracker/gVisor later.",
          points: [
            "Tools: fs.read|write|list, shell.exec, code.search, test.run, git.*",
            "tool_call ledger + tool_call.* events; risk tiers auto/notify/approve/forbidden",
            "git.push is forbidden as a tool — credentialed push is a direct sandbox exec",
          ],
        },
      },
      {
        id: "events",
        label: "Events",
        sub: "run_event · outbox · EventBus",
        icon: Layers,
        tone: "accent",
        detail: {
          what: "run_event is the source of truth; a transactional outbox publishes to the EventBus.",
          points: [
            `${EVENT_TYPES.length}-type event catalog; ${RUN_STATES.length} run states with a validated transition table`,
            "EventBus driver: memory | redis-streams (redis-streams in the running stack)",
            "SSE delivery with Last-Event-ID backfill from run_event by seq",
          ],
        },
      },
    ],
  },
  {
    title: "Data & infrastructure",
    nodes: [
      {
        id: "postgres",
        label: "PostgreSQL 16",
        sub: "system of record",
        icon: Database,
        tone: "ok",
        detail: {
          what: "TypeORM 0.3, expand-only migrations. Host port 5433 on this machine (native PG holds 5432).",
          points: [
            "tenant · user · membership · project · work_item",
            "run · run_event · approval · model_call · tool_call",
            "connector · ai_provider · ai_provider_key · ai_model",
          ],
        },
      },
      {
        id: "redis",
        label: "Redis 7",
        sub: "streams bus · cache",
        icon: Zap,
        tone: "accent",
        detail: {
          what: "Backs the redis-streams EventBus and the Model Router's exact-match response cache.",
          points: ["ioredis client", "stream maxlen trimming", "consumer-group delivery per subscriber"],
        },
      },
      {
        id: "temporal",
        label: "Temporal",
        sub: "orchestrator — wiring next",
        icon: Workflow,
        tone: "muted",
        detail: {
          what: "RunWorkflow skeleton exists (deterministic step sequence, HITL signal gates). Not the advancer yet — RUN_DRIVER=inproc today.",
          points: [
            "Own postgres-temporal + temporal-ui (:8088)",
            "Phase 2: RUN_DRIVER=temporal + run @praxis/orchestrator as the advancer",
            "Approval gates already driver-agnostic — carry over unchanged",
          ],
        },
      },
      {
        id: "minio",
        label: "MinIO / S3",
        sub: "artifact store",
        icon: Database,
        tone: "muted",
        detail: {
          what: "Object storage for run artifacts (diffs, logs, bundles). Provisioned; deeper use lands with the orchestrator.",
          points: ["path-style addressing", "praxis-artifacts bucket", "S3-compatible API"],
        },
      },
    ],
  },
  {
    title: "External",
    nodes: [
      {
        id: "git",
        label: "GitHub / GitLab",
        sub: "repos · PRs/MRs · issues · webhooks",
        icon: Globe,
        tone: "ok",
        detail: {
          what: "Self-hosted or SaaS via a configurable base URL. One connector serves VCS and Tracker.",
          points: [
            "GitLab REST v4 · GitHub REST v3 (+ GHE)",
            "repos, branches, protected branches, read-at-ref, open/update PR/MR, comments, checks",
            "Verified live against gitlab.edap.com.pk — a run opened real MR !2",
          ],
        },
      },
      {
        id: "llm",
        label: "LLM providers",
        sub: "OpenAI · Anthropic · Google · Azure",
        icon: Zap,
        tone: "accent",
        detail: {
          what: "Reached only through ProviderClient adapters with a normalized OpenAI-shaped response. Keys come from the AI Providers registry.",
          points: [
            "openai · openai-compatible · azure-openai · anthropic · google",
            "Always-on praxis-stub via LiteLLM when no valid key resolves",
            "Every response normalized to { text, toolCalls?, usage }",
          ],
        },
      },
    ],
  },
];

const TONE: Record<Node["tone"], string> = {
  accent: "border-accent/30 bg-accent/5 hover:border-accent/60",
  ok: "border-ok/30 bg-ok/5 hover:border-ok/60",
  warn: "border-warn/30 bg-warn/5 hover:border-warn/60",
  muted: "border-line bg-panel-2/40 hover:border-line-strong",
};
const ICON_TONE: Record<Node["tone"], string> = {
  accent: "text-accent",
  ok: "text-ok",
  warn: "text-warn",
  muted: "text-muted-2",
};

type Stage = {
  key: string;
  title: string;
  by: string;
  does: string;
  events: string[];
};

const LIFECYCLE: Stage[] = [
  {
    key: "intake",
    title: "Intake",
    by: "IntakeService · Connectors",
    does: "A tracker poll, a signed inbound webhook, or a manual create produces a WorkItem via idempotent upsertFromDraft.",
    events: ["work_item.created", "work_item.updated"],
  },
  {
    key: "plan",
    title: "Plan",
    by: "Runs · Model Router",
    does: "Triage + plan model calls run through the Model Router; an ordered step list is emitted.",
    events: ["run.state_changed → planning", "plan.created", "plan.step_defined"],
  },
  {
    key: "plan-gate",
    title: "Plan approval",
    by: "ApprovalGateService (HITL)",
    does: "REQUIRE_PLAN_APPROVAL blocks the run; a reviewer approves or rejects (reject needs a note).",
    events: ["run.state_changed → awaiting_plan_approval", "approval.requested", "approval.decided"],
  },
  {
    key: "execute",
    title: "Execute",
    by: "Sandbox · Tool Broker · Model Router",
    does: "Acquire a container, clone the real repo (or a fixture), then per step: a coder model call + fs/git tool calls, all ledgered.",
    events: ["run.state_changed → executing", "run_step.started/finished", "tool_call.*", "model_call.*"],
  },
  {
    key: "verify",
    title: "Verify",
    by: "Tool Broker (test.run)",
    does: "Run the project's tests inside the sandbox; a fail ends the run as tests_never_passed.",
    events: ["run.state_changed → verifying", "verify.started", "verify.check_finished", "verify.finished"],
  },
  {
    key: "review",
    title: "Review",
    by: "Model Router (reviewer)",
    does: "A reviewer model call assesses the diff against the acceptance criteria.",
    events: ["run.state_changed → reviewing", "review.started", "review.finished"],
  },
  {
    key: "deliver-gate",
    title: "Delivery approval",
    by: "ApprovalGateService (optional)",
    does: "REQUIRE_DELIVERY_APPROVAL, when on, gates the push the same way the plan gate does.",
    events: ["run.state_changed → awaiting_delivery_approval", "approval.requested"],
  },
  {
    key: "deliver",
    title: "Deliver",
    by: "Sandbox · VcsProvider · TrackerProvider",
    does: "Branch, commit, credentialed push, open a PR/MR, and comment the source issue with the link. Human merges manually.",
    events: ["run.state_changed → delivering", "git.branch.created", "git.pushed", "vcs.pr.opened", "run.completed"],
  },
  {
    key: "close",
    title: "Close-loop",
    by: "WebhooksController",
    does: "A signed PR/MR merged/closed webhook finds the run by branch, closes the WorkItem, and transitions the source issue.",
    events: ["git.pr.merged / git.pr.closed", "work_item.closed / rejected"],
  },
];

const API_SURFACE: { group: string; routes: string[] }[] = [
  { group: "Auth", routes: ["POST /auth/login", "POST /auth/refresh", "GET /auth/me"] },
  { group: "Runs", routes: ["GET /runs", "GET /runs/:id", "POST /runs", "POST /runs/:id/{pause,resume,cancel,comment}", "GET /runs/:id/{events,model-calls,tool-calls}"] },
  { group: "Approvals", routes: ["GET /approvals", "POST /approvals/:id/decision"] },
  { group: "Work items / Intake", routes: ["GET/POST /work-items", "POST /projects/:id/intake/sync", "POST /webhooks/in/:connectorId (signed, public)"] },
  { group: "Connectors", routes: ["GET/POST/PATCH/DELETE /connectors", "POST /connectors/:id/{test,webhook-secret}", "GET /connectors/:id/repos"] },
  { group: "AI", routes: ["GET /ai/provider-kinds", "GET/POST /ai/providers", "POST /ai/providers/:id/keys", "POST /ai/keys/:id/test", "GET/POST /ai/models"] },
  { group: "Model / Tools", routes: ["GET /ai/models", "GET /model/health", "GET /tools/catalog"] },
  { group: "Streams", routes: ["GET /streams/runs/:id (SSE)", "GET /streams/fleet (SSE)", "WS /control"] },
];

const SECURITY: { title: string; body: string }[] = [
  { title: "Identity", body: "JWT access+refresh, argon2 password hashing, refresh rotation, global AuthGuard." },
  { title: "Authorization", body: "13-capability × 6-role matrix; every mutation carries @RequireCapability; enforced in one guard." },
  { title: "Secrets at rest", body: "AES-256-GCM (aesgcm.v1., tamper-evident) for connector tokens, webhook secrets, and provider API keys. Only masked hints leave the server." },
  { title: "Prompt safety", body: "Model Router strips every active provider secret + known key patterns from messages; scrubKey scrubs provider-echoed key fragments from stored test details." },
  { title: "Inbound webhooks", body: "GitHub HMAC-SHA256 over the raw body / GitLab shared token, constant-time compare; WEBHOOK_REQUIRE_SIGNATURE rejects unverified deliveries (401 / 403)." },
  { title: "Sandbox", body: "Per-run Docker container, labelled + torn down. Explicitly not an isolation boundary (ADR-0005) — Firecracker/gVisor + egress allowlist are Phase 2." },
];

export default function ArchitecturePage() {
  const [selected, setSelected] = useState<Node | null>(null);
  const [stage, setStage] = useState<Stage>(LIFECYCLE[0]);
  const { data: connectors } = useConnectors();
  const { data: kinds } = useProviderKinds();

  return (
    <div className="space-y-6">
      {/* hero */}
      <div className="relative overflow-hidden rounded-[var(--radius)] border border-line bg-panel p-6 shadow-[var(--shadow)]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full opacity-20 blur-3xl [background-image:var(--gradient-accent)]" />
        <div className="relative">
          <div className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wider text-muted-2">
            <span className="h-1.5 w-1.5 rounded-full bg-ok" />
            living document · synced 2026-08-29
          </div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">
            How <span className="text-gradient">Praxis</span> fits together
          </h2>
          <p className="mt-1.5 max-w-2xl text-sm text-muted">
            A provider-agnostic AI execution platform: it pulls work from a tracker, plans it, runs
            the change in a sandbox with human gates, verifies end-to-end, and opens a PR/MR for a
            person to merge. This map mirrors what is actually built.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="accent">{EVENT_TYPES.length} event types</Badge>
            <Badge variant="accent">{RUN_STATES.length} run states</Badge>
            <Badge variant="ok">{connectors?.length ?? 0} connector{(connectors?.length ?? 0) === 1 ? "" : "s"}</Badge>
            <Badge variant="ok">{kinds?.length ?? 5} provider kinds</Badge>
            <Badge variant="muted">SSE + WebSocket + REST</Badge>
          </div>
        </div>
      </div>

      {/* system map */}
      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>System map</CardTitle>
            <span className="text-xs text-muted-2">click any component</span>
          </CardHeader>
          <CardContent className="space-y-4">
            {TIERS.map((tier, ti) => (
              <div key={tier.title}>
                <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-2">
                  <Server className="h-3 w-3" />
                  {tier.title}
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {tier.nodes.map((n) => {
                    const Icon = n.icon;
                    const active = selected?.id === n.id;
                    return (
                      <button
                        key={n.id}
                        onClick={() => setSelected(active ? null : n)}
                        className={cn(
                          "flex items-start gap-2.5 rounded-[10px] border p-2.5 text-left transition-all duration-150",
                          TONE[n.tone],
                          active && "ring-2 ring-[var(--ring)]",
                        )}
                      >
                        <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", ICON_TONE[n.tone])} />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">{n.label}</span>
                          <span className="block truncate text-[11px] text-muted">{n.sub}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
                {ti < TIERS.length - 1 && (
                  <div className="mt-3 flex justify-center">
                    <svg width="18" height="16" viewBox="0 0 18 16" className="text-line-strong">
                      <path d="M9 0v10M4 7l5 6 5-6" stroke="currentColor" strokeWidth="1.5" fill="none" className="flow-line" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card glow={!!selected} className="h-fit lg:sticky lg:top-4">
          <CardHeader>
            <CardTitle>{selected ? selected.label : "Component detail"}</CardTitle>
            {selected && <Badge variant={selected.tone === "muted" ? "muted" : (selected.tone as "accent")}>{selected.sub}</Badge>}
          </CardHeader>
          <CardContent>
            {!selected && (
              <p className="py-8 text-center text-sm text-muted">
                Select a component in the map to see what it does, how it connects, and the tech
                behind it.
              </p>
            )}
            {selected && (
              <div className="animate-fade-up space-y-3">
                <p className="text-sm text-muted">{selected.detail.what}</p>
                <ul className="space-y-1.5">
                  {selected.detail.points.map((p) => (
                    <li key={p} className="flex gap-2 text-xs">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
                {selected.detail.tech && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {selected.detail.tech.map((t) => (
                      <span key={t} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[10px] text-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* run lifecycle */}
      <Card>
        <CardHeader>
          <CardTitle>Run lifecycle — data flow</CardTitle>
          <span className="text-xs text-muted-2">InprocRunDriver today · Temporal RunWorkflow next</span>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="scroll-thin flex gap-1.5 overflow-x-auto pb-1">
            {LIFECYCLE.map((s, i) => {
              const active = stage.key === s.key;
              return (
                <button
                  key={s.key}
                  onClick={() => setStage(s)}
                  className={cn(
                    "flex shrink-0 items-center gap-2 rounded-[10px] border px-3 py-2 text-xs transition-all duration-150",
                    active
                      ? "border-accent/50 bg-accent/10 text-text"
                      : "border-line bg-panel-2/40 text-muted hover:text-text",
                  )}
                >
                  <span
                    className={cn(
                      "grid h-5 w-5 place-items-center rounded-full text-[10px] font-semibold",
                      active ? "[background-image:var(--gradient-accent)] text-accent-fg" : "bg-panel-3 text-muted",
                    )}
                  >
                    {i + 1}
                  </span>
                  {s.title}
                </button>
              );
            })}
          </div>
          <div className="animate-fade-up rounded-[10px] border border-line bg-panel-2/40 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">{stage.title}</span>
              <Badge variant="muted">{stage.by}</Badge>
            </div>
            <p className="mt-2 text-sm text-muted">{stage.does}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {stage.events.map((e) => (
                <span key={e} className="rounded bg-panel px-1.5 py-0.5 font-mono text-[10px] text-accent">
                  {e}
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* reference grid */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>API surface</CardTitle>
            <span className="text-xs text-muted-2">prefix /api/v1</span>
          </CardHeader>
          <CardContent className="space-y-3">
            {API_SURFACE.map((g) => (
              <div key={g.group}>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-2">{g.group}</div>
                <ul className="mt-1 space-y-0.5">
                  {g.routes.map((r) => (
                    <li key={r} className="font-mono text-[11px] text-muted">{r}</li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>Real-time channels</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="rounded-[10px] border border-line bg-panel-2/40 p-3">
                <div className="flex items-center gap-2 font-medium">
                  <Radio className="h-3.5 w-3.5 text-accent" /> SSE — one-way streams
                </div>
                <p className="mt-1 text-xs text-muted">
                  /streams/runs/:id (Last-Event-ID backfill from run_event) and /streams/fleet. Feeds
                  the activity feed and query invalidation.
                </p>
              </div>
              <div className="rounded-[10px] border border-line bg-panel-2/40 p-3">
                <div className="flex items-center gap-2 font-medium">
                  <Zap className="h-3.5 w-3.5 text-accent" /> WebSocket — control channel
                </div>
                <p className="mt-1 text-xs text-muted">
                  /api/v1/control: JWT handshake, subscribe by run, pause/resume/cancel/comment with
                  control:ack. Dashboard falls back to REST when the socket is down.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Security model</CardTitle>
              <ShieldCheck className="h-4 w-4 text-ok" />
            </CardHeader>
            <CardContent className="space-y-2">
              {SECURITY.map((s) => (
                <div key={s.title} className="text-xs">
                  <span className="font-medium text-text">{s.title}. </span>
                  <span className="text-muted">{s.body}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
