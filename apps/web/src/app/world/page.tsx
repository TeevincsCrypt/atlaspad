"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Layers, Newspaper, Search, X } from "lucide-react";
import { formatCompact, formatEth, formatInt, TIERS, type NationSummary } from "@atlaspad/shared";
import { useNews, useWorld } from "@/lib/api";
import { effects } from "@/lib/effects";
import { useUi, type MapFilterKey } from "@/lib/store";
import { Flag } from "@/components/emblem/Flag";
import { ChangePill } from "@/components/ui/ChangePill";
import { NewsFeedItem } from "@/components/news/NewsFeedItem";

const FILTERS: { key: MapFilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "marketCap", label: "Market cap" },
  { key: "population", label: "Population" },
  { key: "activity", label: "Activity" },
  { key: "age", label: "Age" },
  { key: "growth", label: "Growth" },
  { key: "wars", label: "Wars" },
  { key: "events", label: "Events" },
];

export default function WorldPage() {
  const world = useWorld();
  const news = useNews({ limit: 20, severity: "notable" });
  const introPlaying = useUi((s) => s.introPlaying);
  const filter = useUi((s) => s.mapFilter);
  const setFilter = useUi((s) => s.setMapFilter);
  const query = useUi((s) => s.mapQuery);
  const setQuery = useUi((s) => s.setMapQuery);
  const [newsOpen, setNewsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const nations = useMemo(() => world.data?.nations ?? [], [world.data]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\$/, "");
    if (!q) return [];
    return nations.filter((n) => n.name.toLowerCase().includes(q) || n.ticker.toLowerCase().includes(q)).slice(0, 6);
  }, [nations, query]);

  const totals = useMemo(
    () => ({
      nations: nations.length,
      citizens: nations.reduce((s, n) => s + n.citizens, 0),
      gdp: nations.reduce((s, n) => s + (n.marketCapEth ?? 0), 0),
      volume: nations.reduce((s, n) => s + (n.volume24hEth ?? 0), 0),
      wars: world.data?.wars.filter((w) => w.status === "active").length ?? 0,
      alliances: world.data?.alliances.length ?? 0,
    }),
    [nations, world.data],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-10 pt-14">
      <AnimatePresence>
        {!introPlaying && (
          <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
            {/* Search + filters */}
            <div className="pointer-events-auto absolute left-3 top-[72px] w-[min(340px,calc(100vw-1.5rem))] sm:left-5">
              <div className="panel p-2.5">
                <div className="flex items-center gap-2 rounded-lg border border-line bg-black/30 px-2.5">
                  <Search className="size-3.5 text-faint" />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Find a nation or $TICKER"
                    className="h-9 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-faint"
                  />
                  {query && (
                    <button onClick={() => setQuery("")} className="text-faint hover:text-fg" aria-label="Clear">
                      <X className="size-3.5" />
                    </button>
                  )}
                  <button onClick={() => setFiltersOpen(!filtersOpen)} className={`sm:hidden ${filtersOpen ? "text-gold" : "text-faint"}`} aria-label="Filters">
                    <Layers className="size-4" />
                  </button>
                </div>
                {matches.length > 0 && (
                  <div className="mt-2 space-y-0.5">
                    {matches.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => effects.emit({ kind: "focus", nationId: n.id })}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:bg-white/5"
                      >
                        <Flag emblem={n.emblem} size={22} />
                        <span className="flex-1 truncate text-xs text-fg">{n.name}</span>
                        <span className="font-mono text-[10px] text-faint">${n.ticker}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className={`mt-2.5 flex-wrap gap-1 ${filtersOpen ? "flex" : "hidden sm:flex"}`}>
                  {FILTERS.map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setFilter(f.key)}
                      className={`rounded-md border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] transition ${
                        filter === f.key ? "border-gold/50 bg-gold/10 text-gold-bright" : "border-line text-faint hover:text-dim"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              <Legend />
            </div>

            {/* Live news */}
            <div className="pointer-events-auto absolute right-3 top-[72px] hidden w-[340px] sm:right-5 md:block">
              <div className="panel overflow-hidden">
                <button onClick={() => setNewsOpen(!newsOpen)} className="flex w-full items-center justify-between border-b border-line px-4 py-2.5">
                  <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
                    <Newspaper className="size-3.5" /> Atlas News
                  </span>
                  <span className="text-[10px] text-faint">{newsOpen ? "Hide" : "Show"}</span>
                </button>
                {newsOpen && (
                  <div className="max-h-[52vh] divide-y divide-line overflow-y-auto px-4">
                    {news.isError && <div className="py-6 text-center text-xs text-faint">Data unavailable</div>}
                    {news.data?.length === 0 && <div className="py-6 text-center text-xs text-faint">No world events yet.</div>}
                    {news.data?.map((n) => <NewsFeedItem key={n.id} item={n} compact />)}
                  </div>
                )}
              </div>
            </div>

            {/* World stats */}
            <div className="pointer-events-auto absolute inset-x-3 bottom-20 sm:bottom-5 sm:left-5 sm:right-auto">
              <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
                {world.isError ? (
                  <span className="text-xs text-faint">World data unavailable</span>
                ) : (
                  [
                    ["Nations", formatInt(totals.nations)],
                    ["Citizens", formatCompact(totals.citizens)],
                    ["World GDP", formatEth(totals.gdp)],
                    ["24h volume", formatEth(totals.volume)],
                    ["Wars", formatInt(totals.wars)],
                    ["Alliances", formatInt(totals.alliances)],
                  ].map(([k, v]) => (
                    <div key={k} className="flex items-baseline gap-2">
                      <span className="label">{k}</span>
                      <span className="font-mono text-xs text-fg tabular">{v}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {world.isSuccess && nations.length === 0 && (
              <div className="absolute inset-x-0 top-1/2 flex -translate-y-1/2 justify-center px-4">
                <div className="panel pointer-events-auto max-w-md p-6 text-center">
                  <div className="font-display text-base text-fg">The Atlas awaits its first nation.</div>
                  <p className="mt-2 text-sm text-dim">Continents are uncharted. Found a nation and its territory will rise here.</p>
                  <Link href="/found" className="mt-4 inline-block rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold-bright hover:bg-gold/10">
                    Found a Nation
                  </Link>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      <HoverCard nations={nations} />
      <MobileSelection nations={nations} />
    </div>
  );
}

function Legend() {
  return (
    <div className="panel mt-2 hidden p-3 sm:block">
      <div className="label mb-2">Legend</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-dim">
        {TIERS.map((t) => (
          <span key={t.key} className="flex items-center gap-2">
            <span className="inline-block rounded-full bg-gold/80" style={{ width: 3 + t.tier * 2, height: 3 + t.tier * 2 }} />
            {t.name}
          </span>
        ))}
        <span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-[#e8c47a]" />Alliance</span>
        <span className="flex items-center gap-2"><span className="h-0.5 w-4 bg-war" />War</span>
        <span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-gold-bright" />Golden age</span>
        <span className="flex items-center gap-2"><span className="size-2 rounded-sm bg-down" />Crisis</span>
      </div>
    </div>
  );
}

function NationCardBody({ n }: { n: NationSummary }) {
  return (
    <>
      <div className="flex items-center gap-3">
        <Flag emblem={n.emblem} size={40} />
        <div className="min-w-0">
          <div className="truncate font-display text-sm uppercase tracking-wide text-fg">{n.name}</div>
          <div className="font-mono text-[11px] text-faint">
            ${n.ticker} · #{n.rank ?? "—"} · {TIERS[n.tier]?.name}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <div>
          <div className="label">Market cap</div>
          <div className="font-mono text-fg">{formatEth(n.marketCapEth)}</div>
        </div>
        <div>
          <div className="label">24h</div>
          <ChangePill value={n.change24h} />
        </div>
        <div>
          <div className="label">Population</div>
          <div className="font-mono text-fg">{formatInt(n.citizens)}</div>
        </div>
        <div>
          <div className="label">Economic power</div>
          <div className="font-mono text-fg">{n.economicPower.toFixed(0)}</div>
        </div>
      </div>
    </>
  );
}

function HoverCard({ nations }: { nations: NationSummary[] }) {
  const hovered = useUi((s) => s.hoveredNation);
  const pos = useUi((s) => s.hoverPos);
  const n = hovered ? nations.find((x) => x.id === hovered) : null;
  if (!n) return null;
  const left = Math.min(pos.x + 18, (typeof window !== "undefined" ? window.innerWidth : 1200) - 280);
  const top = Math.min(pos.y + 18, (typeof window !== "undefined" ? window.innerHeight : 800) - 190);
  return (
    <div className="panel pointer-events-none fixed z-30 hidden w-64 p-3.5 sm:block" style={{ left, top }}>
      <NationCardBody n={n} />
      <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-faint">Click to open</div>
    </div>
  );
}

function MobileSelection({ nations }: { nations: NationSummary[] }) {
  const selected = useUi((s) => s.selectedNation);
  const setSelected = useUi((s) => s.setSelectedNation);
  const n = selected ? nations.find((x) => x.id === selected) : null;
  return (
    <AnimatePresence>
      {n && (
        <motion.div
          initial={{ y: 200 }}
          animate={{ y: 0 }}
          exit={{ y: 220 }}
          className="panel pointer-events-auto fixed inset-x-3 bottom-[76px] z-30 p-4 sm:hidden"
        >
          <button onClick={() => setSelected(null)} className="absolute right-3 top-3 text-faint" aria-label="Close">
            <X className="size-4" />
          </button>
          <NationCardBody n={n} />
          <Link href={`/nation/${n.id}`} className="mt-4 block rounded-lg bg-gold/15 py-2.5 text-center font-mono text-xs uppercase tracking-[0.16em] text-gold-bright">
            Open nation
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
