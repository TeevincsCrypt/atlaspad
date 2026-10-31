"use client";
import { Star } from "lucide-react";
import { useUi } from "@/lib/store";
import { useHydrated } from "@/lib/hooks";

/** Star / unstar a nation. The watchlist lives in this browser only (no wallet or account needed). */
export function WatchButton({ id, className = "", withLabel = false }: { id: number; className?: string; withLabel?: boolean }) {
  const hydrated = useHydrated();
  const on = useUi((s) => s.watchlist.includes(id)) && hydrated;
  const toggle = useUi((s) => s.toggleWatch);
  const label = on ? "Remove from watchlist" : "Add to watchlist";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggle(id);
      }}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={`inline-flex items-center gap-1.5 rounded-md transition ${on ? "text-gold-bright" : "text-faint hover:text-fg"} ${className}`}
    >
      <Star className={`size-4 ${on ? "fill-current" : ""}`} />
      {withLabel && <span className="font-mono text-[11px] uppercase tracking-[0.14em]">{on ? "Watching" : "Watch"}</span>}
    </button>
  );
}
