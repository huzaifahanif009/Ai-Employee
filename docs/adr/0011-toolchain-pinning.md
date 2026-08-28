# ADR-0011 — Scaffold toolchain pinned to the build machine

**Status:** Accepted · **Date:** 2026-08-28

## Context
The PRD targets Node 22 + pnpm 10 + Python 3.12. The current build machine has Node 20.20, npm (no pnpm), Python 3.10, Docker 29.

## Decision
The scaffold runs as-is on the current machine:

| Concern | PRD target | Scaffold now | Path forward |
|---|---|---|---|
| Node | 22 | 20.11+ (`engines`) | bump `engines` + CI matrix when 22 is installed; no code depends on 22-only APIs |
| Package manager | pnpm 10 | **npm workspaces** | `pnpm-workspace.yaml` kept in sync; switch is `rm package-lock.json && pnpm i` |
| Python | 3.12 | 3.10+ (`requires-python = ">=3.10"`) | raise floor when 3.12 is available |
| Container base images | slim/distroless, 22 / 3.12 | `node:20-slim` / `python:3.11-slim` | bump in one place per Dockerfile |

CI (added later) will run the PRD-target versions; local dev uses whatever is installed within these floors.

## Consequences
- A `pnpm-lock.yaml` is not committed yet; `package-lock.json` is.
- No feature work is blocked; the deltas are single-line bumps.
