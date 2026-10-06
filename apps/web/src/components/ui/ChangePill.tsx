import { formatPct } from "@atlaspad/shared";

export function ChangePill({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return <span className={`font-mono text-[11px] text-faint ${className}`}>—</span>;
  }
  const up = value > 0.0005;
  const down = value < -0.0005;
  const cls = up ? "text-up bg-up/10" : down ? "text-down bg-down/10" : "text-dim bg-white/5";
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[11px] tabular ${cls} ${className}`}>
      {up ? "▲" : down ? "▼" : "•"} {formatPct(value).replace(/^[+-]/, "")}
    </span>
  );
}
