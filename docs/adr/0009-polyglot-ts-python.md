# ADR-0009 — Polyglot: TypeScript control plane + Python agent runtime

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/04 §2

## Context
The team already runs NestJS + Angular (EDAP Workdesk). The agent / LLM / MCP / code-intelligence / eval ecosystems are Python-first, and LangGraph's richest surface is Python.

## Decision
- **Control plane** (API, orchestration glue, model router, connectors, event fan-out, dashboard BFF): **TypeScript / NestJS**.
- **Agent runtime** (LangGraph graphs, tool executors, repo-map/tree-sitter, embeddings, eval harness): **Python**.
- Contract between them: **gRPC** (proto-defined) for control-plane ↔ agent-worker RPC; shared **event schemas** (JSON Schema → generated types for both languages). No shared code, only shared contracts.
- Go is permitted only for a proven-necessary component (candidate: SSE fan-out gateway), decided by a spike.

## Consequences
- Two runtimes to build/test/deploy — mitigated by a thin gRPC boundary, one migration owner (TS), and shared schema codegen.
