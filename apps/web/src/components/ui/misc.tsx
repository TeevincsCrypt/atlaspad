"use client";
import { useState } from "react";
import { Check, Copy, ExternalLink, WifiOff } from "lucide-react";
import { shortAddress } from "@atlaspad/shared";
import { explorerAddress, explorerToken, explorerTx } from "@atlaspad/shared";
import { network } from "@/lib/env";

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Shown wherever real data is missing. Never replaced by placeholder numbers. */
export function DataUnavailable({ reason, compact = false }: { reason?: string; compact?: boolean }) {
  if (compact) return <span className="font-mono text-xs text-faint" title={reason}>Data unavailable</span>;
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-6 py-10 text-center">
      <WifiOff className="size-5 text-faint" />
      <div className="text-sm text-dim">Data unavailable</div>
      {reason && <div className="max-w-sm text-xs text-faint">{reason}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: React.ReactNode; title: string; body?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center">
      {icon && <div className="text-2xl">{icon}</div>}
      <div className="font-display text-sm text-fg">{title}</div>
      {body && <div className="max-w-md text-xs leading-relaxed text-dim">{body}</div>}
      {action}
    </div>
  );
}

/** Copies text. Falls back to a hidden text field where the Clipboard API is blocked (common in wallet browsers). */
async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    try {
      const el = document.createElement("textarea");
      el.value = value;
      el.setAttribute("readonly", "");
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
      el.select();
      el.setSelectionRange(0, value.length);
      const ok = document.execCommand("copy");
      el.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

export function CopyButton({ value, className = "", label = "Copy" }: { value: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={`rounded p-1 text-faint transition hover:bg-white/5 hover:text-fg ${className}`}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void copyText(value).then((ok) => {
          if (!ok) return;
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
      aria-label={label}
      title={label}
    >
      {done ? <Check className="size-3.5 text-up" /> : <Copy className="size-3.5" />}
    </button>
  );
}

export function ExplorerLink({
  kind,
  value,
  children,
  className = "",
}: {
  kind: "tx" | "address" | "token";
  value: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const href = kind === "tx" ? explorerTx(network, value) : kind === "token" ? explorerToken(network, value) : explorerAddress(network, value);
  if (!href) return <span className={className}>{children ?? shortAddress(value)}</span>;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className={`inline-flex items-center gap-1 text-dim hover:text-gold-bright ${className}`}>
      {children ?? shortAddress(value)}
      <ExternalLink className="size-3" />
    </a>
  );
}

export function Progress({ value, className = "", tone = "gold" }: { value: number; className?: string; tone?: "gold" | "up" | "down" | "info" }) {
  const color = tone === "gold" ? "from-gold-deep via-gold to-gold-bright" : tone === "up" ? "from-up/60 to-up" : tone === "down" ? "from-down/60 to-down" : "from-info/60 to-info";
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06] ${className}`}>
      <div className={`h-full rounded-full bg-gradient-to-r ${color} transition-[width] duration-700`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Sparkline({
  values,
  width = 120,
  height = 32,
  className = "",
  color,
}: {
  values: number[];
  width?: number;
  height?: number;
  className?: string;
  color?: string;
}) {
  if (values.length < 2) return <svg width={width} height={height} className={className} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * width, height - 2 - ((v - min) / span) * (height - 4)] as const);
  const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  const stroke = color ?? (up ? "var(--color-up)" : "var(--color-down)");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={stroke} opacity={0.08} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.4} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
