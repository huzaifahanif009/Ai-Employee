# ADR-0007 — SSE for streams, WebSocket for control; AG-UI-shaped events

**Status:** Accepted · **Date:** 2026-08-28 · **Refs:** prd/04 §8, prd/11 §5, prd/12

## Context
The dashboard needs high-volume one-way streams (tokens, tool calls, logs, counters) and a low-volume bidirectional control channel (pause/resume/comment, approval actions, presence).

## Decision
- **SSE** for one-way streams — CDN/proxy-friendly, native `EventSource` auto-reconnect, `Last-Event-ID` backfill from `run_event`, stateless horizontal scale (no sticky sessions).
- **WebSocket** for the interactive control channel — JWT on upgrade, RBAC per op and per subscribed topic.
- Event **shape follows AG-UI** naming (`RUN_STEP_START`, `TOOL_CALL_START`, `TOOL_CALL_RESULT`, `TEXT_MESSAGE_CONTENT`, …) so third-party / CopilotKit-style UIs can consume the stream.

The dashboard opens one fleet SSE, one SSE per open Run, and one shared control WS.

## Consequences
- Two transports to maintain, but each is simple and matches its traffic shape.
- If Node can't hold target SSE connection counts, a Go fan-out gateway is pre-approved (prd/04 §8 revisit trigger).
