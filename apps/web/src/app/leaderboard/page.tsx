"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { LayoutGroup, motion } from "motion/react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { formatCompact, formatEth, formatInt, formatPct, shortAddress, TIERS, type NationSummary } from "@atlaspad/shared";
import { useTopCitizens, useWorld } from "@/lib/api";
import { Flag } from "@/components/emblem/Flag";
import { DataUnavailable, EmptyState, Skeleton } from "@/components/ui/misc";

type Cat = { key: string; label: string; icon: string; value: (n: NationSummary) => number | null; fmt: (v: number) => string; hint: string };

const CATEGORIES: Cat[] = [
  { key: "overall", label: "Overall Civilization", icon: "🏆", value: (n) => n.civilizationScore, fmt: (v) => v.toFixed(1), hint: "Civilization score: economy, population, military, influence and development" },
  { key: "economy", label: "Largest Economy", icon: "🌎", value: (n) => n.marketCapEth, fmt: (v) => formatEth(v), hint: "Market cap (GDP)" },
  { key: "citizens", label: "Most Citizens", icon: "👥", value: (n) => n.citizens, fmt: (v) => formatInt(v), hint: "Wallets holding ≥0.0001% of supply" },
  { key: "strongest", label: "Strongest Nation", icon: "⚔️", value: (n) => n.militaryPower, fmt: (v) => v.toFixed(0), hint: "Military power" },
  {
    key: "growing",
    label: "Fastest Growing",
    icon: "📈",
    // Same measure and 5-citizen floor as Discover's "Fastest Growing".
    value: (n) => (n.citizens >= 5 && n.citizens24hAgo && n.citizens24hAgo > 0 ? n.citizens / n.citizens24hAgo - 1 : null),
    fmt: (v) => formatPct(v),
    hint: "Citizen growth over 24 hours (nations with 5+ citizens)",
  },
  { key: "active", label: "Most Active", icon: "🔥", value: (n) => n.volume24hEth, fmt: (v) => formatEth(v), hint: "24h trading volume" },
  { key: "developed", label: "Most Developed", icon: "🏗️", value: (n) => n.developmentScore + n.civilizationScore / 1000, fmt: (v) => `${Math.round(v / 12.5)} / 8`, hint: "Completed buildings" },
  { key: "influential", label: "Most Influential", icon: "👑", value: (n) => n.resources.influence, fmt: (v) => formatCompact(v), hint: "Influence (game resource)" },
];

export default function LeaderboardPage() {
  const world = useWorld();
  const [cat, setCat] = useState(CATEGORIES[0]!);
  const [view, setView] = useState<"nations" | "citizens">("nations");
  const rows = useMemo(() => {
    const list = (world.data?.nations ?? []).map((n) => ({ n, v: cat.value(n) })).filter((x) => x.v !== null && Number.isFinite(x.v)) as { n: NationSummary; v: number }[];
    return list.sort((a, b) => b.v - a.v || a.n.id - b.n.id).slice(0, 100);
  }, [world.data, cat]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6">
      <div className="mb-8">
        <div className="label mb-2">World leaderboard</div>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-fg sm:text-4xl">The powers of the Atlas</h1>
      </div>
      <div className="mb-6 flex gap-2">
        {(["nations", "citizens"] as const).map((v) => (
          <button key={v} onClick={() => setView(v)} className={`rounded-lg border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] ${view === v ? "border-gold/50 bg-gold/10 text-gold-bright" : "border-line text-faint"}`}>
            {v}
          </button>
        ))}
      </div>
      {view === "citizens" ? (
        <CitizenBoard />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
          <div className="flex gap-1.5 overflow-x-auto lg:flex-col">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                onClick={() => setCat(c)}
                className={`flex shrink-0 items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${cat.key === c.key ? "border-gold/50 bg-gold/[0.07]" : "border-line hover:border-line-strong"}`}
              >
                <span className="text-lg">{c.icon}</span>
                <span className="text-sm text-fg">{c.label}</span>
              </button>
            ))}
          </div>
          <div className="panel overflow-hidden">
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <div className="font-display text-sm text-fg">
                {cat.icon} {cat.label}
              </div>
              <div className="text-[11px] text-faint">{cat.hint}</div>
            </div>
            {world.isError ? (
              <div className="p-6">
                <DataUnavailable />
              </div>
            ) : !world.data ? (
              <div className="space-y-2 p-5">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : rows.length === 0 ? (
              <div className="p-6">
                <EmptyState title="No nations yet" body="The leaderboard fills as nations are founded." />
              </div>
            ) : (
              <LayoutGroup>
                <ol className="divide-y divide-line">
                  {rows.map(({ n, v }, i) => {
                    const moved = cat.key === "overall" && n.previousRank !== null && n.rank !== null ? n.previousRank - n.rank : 0;
                    return (
                      <motion.li key={n.id} layout transition={{ type: "spring", stiffness: 380, damping: 34 }}>
                        <Link href={`/nation/${n.id}`} className="flex items-center gap-4 px-5 py-3 transition hover:bg-white/[0.02]">
                          <span className={`w-8 font-display text-lg ${i < 3 ? "text-gold-bright" : "text-faint"}`}>{i + 1}</span>
                          <span className="w-5">
                            {moved > 0 && <ArrowUp className="size-3.5 text-up" />}
                            {moved < 0 && <ArrowDown className="size-3.5 text-down" />}
                          </span>
                          <Flag emblem={n.emblem} size={40} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-display text-sm uppercase tracking-wide text-fg">{n.name}</span>
                            <span className="font-mono text-[11px] text-faint">
                              ${n.ticker} · {TIERS[n.tier]?.name} · {formatInt(n.citizens)} citizens
                            </span>
                          </span>
                          <motion.span key={v} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className={`font-mono text-sm ${cat.key === "growing" ? (v >= 0 ? "text-up" : "text-down") : "text-fg"}`}>
                            {cat.fmt(v)}
                          </motion.span>
                        </Link>
                      </motion.li>
                    );
                  })}
                </ol>
              </LayoutGroup>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function CitizenBoard() {
  const top = useTopCitizens();
  return (
    <div className="panel overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <div className="font-display text-sm text-fg">🎖️ Most accomplished citizens</div>
        <div className="text-[11px] text-faint">XP from founding, governance, citizenship and achievements — never from spending</div>
      </div>
      {top.isError ? (
        <div className="p-6">
          <DataUnavailable />
        </div>
      ) : !top.data ? (
        <div className="space-y-2 p-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <ol className="divide-y divide-line">
          {top.data.map((c) => (
            <li key={c.address}>
              <Link href={`/citizen/${c.address}`} className="flex items-center gap-4 px-5 py-3 hover:bg-white/[0.02]">
                <span className={`w-8 font-display text-lg ${c.rank <= 3 ? "text-gold-bright" : "text-faint"}`}>{c.rank}</span>
                <span className="flex-1 font-mono text-sm text-fg">{shortAddress(c.address, 6)}</span>
                <span className="font-mono text-[11px] text-dim">{c.title}</span>
                <span className="w-24 text-right font-mono text-sm text-gold-bright">{formatInt(c.xp)} XP</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
