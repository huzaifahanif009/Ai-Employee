# ADR-0012 — Dashboard framework: Next.js (not Angular)

**Status:** Accepted · **Date:** 2026-08-28 · **Supersedes the default in:** prd/04 §15, prd/12 §1 · **Refs:** ADR-0007

## Context
`prd/04` §15 named **Angular 21** as the default dashboard framework "to maximize velocity given the existing EDAP Workdesk Angular 21 codebase", with **Next.js/React an accepted alternative** and the BFF contract (REST + SSE + WS) deliberately framework-neutral so this stays a front-end-only decision.

On review, the stakeholder chose Next.js explicitly:
- The Praxis dashboard is a **separate product** from EDAP Workdesk — no code or component sharing was ever planned, so the "reuse the Angular codebase" argument doesn't apply.
- The dashboard is expected to grow substantially (prd/12 lists 12+ screens; prd/06 live-agent surfaces; future generative-UI / AG-UI work). The React ecosystem (shadcn/Radix, TanStack Query, AG-UI/CopilotKit bindings named in prd/04 §8) is the larger, better-supported base for that trajectory.

## Decision
Build the dashboard as a **Next.js 16 (App Router) + React 19 + TypeScript** app under `services/dashboard`:

- **Styling:** Tailwind CSS v4 + a small set of hand-rolled **shadcn-style** primitives over Radix (`button`, `card`, `badge`, `input`, `tabs`, `dialog`, `label`). Dark-first theme with a light/dark/system toggle (`data-theme` + `prefers-color-scheme`).
- **Data:** TanStack Query against `core` directly from the browser (core already sets permissive CORS) — **no reverse proxy**, so SSE streams are never buffered by an intermediary (ADR-0007).
- **Real-time:** native `EventSource`; the client subscribes to every type in `@praxis/event-schemas` `EVENT_TYPES` (imported as a workspace dep — one source of truth for the catalog, shared with `core`). No polling for progress; a 4–5s query refetch only *self-heals* a missed event (prd/12 §16 rule 3).
- **Auth:** JWT access+refresh in `localStorage` (matches core's scheme), a client `AuthProvider`, client-side route guard in the `(dashboard)` route-group layout.
- **Deploy:** `output: "standalone"` → a slim `node server.js` image; served on `:8080`.

## Consequences
- The org now runs two front-end stacks (Workdesk = Angular, Praxis = Next.js). Accepted: they are separate products with separate teams-of-record.
- `prd/04` §15 and `prd/12` §1 should be read with this ADR as the override; the "Revisit trigger" in prd/04 §15 is now moot.
- SSE-direct-to-core means the dashboard container is a pure static/SSR server with zero API knowledge beyond a base URL (`NEXT_PUBLIC_API_URL`).
