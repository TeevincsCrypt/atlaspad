"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, Layers, List, Newspaper, Search, X } from "lucide-react";
import { formatCompact, formatWif, formatInt, shortAddress, TIERS, type NationSummary } from "@atlaspad/shared";
import { useNews } from "@/lib/api";
import { effects } from "@/lib/effects";
import { useUi, type MapFilterKey } from "@/lib/store";
import { useWorldNations } from "@/lib/world-nations";
import { Flag } from "@/components/emblem/Flag";
import { ChangePill } from "@/components/ui/ChangePill";
import { CopyButton } from "@/components/ui/misc";
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
  const { world, real, all } = useWorldNations();
  const news = useNews({ limit: 20, severity: "notable" });
  const introPlaying = useUi((s) => s.introPlaying);
  const filter = useUi((s) => s.mapFilter);
  const setFilter = useUi((s) => s.setMapFilter);
  const query = useUi((s) => s.mapQuery);
  const setQuery = useUi((s) => s.setMapQuery);
  const [newsOpen, setNewsOpen] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [listOpen, setListOpen] = useState(true);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^\$/, "");
    if (!q) return [];
    return all.filter((n) => n.name.toLowerCase().includes(q) || n.ticker.toLowerCase().includes(q)).slice(0, 6);
  }, [all, query]);

  const totals = useMemo(
    () => ({
      nations: real.length,
      citizens: real.reduce((s, n) => s + n.citizens, 0),
      gdp: real.reduce((s, n) => s + (n.marketCapWif ?? 0), 0),
      volume: real.reduce((s, n) => s + (n.volume24hWif ?? 0), 0),
      wars: world.data?.wars.filter((w) => w.status === "active").length ?? 0,
      alliances: world.data?.alliances.length ?? 0,
    }),
    [real, world.data],
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-10 pt-14">
      <AnimatePresence>
        {!introPlaying && (
          <motion.div className="absolute inset-0" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.8 }}>
            {/* Search, filters and the nations list */}
            <div className="pointer-events-auto absolute left-3 top-[72px] flex max-h-[calc(100dvh-210px)] w-[min(340px,calc(100vw-1.5rem))] flex-col gap-2 sm:left-5 sm:max-h-[calc(100dvh-150px)]">
              <div className="panel shrink-0 p-2.5">
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
                        <Flag emblem={n.emblem} image={n.metadataUri} size={22} />
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
              <NationsPanel real={real} open={listOpen} setOpen={setListOpen} />
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

            {/* World stats (on-chain nations only) */}
            <div className="pointer-events-auto absolute inset-x-3 bottom-20 sm:bottom-5 sm:left-5 sm:right-auto">
              <div className="panel flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5">
                {world.isError ? (
                  <span className="text-xs text-faint">World data unavailable</span>
                ) : (
                  <>
                    {[
                      ["Nations", formatInt(totals.nations)],
                      ["Citizens", formatCompact(totals.citizens)],
                      ["World GDP", formatWif(totals.gdp)],
                      ["24h volume", formatWif(totals.volume)],
                      ["Wars", formatInt(totals.wars)],
                      ["Alliances", formatInt(totals.alliances)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex items-baseline gap-2">
                        <span className="label">{k}</span>
                        <span className="font-mono text-xs text-fg tabular">{v}</span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>

            {world.isSuccess && all.length === 0 && (
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
      <HoverCard nations={all} />
      <SelectionCard nations={all} />
    </div>
  );
}

/** Every nation in one scrollable list, with its contract address. */
function NationsPanel({ real, open, setOpen }: { real: NationSummary[]; open: boolean; setOpen: (o: boolean) => void }) {
  const byScore = (a: NationSummary, b: NationSummary) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || b.civilizationScore - a.civilizationScore;
  const realSorted = useMemo(() => [...real].sort(byScore), [real]);
  return (
    <div className="panel flex max-h-[36dvh] min-h-0 flex-col overflow-hidden sm:max-h-none">
      <button onClick={() => setOpen(!open)} className="flex shrink-0 items-center justify-between border-b border-line px-3.5 py-2.5">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-gold">
          <List className="size-3.5" /> Nations · {real.length}
        </span>
        {open ? <ChevronUp className="size-3.5 text-faint" /> : <ChevronDown className="size-3.5 text-faint" />}
      </button>
      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {realSorted.length === 0 && <div className="px-3.5 py-4 text-xs text-faint">No on-chain nations yet. Found the first one.</div>}
          {realSorted.map((n) => (
            <NationRow key={n.id} n={n} />
          ))}
        </div>
      )}
    </div>
  );
}

function NationRow({ n }: { n: NationSummary }) {
  const body = (
    <>
      <Flag emblem={n.emblem} image={n.metadataUri} size={30} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-xs text-fg">{n.name}</span>
        </span>
        <span className="block truncate font-mono text-[10px] text-faint">
          ${n.ticker} · {formatCompact(n.citizens)} citizens
        </span>
      </span>
      <span className="text-right font-mono text-[10px] text-dim">{formatWif(n.marketCapWif)}</span>
    </>
  );
  return (
    <div className="flex items-center gap-1 border-b border-line/60 pr-1.5 last:border-0">
      <Link href={`/nation/${n.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 px-3.5 py-2 hover:bg-white/5">
        {body}
      </Link>
      <CopyButton value={n.token} label="Copy contract address" />
    </div>
  );
}

function Legend() {
  return (
    <div className="panel hidden shrink-0 p-3 sm:block">
      <div className="label mb-2">Stages · citizens needed</div>
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11px] text-dim">
        {TIERS.map((t) => (
          <span key={t.key} className="flex items-center gap-2">
            <span className="inline-block rounded-full bg-gold/80" style={{ width: 3 + t.tier * 2, height: 3 + t.tier * 2 }} />
            {t.name}
            <span className="font-mono text-[10px] text-faint">{t.minCitizens > 0 ? `${formatInt(t.minCitizens)}+` : "any"}</span>
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
        <Flag emblem={n.emblem} image={n.metadataUri} size={40} />
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-display text-sm uppercase tracking-wide text-fg">{n.name}</span>
          </div>
          <div className="font-mono text-[11px] text-faint">
            ${n.ticker} · #{n.rank ?? "—"} · {TIERS[n.tier]?.name}
          </div>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <div>
          <div className="label">Market cap</div>
          <div className="font-mono text-fg">{formatWif(n.marketCapWif)}</div>
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
      <div className="mt-3 flex items-center justify-between rounded-md border border-line bg-black/20 px-2 py-1 font-mono text-[10px] text-dim">
        <span>CA {shortAddress(n.token, 6)}</span>
        <CopyButton value={n.token} label="Copy contract address" />
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
  const top = Math.min(pos.y + 18, (typeof window !== "undefined" ? window.innerHeight : 800) - 230);
  return (
    <div className="panel pointer-events-none fixed z-30 hidden w-64 p-3.5 sm:block" style={{ left, top }}>
      <NationCardBody n={n} />
      <div className="mt-3 text-center font-mono text-[9px] uppercase tracking-[0.2em] text-faint">Click to open</div>
    </div>
  );
}

/** Tap a nation on mobile: a card with its details. */
function SelectionCard({ nations }: { nations: NationSummary[] }) {
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
