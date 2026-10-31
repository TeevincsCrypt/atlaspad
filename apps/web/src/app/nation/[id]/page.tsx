"use client";
import { use, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, Globe2, Landmark, Plus, TrendingUp } from "lucide-react";
import { BUILDINGS, formatWif, formatInt } from "@atlaspad/shared";
import { useNation, useNews, useSeries, useWorld } from "@/lib/api";
import { effects } from "@/lib/effects";
import { NationHeader } from "@/components/nation/NationHeader";
import { CapitalView } from "@/components/nation/CapitalView";
import { TradePanel } from "@/components/nation/TradePanel";
import {
  CitizensTab,
  DiplomacyTab,
  EconomyTab,
  GovernmentTab,
  HistoryTab,
  InfrastructureTab,
  MilitaryTab,
  TreasuryTab,
} from "@/components/nation/tabs";
import { CreateProposal, type ProposalPreset } from "@/components/governance/CreateProposal";
import { Tabs } from "@/components/ui/Tabs";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";
import { DataUnavailable, Skeleton, Sparkline } from "@/components/ui/misc";
import { NewsFeedItem } from "@/components/news/NewsFeedItem";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "economy", label: "Economy" },
  { key: "citizens", label: "Citizens" },
  { key: "government", label: "Government" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "military", label: "Military" },
  { key: "diplomacy", label: "Diplomacy" },
  { key: "history", label: "History" },
  { key: "treasury", label: "Treasury" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function NationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = use(params);
  const id = Number(raw);
  const router = useRouter();
  const search = useSearchParams();
  const tab = (TABS.find((t) => t.key === search.get("tab"))?.key ?? "overview") as TabKey;
  const setTab = (t: TabKey) => router.replace(`/nation/${id}${t === "overview" ? "" : `?tab=${t}`}`, { scroll: false });
  const detail = useNation(id);
  const world = useWorld();
  const [proposal, setProposal] = useState<ProposalPreset | null>(null);
  const [tradeOpen, setTradeOpen] = useState(false);

  const territoryRank = useMemo(() => {
    const list = [...(world.data?.nations ?? [])].sort((a, b) => b.territoryCells - a.territoryCells);
    const i = list.findIndex((n) => n.id === id);
    return i >= 0 ? i + 1 : null;
  }, [world.data, id]);

  if (detail.isError) {
    return (
      <div className="mx-auto max-w-3xl px-5 pt-28">
        {detail.error && "status" in detail.error && (detail.error as { status: number }).status === 404 ? (
          <div className="panel p-10 text-center">
            <div className="font-display text-lg text-fg">This nation does not exist.</div>
            <p className="mt-2 text-sm text-dim">No nation with id #{id} has been founded on-chain.</p>
            <Link href="/discover" className="mt-4 inline-block text-sm text-gold-bright">
              Discover nations →
            </Link>
          </div>
        ) : (
          <DataUnavailable reason={(detail.error as Error)?.message} />
        )}
      </div>
    );
  }
  if (!detail.data) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4 px-5 pt-24">
        <Skeleton className="h-28" />
        <Skeleton className="h-20" />
        <Skeleton className="h-96" />
      </div>
    );
  }
  const { nation } = detail.data;

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px] opacity-60"
        style={{ background: `radial-gradient(ellipse at 20% 0%, ${nationGlow(nation.emblem)}, transparent 60%)` }}
      />
      <div className="relative mx-auto max-w-[1400px] px-4 pb-24 pt-20 sm:px-6 sm:pt-24">
        <div className="mb-5 flex items-center justify-between">
          <button onClick={() => router.back()} className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.16em] text-faint hover:text-dim">
            <ArrowLeft className="size-3.5" /> Back
          </button>
          <div className="flex gap-2">
            <Link
              href="/world"
              onClick={() => setTimeout(() => effects.emit({ kind: "focus", nationId: nation.id }), 1200)}
              className="flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.14em] text-dim hover:text-fg"
            >
              <Globe2 className="size-3.5" /> On the map
            </Link>
          </div>
        </div>
        <NationHeader nation={nation} wifUsd={detail.data.wifUsd} territoryRank={territoryRank} socials={detail.data.socials} />

        <div className="sticky top-14 z-20 -mx-4 mt-8 border-b border-line bg-ink/85 px-4 py-2 backdrop-blur-xl sm:-mx-6 sm:px-6">
          <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} value={tab} onChange={setTab} />
        </div>

        <div className="mt-6 grid gap-6 xl:grid-cols-[1fr_380px]">
          <AnimatePresence mode="wait">
            <motion.div key={tab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.25 }} className="min-w-0">
              {tab === "overview" && <Overview id={id} onTab={setTab} onPropose={(p) => setProposal(p ?? { type: "build" })} />}
              {tab === "economy" && <EconomyTab nation={nation} />}
              {tab === "citizens" && <CitizensTab nation={nation} />}
              {tab === "government" && <GovernmentTab nation={nation} detail={detail.data} onPropose={(p) => setProposal(p ?? { type: "build" })} />}
              {tab === "infrastructure" && <InfrastructureTab nation={nation} detail={detail.data} onPropose={(p) => setProposal(p ?? { type: "build" })} />}
              {tab === "military" && <MilitaryTab nation={nation} detail={detail.data} onPropose={(p) => setProposal(p ?? { type: "war" })} />}
              {tab === "diplomacy" && <DiplomacyTab nation={nation} detail={detail.data} onPropose={(p) => setProposal(p ?? { type: "alliance-create" })} />}
              {tab === "history" && <HistoryTab nation={nation} detail={detail.data} />}
              {tab === "treasury" && <TreasuryTab nation={nation} onPropose={(p) => setProposal(p ?? { type: "treasury" })} />}
            </motion.div>
          </AnimatePresence>
          <aside className="hidden xl:block">
            <div className="sticky top-32 space-y-4">
              <TradePanel nation={nation} />
            </div>
          </aside>
        </div>
      </div>

      {/* Mobile trade */}
      <div className="fixed inset-x-3 bottom-[76px] z-30 xl:hidden">
        <Button variant="primary" size="lg" className="w-full" onClick={() => setTradeOpen(true)}>
          Trade ${nation.ticker}
        </Button>
      </div>
      <AnimatePresence>
        {tradeOpen && (
          <motion.div className="fixed inset-0 z-[60] xl:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/70" onClick={() => setTradeOpen(false)} />
            <motion.div className="absolute inset-x-0 bottom-0 max-h-[90dvh] overflow-y-auto p-3" initial={{ y: 400 }} animate={{ y: 0 }} exit={{ y: 400 }}>
              <TradePanel nation={nation} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {proposal && (
        <CreateProposal key={JSON.stringify(proposal)} open onClose={() => setProposal(null)} nation={nation} detail={detail.data} preset={proposal} />
      )}
    </div>
  );
}

function nationGlow(emblem: string): string {
  const v = BigInt(emblem);
  const hex = ((v >> 16n) & 0xffffffn).toString(16).padStart(6, "0");
  return `#${hex}33`;
}

function Overview({ id, onTab, onPropose }: { id: number; onTab: (t: TabKey) => void; onPropose: (p?: ProposalPreset) => void }) {
  const detail = useNation(id);
  const news = useNews({ nationId: id, limit: 8 });
  const series = useSeries(id, 7);
  const d = detail.data!;
  const n = d.nation;
  const built = d.buildings.filter((b) => b.status === "complete");
  return (
    <div className="space-y-4">
      <CapitalView nation={n} />
      {n.description && <p className="text-sm leading-relaxed text-dim">{n.description}</p>}
      <div className="grid gap-4 md:grid-cols-3">
        {[
          { label: "Market cap · 7d", values: (series.data ?? []).map((p) => p.marketCapWif ?? 0), value: formatWif(n.marketCapWif), tab: "economy" as TabKey },
          { label: "Citizens · 7d", values: (series.data ?? []).map((p) => p.citizens), value: formatInt(n.citizens), tab: "citizens" as TabKey },
          { label: "Treasury · 7d", values: (series.data ?? []).map((p) => p.treasuryWif), value: formatWif(n.treasuryWif), tab: "treasury" as TabKey },
        ].map((c) => (
          <button key={c.label} onClick={() => onTab(c.tab)} className="panel-flat p-4 text-left transition hover:border-line-strong">
            <div className="label">{c.label}</div>
            <div className="mt-1 font-display text-lg text-fg">{c.value}</div>
            <Sparkline values={c.values} width={260} height={40} className="mt-2 w-full" />
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Latest from the nation" label="History" actions={<button onClick={() => onTab("history")} className="text-[11px] text-faint hover:text-dim">All →</button>}>
          {news.isError ? (
            <DataUnavailable compact />
          ) : (
            <div className="divide-y divide-line">
              {(news.data ?? []).map((item) => (
                <NewsFeedItem key={item.id} item={item} compact />
              ))}
            </div>
          )}
        </Panel>
        <div className="space-y-4">
          <Panel title="Infrastructure" label={`${built.length} / ${BUILDINGS.length} built`} actions={<button onClick={() => onTab("infrastructure")} className="text-[11px] text-faint hover:text-dim">Manage →</button>}>
            <div className="grid grid-cols-8 gap-1.5">
              {BUILDINGS.map((b) => {
                const has = built.some((x) => x.type === b.type);
                return (
                  <div key={b.type} title={b.name} className={`grid aspect-square place-items-center rounded-lg border text-lg ${has ? "border-gold/40 bg-gold/10" : "border-line opacity-30 grayscale"}`}>
                    {b.icon}
                  </div>
                );
              })}
            </div>
          </Panel>
          <Panel title="Citizens decide" label="Governance">
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="secondary" onClick={() => onPropose({ type: "build" })}>
                <Plus className="size-3.5" /> Build
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onPropose({ type: "war" })}>
                <TrendingUp className="size-3.5" /> Declare war
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onPropose({ type: "alliance-create" })}>
                <Plus className="size-3.5" /> Alliance
              </Button>
              <Button size="sm" variant="secondary" onClick={() => onPropose({ type: "treasury" })}>
                <Landmark className="size-3.5" /> Treasury
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-faint">Every decision is an on-chain proposal voted on by ${n.ticker} holders.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
