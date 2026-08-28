import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.round(diffMs / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function countdown(iso: string): { label: string; urgent: boolean; passed: boolean } {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return { label: "SLA passed", urgent: true, passed: true };
  const m = Math.round(ms / 60000);
  const label = m < 60 ? `${m}m left` : `${Math.round(m / 60)}h left`;
  return { label, urgent: m < 15, passed: false };
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}
