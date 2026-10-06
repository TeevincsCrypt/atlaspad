import { formatUnits } from "viem";

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"];

function subscript(n: number): string {
  return String(n)
    .split("")
    .map((d) => SUBSCRIPT[Number(d)])
    .join("");
}

/** Number with compact suffix: 1.2K, 84.2M. */
export function formatCompact(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  if (abs < 1000) return n.toLocaleString("en-US", { maximumFractionDigits: abs < 10 ? 2 : digits });
  const units = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "K"],
  ] as const;
  for (const [v, s] of units) {
    if (abs >= v) return `${(n / v).toFixed(digits).replace(/\.0+$/, "")}${s}`;
  }
  return String(n);
}

export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return Math.round(n).toLocaleString("en-US");
}

/**
 * Small-number aware formatting for token prices: 0.0000001234 → "0.0₆1234".
 */
export function formatSmall(n: number, sig = 4): string {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1) return n.toLocaleString("en-US", { maximumFractionDigits: 4 });
  const zeros = Math.floor(-Math.log10(abs));
  if (zeros < 4) return n.toPrecision(sig).replace(/0+$/, "").replace(/\.$/, "");
  const digits = Math.round(abs * Math.pow(10, zeros + sig - 1)).toString().replace(/0+$/, "");
  return `${n < 0 ? "-" : ""}0.0${subscript(zeros - 1)}${digits}`;
}

export function formatEth(value: number | null | undefined, opts: { compact?: boolean; symbol?: boolean } = {}): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const sym = opts.symbol === false ? "" : " ETH";
  if (Math.abs(value) >= 1000 && opts.compact !== false) return `${formatCompact(value)}${sym}`;
  if (Math.abs(value) >= 1) return `${value.toLocaleString("en-US", { maximumFractionDigits: 3 })}${sym}`;
  return `${formatSmall(value)}${sym}`;
}

export function weiToEth(wei: bigint | string | null | undefined): number {
  if (wei === null || wei === undefined) return 0;
  return Number(formatUnits(BigInt(wei), 18));
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  if (Math.abs(value) >= 1000) return `$${formatCompact(value)}`;
  if (Math.abs(value) >= 1) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  return `$${formatSmall(value)}`;
}

export function formatPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  const v = fraction * 100;
  const sign = v > 0 ? "+" : "";
  return `${sign}${v.toFixed(Math.abs(v) >= 1000 ? 0 : digits)}%`;
}

export function shortAddress(address: string | null | undefined, chars = 4): string {
  if (!address) return "—";
  return `${address.slice(0, 2 + chars)}…${address.slice(-chars)}`;
}

export function timeAgo(unixSeconds: number, now = Date.now() / 1000): string {
  const d = Math.max(0, now - unixSeconds);
  if (d < 45) return "just now";
  if (d < 3600) return `${Math.round(d / 60)}m ago`;
  if (d < 86400) return `${Math.round(d / 3600)}h ago`;
  if (d < 86400 * 30) return `${Math.round(d / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s % 60}s`;
}

export function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
