"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { API_URL } from "./config";
import { TokenStore } from "./token-store";

export type ControlOp = "pause" | "resume" | "cancel" | "comment";
type Frame = { event: string; data: Record<string, unknown> };

const WS_URL = API_URL.replace(/^http/, "ws") + "/control";
const ACK_TIMEOUT_MS = 8000;

/**
 * Run-control over the WebSocket channel (/api/v1/control), with the REST
 * endpoints (`POST /runs/:id/:op`) as an automatic fallback whenever the socket
 * isn't open. The socket also confirms each action with a `control:ack` /
 * `control:error` frame so the caller gets a real success/failure, not just a
 * fire-and-forget. Server→client run events still arrive over SSE (useRunStream)
 * — this hook doesn't duplicate them.
 */
export function useRunControlChannel(runId: string | null) {
  const qc = useQueryClient();
  const [wsConnected, setWsConnected] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const waiters = useRef<Map<string, { resolve: () => void; reject: (e: Error) => void; timer: number }>>(
    new Map(),
  );

  useEffect(() => {
    if (!runId) return;
    const token = TokenStore.get()?.accessToken;
    if (!token) return;

    let closedByUs = false;
    let retry: number | undefined;

    const connect = () => {
      const ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      wsRef.current = ws;

      ws.onopen = () => ws.send(JSON.stringify({ event: "subscribe", data: { runId } }));

      ws.onmessage = (ev) => {
        let f: Frame;
        try {
          f = JSON.parse(ev.data as string);
        } catch {
          return;
        }
        if (f.event === "subscribed") setWsConnected(true);
        if (f.event === "hello") return;

        if (f.event === "control:ack" || f.event === "control:error") {
          const key = `${f.data.runId}:${f.data.op}`;
          const w = waiters.current.get(key);
          if (w) {
            waiters.current.delete(key);
            window.clearTimeout(w.timer);
            f.event === "control:ack"
              ? w.resolve()
              : w.reject(new Error(String(f.data.message ?? "control failed")));
          }
        }
      };

      ws.onclose = () => {
        setWsConnected(false);
        wsRef.current = null;
        if (!closedByUs) retry = window.setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      closedByUs = true;
      if (retry) window.clearTimeout(retry);
      for (const w of waiters.current.values()) window.clearTimeout(w.timer);
      waiters.current.clear();
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
    };
  }, [runId]);

  const control = useCallback(
    async (op: ControlOp, body?: { reason?: string; text?: string }) => {
      if (!runId) return;
      setIsPending(true);
      try {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && wsConnected) {
          await new Promise<void>((resolve, reject) => {
            const key = `${runId}:${op}`;
            const timer = window.setTimeout(() => {
              waiters.current.delete(key);
              reject(new Error("control timed out"));
            }, ACK_TIMEOUT_MS);
            waiters.current.set(key, { resolve, reject, timer });
            ws.send(JSON.stringify({ event: "control", data: { runId, op, body } }));
          });
        } else {
          await api.post(`/runs/${runId}/${op}`, body ?? {});
        }
        qc.invalidateQueries({ queryKey: ["runs", runId] });
        qc.invalidateQueries({ queryKey: ["runs"] });
      } finally {
        setIsPending(false);
      }
    },
    [runId, wsConnected, qc],
  );

  return { wsConnected, isPending, control, transport: wsConnected ? ("ws" as const) : ("rest" as const) };
}
