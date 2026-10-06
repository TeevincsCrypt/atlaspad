import { ChangePill } from "./ChangePill";

export function Stat({
  label,
  value,
  sub,
  change,
  hint,
  className = "",
  size = "md",
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  change?: number | null;
  hint?: string;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const valueSize = size === "lg" ? "text-3xl sm:text-4xl" : size === "sm" ? "text-base" : "text-xl sm:text-2xl";
  return (
    <div className={`min-w-0 ${className}`} title={hint}>
      <div className="label mb-1.5 truncate">{label}</div>
      <div className={`flex items-baseline gap-2 font-display font-medium tracking-tight text-fg ${valueSize}`}>
        <span className="truncate">{value}</span>
        {change !== undefined && <ChangePill value={change} />}
      </div>
      {sub && <div className="mt-1 truncate text-xs text-dim">{sub}</div>}
    </div>
  );
}
