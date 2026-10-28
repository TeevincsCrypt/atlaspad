"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { ExternalLink, Flame, Landmark, Lock, RefreshCw, Swords, Users } from "lucide-react";
import { formatWif, type FlywheelStats } from "@atlaspad/shared";
import { getWifUrl } from "@/lib/env";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";

const ease = [0.16, 1, 0.3, 1] as const;

/** The loop that keeps bringing people back to $WIF. Every step is an on-chain fact, not a promise. */
const LOOP = [
  { icon: Users, title: "Join with $WIF", body: "Every nation is bought and sold in $WIF. To become a citizen, you need $WIF." },
  { icon: Flame, title: "Every trade burns $WIF", body: "0.25% of every curve trade and 100% of every founding fee is burned on-chain, in the same transaction." },
  { icon: Landmark, title: "Treasuries fill with $WIF", body: "0.5% of every trade goes to the nation's treasury. Citizens vote on how to spend it: bounties, prizes, growth." },
  { icon: Swords, title: "Wars reward growth", body: "Wars are won by citizen growth and $WIF trading volume, so nations recruit, and new citizens bring new $WIF." },
  { icon: Lock, title: "Graduation locks $WIF", body: "A sold-out curve moves its raised $WIF into a nation/WIF Uniswap pool with the LP burned: locked forever." },
] as const;

export function WifFlywheel({ stats }: { stats: FlywheelStats | null }) {
  const tiles = [
    { label: "$WIF burned", value: stats?.wifBurned ?? null, icon: Flame, tone: "text-down" },
    { label: "$WIF locked in pools", value: stats?.wifLocked ?? null, icon: Lock, tone: "text-gold-bright" },
    { label: "$WIF in treasuries", value: stats?.wifInTreasuries ?? null, icon: Landmark, tone: "text-up" },
    { label: "$WIF traded", value: stats?.wifVolume ?? null, icon: RefreshCw, tone: "text-fg" },
  ];
  return (
    <section className="relative z-10 border-t border-line bg-ink px-5 py-20 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-6xl">
        <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="label mb-1">The $WIF flywheel</div>
            <h2 className="font-display text-2xl text-fg sm:text-3xl">Every nation runs on $WIF.</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-dim">
              Founding, citizenship, trading, treasuries and graduated liquidity are all denominated in $WIF. The more the world
              plays, the more $WIF is used, burned and locked.
            </p>
          </div>
          <a
            href={getWifUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-gold/40 px-4 font-mono text-[11px] uppercase tracking-[0.16em] text-gold-bright hover:bg-gold/10"
          >
            Get $WIF <ExternalLink className="size-3.5" />
          </a>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((t) => (
            <div key={t.label} className="panel p-4">
              <div className="label mb-2 flex items-center gap-1.5">
                <t.icon className={`size-3.5 ${t.tone}`} /> {t.label}
              </div>
              <div className="font-display text-xl text-fg">
                {t.value === null ? <span className="text-sm text-faint">Data unavailable</span> : <AnimatedNumber value={t.value} format={(v) => formatWif(v)} />}
              </div>
            </div>
          ))}
        </div>

        <ol className="grid gap-3 md:grid-cols-5">
          {LOOP.map((s, i) => (
            <motion.li
              key={s.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.7, delay: i * 0.08, ease }}
              className="panel relative p-4"
            >
              <div className="mb-3 flex items-center gap-2">
                <span className="grid size-6 place-items-center rounded-full border border-gold/40 font-mono text-[10px] text-gold-bright">{i + 1}</span>
                <s.icon className="size-4 text-gold" />
              </div>
              <h3 className="font-display text-sm font-medium text-fg">{s.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-dim">{s.body}</p>
            </motion.li>
          ))}
        </ol>
        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
          5 → 1: graduated nations trade against $WIF on Uniswap forever, so every new citizen still starts with $WIF.{" "}
          <Link href="/found" className="text-gold-bright hover:underline">
            Found a nation
          </Link>
        </p>
      </div>
    </section>
  );
}
