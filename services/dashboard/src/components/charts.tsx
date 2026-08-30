"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";

/* Hand-rolled SVG charts — no dependency, theme-token colours, crisp at any size. */

export function Sparkline({
  data,
  className,
  stroke = "var(--accent)",
  fill = true,
  height = 34,
}: {
  data: number[];
  className?: string;
  stroke?: string;
  fill?: boolean;
  height?: number;
}) {
  const gid = useId();
  const w = 120;
  const h = height;
  const pts = data.length > 1 ? data : [0, 0];
  const max = Math.max(...pts, 1);
  const min = Math.min(...pts, 0);
  const span = max - min || 1;
  const step = w / (pts.length - 1);
  const coords = pts.map((v, i) => [i * step, h - 3 - ((v - min) / span) * (h - 6)] as const);
  const line = coords.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const area = `${line} L${w} ${h} L0 ${h} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className={cn("w-full", className)} style={{ height }}>
      <defs>
        <linearGradient id={`spark-${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.28" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {fill && <path d={area} fill={`url(#spark-${gid})`} />}
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={coords[coords.length - 1][0]} cy={coords[coords.length - 1][1]} r="2.4" fill={stroke} />
    </svg>
  );
}

export function Donut({
  segments,
  size = 168,
  thickness = 20,
  centerLabel,
  centerSub,
}: {
  segments: { label: string; value: number; color: string }[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0) || 1;
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel-2)" strokeWidth={thickness} />
        {segments.map((s, i) => {
          const len = (s.value / total) * c;
          const el = (
            <circle
              key={i}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={thickness}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
              strokeLinecap="butt"
              style={{ transition: "stroke-dasharray 500ms ease, stroke-dashoffset 500ms ease" }}
            />
          );
          offset += len;
          return el;
        })}
      </svg>
      {(centerLabel || centerSub) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {centerLabel && <span className="text-2xl font-semibold tabular-nums">{centerLabel}</span>}
          {centerSub && <span className="text-[10px] uppercase tracking-wide text-muted-2">{centerSub}</span>}
        </div>
      )}
    </div>
  );
}

export function BarList({
  items,
  color = "var(--accent)",
}: {
  items: { label: string; value: number; sub?: string }[];
  color?: string;
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="space-y-1.5">
      {items.map((it) => (
        <div key={it.label} className="text-xs">
          <div className="flex items-center justify-between">
            <span className="truncate font-mono text-[11px]">{it.label}</span>
            <span className="tabular-nums text-muted">{it.sub ?? it.value}</span>
          </div>
          <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${(it.value / max) * 100}%`, background: color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** multi-series time chart (stacked-ish area + lines) */
export function TimeChart({
  points,
  series,
  height = 200,
  yFormat = (n) => String(n),
}: {
  points: { t: string }[];
  series: { key: string; label: string; color: string; type?: "area" | "line" }[];
  height?: number;
  yFormat?: (n: number) => string;
}) {
  const gid = useId();
  const w = 720;
  const padL = 44;
  const padB = 22;
  const padT = 10;
  const innerW = w - padL - 8;
  const innerH = height - padB - padT;
  const rows = points as Record<string, number | string>[];
  const n = Math.max(rows.length, 2);
  const allVals = series.flatMap((s) => rows.map((r) => Number(r[s.key]) || 0));
  const max = Math.max(...allVals, 1);
  const x = (i: number) => padL + (i / (n - 1)) * innerW;
  const y = (v: number) => padT + innerH - (v / max) * innerH;

  const gridY = [0, 0.25, 0.5, 0.75, 1];

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ maxHeight: height }}>
      <defs>
        {series.map((s) => (
          <linearGradient key={s.key} id={`tc-${gid}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={s.color} stopOpacity="0.25" />
            <stop offset="100%" stopColor={s.color} stopOpacity="0" />
          </linearGradient>
        ))}
      </defs>
      {gridY.map((g, i) => (
        <g key={i}>
          <line x1={padL} x2={w - 8} y1={padT + innerH * (1 - g)} y2={padT + innerH * (1 - g)} stroke="var(--line)" strokeWidth="1" />
          <text x={padL - 6} y={padT + innerH * (1 - g) + 3} textAnchor="end" className="fill-[var(--muted-2)] text-[9px]">
            {yFormat(Math.round(max * g))}
          </text>
        </g>
      ))}
      {series.map((s) => {
        const pts = rows.map((r, i) => [x(i), y(Number(r[s.key]) || 0)] as const);
        const line = pts.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)} ${py.toFixed(1)}`).join(" ");
        return (
          <g key={s.key}>
            {(s.type ?? "area") === "area" && (
              <path d={`${line} L${x(n - 1)} ${padT + innerH} L${padL} ${padT + innerH} Z`} fill={`url(#tc-${gid}-${s.key})`} />
            )}
            <path d={line} fill="none" stroke={s.color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        );
      })}
    </svg>
  );
}

/** thin progress bar 0..1 */
export function Meter({ value, tone = "accent" }: { value: number; tone?: "accent" | "ok" | "warn" | "err" }) {
  const col = { accent: "var(--accent)", ok: "var(--ok)", warn: "var(--warn)", err: "var(--err)" }[tone];
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
      <div
        className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, background: col }}
      />
    </div>
  );
}
