"use client";

import { EVENT_TYPES } from "@praxis/event-schemas";
import { useEffect, useRef, useState } from "react";
import { API_URL } from "./config";
import { TokenStore } from "./token-store";

export interface StreamEvent<P = Record<string, unknown>> {
  id: string;
  type: string;
  ts: string;
  seq?: number;
  payload: P;
}

/**
 * Native EventSource wrapper. prd/11 §5 / ADR-0007: SSE for one-way streams;
 * reconnect + backfill is handled entirely server-side (Last-Event-ID), the
 * client just listens for every catalog type — no polling, no synthesized progress.
 */
function useEventSource(path: string | null, onEvent: (e: StreamEvent) => void) {
  const [connected, setConnected] = useState(false);
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (!path) return;
    const tokens = TokenStore.get();
    if (!tokens?.accessToken) return;

    const url = `${API_URL}${path}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(tokens.accessToken)}`;
    const es = new EventSource(url);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    const listener = (ev: MessageEvent<string>) => {
      if (ev.type === "heartbeat") return;
      let payload: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(ev.data);
        payload = parsed.payload ?? parsed;
      } catch {
        return;
      }
      handlerRef.current({ id: ev.lastEventId, type: ev.type, ts: new Date().toISOString(), payload });
    };
    for (const type of EVENT_TYPES) es.addEventListener(type, listener);
    es.addEventListener("heartbeat", () => {});

    return () => {
      es.close();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  return connected;
}

/** All events for one Run, folded into state. Feeds the activity feed, plan, totals, etc. */
export function useRunStream(runId: string | null) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  useEffect(() => setEvents([]), [runId]);
  const connected = useEventSource(runId ? `/streams/runs/${runId}` : null, (e) =>
    setEvents((prev) => (prev.length > 2000 ? [...prev.slice(-1500), e] : [...prev, e])),
  );
  return { events, connected };
}

/** Fleet-wide events — used to trigger query invalidation, not stored in bulk. */
export function useFleetStream(onEvent: (e: StreamEvent) => void, enabled: boolean) {
  return useEventSource(enabled ? "/streams/fleet" : null, onEvent);
}
