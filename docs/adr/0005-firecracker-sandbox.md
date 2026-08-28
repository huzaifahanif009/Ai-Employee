# ADR-0005 — Firecracker microVM sandbox pool, gVisor/docker fallbacks

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/04 §6, prd/14 §5

## Context
Agents execute untrusted code and arbitrary shell/build/test commands. Isolation must be hardware-grade, fast to start, ephemeral per Run, egress-controllable, snapshot/restore-able, with no ambient cloud creds — and it must work self-hosted and in a managed pool.

## Decision
A `SandboxProvider` interface with backends:

1. **`firecracker-pool`** (prod default) — warm pool of microVMs from a prebuilt rootfs (node/python/dotnet/java/go toolchains); overlay FS; per-Run network namespace + allowlisting egress proxy; snapshot on pause, restore on resume; hard GC on Run end.
2. **`gvisor`** — `runsc` for hosts without nested virtualization (some CI/K8s). Same API.
3. **`docker`** — local/trusted demos only; **documented as not an isolation boundary**.

Also expose **`e2b`** as an optional managed backend.

## Alternatives rejected
Docker-only (inadequate isolation), gVisor-only (GPU/passthrough limits, weaker boundary than a VM), E2B/Daytona/Modal SaaS (code leaves the box; dealbreaker for some customers). See prd/04 §6.

## Consequences
- We build the pool manager, rootfs images, networking, GC (Phase 1–2 spike work).
- Runbook needed for KVM/nested-virt node groups.
