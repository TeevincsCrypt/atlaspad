"use client";
import { useMemo } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Swords } from "lucide-react";
import { decodeEmblem, formatDuration, formatEth, formatInt, formatPct, timeAgo, TIERS, type NationSummary, type WarSummary } from "@atlaspad/shared";
import { useNews, useWorld } from "@/lib/api";
import { Flag } from "@/components/emblem/Flag";
import { ChangePill } from "@/components/ui/ChangePill";
import { DataUnavailable, EmptyState, Skeleton } from "@/components/ui/misc";

/** Animated territory preview: hexes in the national color, lights scaled by tier and activity. */
function TerritoryPreview({ n }: { n: NationSummary }) {
  const color = decodeEmblem(n.emblem).primary;
  const rings = 1 + Math.min(3, n.tier);
  const hexes: { x: number; y: number; d: number }[] = [];
  for (let q = -rings; q <= rings; q++) {
    for (let s = -rings; s <= rings; s++) {
      if (Math.abs(q + s) > rings) continue;
      hexes.push({ x: 60 + 9 * Math.sqrt(3) * (q + s / 2), y: 40 + 9 * 1.5 * s, d: Math.hypot(q, s) });
    }
  }
  const lights = Math.min(hexes.length, 2 + n.tier * 3 + Math.round(Math.log2(1 + n.trades24h)));
  return (
    <svg viewBox="0 0 120 80" className="h-20 w-full">
      {hexes.map((h, i) => (
        <motion.path
          key={i}
          d={Array.from({ length: 6 }, (_, k) => {
            const a = (Math.PI / 3) * k + Math.PI / 6;
            return `${k ? "L" : "M"}${(h.x + 8.4 * Math.cos(a)).toFixed(1)},${(h.y + 8.4 * Math.sin(a)).toFixed(1)}`;
          }).join(" ") + "Z"}
          fill={color}
          fillOpacity={0.15 + 0.25 * (1 - h.d / (rings + 1))}
          stroke={color}
          strokeOpacity={0.4}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: h.d * 0.08 }}
        />
      ))}
      {hexes.slice(0, lights).map((h, i) => (
        <circle key={`l${i}`} cx={h.x} cy={h.y} r={1.4} fill="#ffe2a8" className="animate-twinkle" style={{ animationDelay: `${(i * 0.37) % 3}s` }} />
      ))}
    </svg>
  );
}

function NationCard({ n, meta }: { n: NationSummary; meta?: React.ReactNode }) {
  return (
    <motion.div whileHover={{ y: -3 }} transition={{ type: "spring", stiffness: 400, damping: 30 }}>
      <Link href={`/nation/${n.id}`} className="panel group block overflow-hidden transition hover:border-line-strong">
        <div className="relative border-b border-line" style={{ background: `radial-gradient(circle at 50% 60%, ${decodeEmblem(n.emblem).primary}22, transparent 70%)` }}>
          <TerritoryPreview n={n} />
          <div className="absolute left-3 top-3 transition group-hover:scale-110">
            <Flag emblem={n.emblem} size={30} />
          </div>
          <span className="absolute right-3 top-3 font-mono text-[10px] text-faint">#{n.rank ?? "—"}</span>
        </div>
        <div className="p-3.5">
          <div className="truncate font-display text-sm uppercase tracking-wide text-fg">{n.name}</div>
          <div className="mt-0.5 flex items-center justify-between font-mono text-[11px] text-faint">
            <span>${n.ticker} · {TIERS[n.tier]?.name}</span>
            <ChangePill value={n.change24h} />
          </div>
          <div className="mt-2.5 flex justify-between text-xs">
            <span className="text-dim">{formatEth(n.marketCapEth)}</span>
            <span className="text-dim">{formatInt(n.citizens)} citizens</span>
          </div>
          {meta && <div className="mt-2 border-t border-line pt-2 text-[11px] text-dim">{meta}</div>}
        </div>
      </Link>
    </motion.div>
  );
}

function WarCard({ w, byId }: { w: WarSummary; byId: (id: number) => NationSummary | undefined }) {
  const a = byId(w.attackerId);
  const d = byId(w.defenderId);
  return (
    <Link href={`/war/${w.id}`} className="panel flex items-center justify-between gap-3 border-war/25 p-4 transition hover:border-war/50">
      <div className="flex items-center gap-2">
        {a && <Flag emblem={a.emblem} size={36} />}
        <span className="truncate font-display text-xs uppercase text-fg">{a?.name}</span>
      </div>
      <div className="flex flex-col items-center">
        <Swords className="size-5 text-war" />
        <span className="mt-1 font-mono text-[10px] text-faint">{formatDuration(w.endsAt - Date.now() / 1000)}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="truncate font-display text-xs uppercase text-fg">{d?.name}</span>
        {d && <Flag emblem={d.emblem} size={36} />}
      </div>
    </Link>
  );
}

function Section({ title, icon, sub, children }: { title: string; icon: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="mb-12">
      <div className="mb-4 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-lg text-fg">
            <span className="mr-2">{icon}</span>
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-faint">{sub}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

export default function DiscoverPage() {
  const world = useWorld();
  const news = useNews({ limit: 200, severity: "notable" });
  const nations = useMemo(() => world.data?.nations ?? [], [world.data]);
  const byId = (id: number) => nations.find((n) => n.id === id);

  const s = useMemo(() => {
    const by = (f: (n: NationSummary) => number | null, filter: (n: NationSummary) => boolean = () => true) =>
      nations.filter((n) => filter(n) && f(n) !== null).sort((a, b) => (f(b) ?? 0) - (f(a) ?? 0)).slice(0, 8);
    const growth = (n: NationSummary) => (n.citizens24hAgo && n.citizens24hAgo > 0 ? n.citizens / n.citizens24hAgo - 1 : null);
    const mcaps = nations.map((n) => n.marketCapEth ?? 0).sort((a, b) => a - b);
    const median = mcaps[Math.floor(mcaps.length / 2)] ?? 0;
    const explosionIds = [...new Set((news.data ?? []).filter((e) => e.type === "POPULATION_EXPLOSION" && e.nationId).map((e) => e.nationId!))];
    return {
      rising: by((n) => n.change24h, (n) => (n.change24h ?? 0) > 0),
      growing: by(growth, (n) => n.citizens >= 5),
      explosion: explosionIds.map(byId).filter(Boolean).slice(0, 8) as NationSummary[],
      top: [...nations].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, 8),
      newest: [...nations].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8),
      hidden: by((n) => n.civilizationScore, (n) => (n.marketCapEth ?? 0) <= median),
      growthOf: growth,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nations, news.data]);
  const wars = (world.data?.wars ?? []).filter((w) => w.status === "active");

  const grid = (list: NationSummary[], meta?: (n: NationSummary) => React.ReactNode, empty = "Nothing here yet.") =>
    list.length === 0 ? (
      <EmptyState title={empty} />
    ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {list.map((n, i) => (
          <motion.div key={n.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
            <NationCard n={n} meta={meta?.(n)} />
          </motion.div>
        ))}
      </div>
    );

  return (
    <div className="mx-auto max-w-7xl px-4 pb-24 pt-24 sm:px-6">
      <div className="mb-10">
        <div className="label mb-2">Discover</div>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-fg sm:text-4xl">Nations on the move</h1>
      </div>
      {world.isError ? (
        <DataUnavailable />
      ) : !world.data ? (
        <div className="grid gap-3 sm:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-56" />)}</div>
      ) : nations.length === 0 ? (
        <EmptyState icon="🌍" title="No nations yet" body="Found the first nation and it will appear here." />
      ) : (
        <>
          <Section title="Rising Nations" icon="🔥" sub="Biggest 24h price gains">
            {grid(s.rising, (n) => `24h ${formatPct(n.change24h)}`, "No nation is up in the last 24 hours.")}
          </Section>
          <Section title="Fastest Growing" icon="🚀" sub="Citizen growth over 24 hours">
            {grid(s.growing, (n) => `${formatPct(s.growthOf(n))} citizens in 24h`)}
          </Section>
          <Section title="Population Explosion" icon="👥" sub="Nations that recently gained 25%+ citizens in a day">
            {grid(s.explosion, undefined, "No population explosions recently.")}
          </Section>
          <Section title="Active Wars" icon="⚔️" sub="Live wars and their countdowns">
            {wars.length === 0 ? <EmptyState title="The world is at peace." /> : <div className="grid gap-3 md:grid-cols-2">{wars.map((w) => <WarCard key={w.id} w={w} byId={byId} />)}</div>}
          </Section>
          <Section title="Top Civilizations" icon="🏆" sub="Highest civilization scores">
            {grid(s.top)}
          </Section>
          <Section title="Newly Founded" icon="🆕" sub="The newest nations on the map">
            {grid(s.newest, (n) => `Founded ${timeAgo(n.createdAt)}`)}
          </Section>
          <Section title="Hidden Empires" icon="💎" sub="Strong civilizations with below-median market caps">
            {grid(s.hidden, (n) => `Civilization ${n.civilizationScore.toFixed(1)}`)}
          </Section>
        </>
      )}
    </div>
  );
}
