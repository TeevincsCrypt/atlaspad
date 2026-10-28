import type { NationSummary, WarSummary } from "@atlaspad/shared";
import type { MapFilterKey } from "@/lib/store";

/**
 * Per-nation highlight factor for the active map filter (1 = normal, <1 dimmed, >1 emphasized).
 * Filters never hide nations; they shift attention.
 */
export function computeHighlight(nations: NationSummary[], wars: WarSummary[], filter: MapFilterKey, query: string): Map<number, number> {
  const out = new Map<number, number>();
  const q = query.trim().toLowerCase().replace(/^\$/, "");
  const rankBy = (value: (n: NationSummary) => number | null) => {
    const vals = nations.map((n) => ({ id: n.id, v: value(n) })).filter((x) => x.v !== null && Number.isFinite(x.v)) as { id: number; v: number }[];
    vals.sort((a, b) => b.v - a.v);
    vals.forEach((x, i) => out.set(x.id, 1.25 - (i / Math.max(1, vals.length - 1)) * 0.95));
    for (const n of nations) if (!out.has(n.id)) out.set(n.id, 0.3);
  };
  const now = Date.now() / 1000;
  switch (filter) {
    case "marketCap":
      rankBy((n) => n.marketCapWif);
      break;
    case "population":
      rankBy((n) => n.citizens);
      break;
    case "activity":
      rankBy((n) => n.volume24hWif);
      break;
    case "age":
      rankBy((n) => now - n.createdAt);
      break;
    case "growth":
      rankBy((n) => n.change24h);
      break;
    case "wars": {
      const atWar = new Set(wars.filter((w) => w.status === "active").flatMap((w) => [w.attackerId, w.defenderId]));
      for (const n of nations) out.set(n.id, atWar.has(n.id) ? 1.3 : 0.25);
      break;
    }
    case "events":
      for (const n of nations) out.set(n.id, n.statuses.some((s) => s.until > now) ? 1.3 : 0.25);
      break;
    default:
      for (const n of nations) out.set(n.id, 1);
  }
  if (q) {
    for (const n of nations) {
      const match = n.name.toLowerCase().includes(q) || n.ticker.toLowerCase().includes(q);
      out.set(n.id, match ? 1.35 : 0.2);
    }
  }
  return out;
}
