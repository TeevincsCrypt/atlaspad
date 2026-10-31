"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { ArrowRight, Coins, Globe2, Landmark, Swords, Users, Vote } from "lucide-react";
import { formatCompact, formatWif, formatInt } from "@atlaspad/shared";
import { useNews, useWorld } from "@/lib/api";
import { network } from "@/lib/env";
import { playSound } from "@/lib/sound";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";
import { Flag } from "@/components/emblem/Flag";
import { ChangePill } from "@/components/ui/ChangePill";
import { NewsTicker } from "@/components/news/NewsTicker";
import { WifFlywheel } from "@/components/flywheel/WifFlywheel";
import { BurnCounter } from "@/components/flywheel/BurnCounter";

const ease = [0.16, 1, 0.3, 1] as const;

export default function LandingPage() {
  const router = useRouter();
  const world = useWorld();
  const news = useNews({ limit: 30 });
  const nations = world.data?.nations ?? [];
  const available = world.isSuccess;
  const citizens = nations.reduce((s, n) => s + n.citizens, 0);
  const volume = nations.reduce((s, n) => s + (n.volume24hWif ?? 0), 0);
  const top = [...nations].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, 6);

  return (
    <div className="relative">
      {/* HERO */}
      <section className="relative flex min-h-[100dvh] items-center px-5 pb-16 pt-20 sm:px-10 lg:px-16">
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-ink via-ink/70 to-transparent lg:via-ink/40" />
        <div className="relative z-10 max-w-2xl">
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2, ease }}
            className="mb-6 inline-flex items-center gap-2 rounded-full border border-line-strong bg-black/40 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] text-dim backdrop-blur"
          >
            <span className="size-1.5 animate-pulse-soft rounded-full bg-up" />
            Live on {network.chain.name} · powered by $WIF
          </motion.div>
          <h1 className="font-display text-[clamp(2.4rem,6.4vw,5.4rem)] font-semibold uppercase leading-[0.95] tracking-[-0.01em] text-fg">
            {["Every token", "is a"].map((line, i) => (
              <motion.span key={line} className="block" initial={{ opacity: 0, y: 30, filter: "blur(10px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 1.1, delay: 0.35 + i * 0.15, ease }}>
                {line}
              </motion.span>
            ))}
            <motion.span
              className="text-gold-gradient block animate-shimmer"
              initial={{ opacity: 0, y: 30, filter: "blur(10px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 1.2, delay: 0.7, ease }}
            >
              nation.
            </motion.span>
          </h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 1.1 }} className="mt-6 max-w-lg text-base leading-relaxed text-dim sm:text-lg">
            Launch a token. Build a civilization. Become a citizen. Every nation is bought, sold, taxed and pooled in $WIF.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 1.3, ease }} className="mt-9 flex flex-wrap gap-3">
            <button
              onClick={() => {
                playSound("click");
                router.push("/world");
              }}
              className="group inline-flex h-12 items-center gap-2.5 rounded-xl bg-gradient-to-b from-[#f3d58f] to-[#c79e52] px-7 font-display text-[12px] font-semibold uppercase tracking-[0.22em] text-[#1a1306] shadow-[0_0_0_1px_rgba(255,230,170,0.5),0_18px_40px_-14px_rgba(214,178,110,0.8)] transition hover:brightness-110"
            >
              Enter Atlas <ArrowRight className="size-4 transition group-hover:translate-x-0.5" />
            </button>
            <Link
              href="/found"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-gold/40 bg-black/30 px-7 font-display text-[12px] font-medium uppercase tracking-[0.22em] text-gold-bright backdrop-blur transition hover:bg-gold/10"
            >
              Found a Nation
            </Link>
          </motion.div>

          <BurnCounter
            burned={available ? (world.data?.flywheel.wifBurned ?? 0) : null}
            wifUsd={world.data?.wifUsd ?? null}
            volume={available ? (world.data?.flywheel.wifVolume ?? null) : null}
          />

          {/* Live world indicators — real data only */}
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.6, duration: 1 }} className="mt-5 grid max-w-xl grid-cols-3 gap-x-8 gap-y-5">
            {[
              { label: "Nations", value: available ? nations.length : null, fmt: (n: number) => formatInt(n) },
              { label: "Citizens", value: available ? citizens : null, fmt: (n: number) => formatCompact(n) },
              { label: "24h Volume", value: available ? volume : null, fmt: (n: number) => formatWif(n) },
            ].map((s) => (
              <div key={s.label}>
                <div className="label mb-1">{s.label}</div>
                <div className="whitespace-nowrap font-display text-lg text-fg sm:text-xl">
                  {s.value === null ? <span className="text-sm text-faint">Data unavailable</span> : <AnimatedNumber value={s.value} format={s.fmt} />}
                </div>
              </div>
            ))}
          </motion.div>
        </div>
        <div className="absolute inset-x-0 bottom-0 z-10">
          <NewsTicker items={news.data ?? []} />
        </div>
      </section>

      {/* ONBOARDING — understood in under 30 seconds */}
      <section className="relative z-10 border-t border-line bg-ink/95 px-5 py-20 backdrop-blur sm:px-10 lg:px-16">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
          {[
            { icon: Globe2, title: "Every token is a nation.", body: "Founding a nation launches a real token on a fair $WIF bonding curve. When the curve sells out, its $WIF liquidity is locked forever on Uniswap." },
            { icon: Users, title: "Every holder is a citizen.", body: "Buy a nation with $WIF and you're a citizen. Citizens vote on-chain: build, ally, declare war, and spend the national $WIF treasury." },
            { icon: Coins, title: "Markets shape the world.", body: "Real trades, holders and liquidity drive each nation's territory, cities, power and events — golden ages, crises and wars." },
          ].map((c, i) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.8, delay: i * 0.12, ease }}
              className="panel group relative overflow-hidden p-6"
            >
              <div className="absolute -right-10 -top-10 size-40 rounded-full bg-gold/5 blur-2xl transition group-hover:bg-gold/10" />
              <c.icon className="mb-6 size-5 text-gold" />
              <h3 className="font-display text-lg font-medium text-fg">{c.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-dim">{c.body}</p>
            </motion.div>
          ))}
        </div>
        <div className="mx-auto mt-10 flex max-w-6xl flex-wrap items-center justify-center gap-6 font-mono text-[11px] uppercase tracking-[0.18em] text-faint">
          <span className="flex items-center gap-2"><Landmark className="size-3.5" /> No admin keys</span>
          <span className="flex items-center gap-2"><Vote className="size-3.5" /> On-chain governance</span>
          <span className="flex items-center gap-2"><Swords className="size-3.5" /> Deterministic wars</span>
          <span className="flex items-center gap-2"><Coins className="size-3.5" /> 1% curve fee in $WIF · 0.25% burned</span>
        </div>
      </section>

      <WifFlywheel stats={available ? (world.data?.flywheel ?? null) : null} />

      {/* TOP CIVILIZATIONS */}
      <section className="relative z-10 bg-ink px-5 pb-24 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-6xl">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <div className="label mb-1">The world right now</div>
              <h2 className="font-display text-2xl text-fg">Leading civilizations</h2>
            </div>
            <Link href="/leaderboard" className="font-mono text-[11px] uppercase tracking-[0.16em] text-dim hover:text-gold-bright">
              Full leaderboard →
            </Link>
          </div>
          {!available ? (
            <div className="rounded-xl border border-dashed border-line-strong p-10 text-center text-sm text-faint">Data unavailable</div>
          ) : top.length === 0 ? (
            <div className="panel flex flex-col items-center gap-4 p-12 text-center">
              <div className="font-display text-lg text-fg">The Atlas awaits its first nation.</div>
              <p className="max-w-md text-sm text-dim">No nations have been founded yet. The first founder&apos;s land will appear on the map the moment the transaction confirms.</p>
              <Link href="/found" className="rounded-lg border border-gold/40 px-4 py-2 text-sm text-gold-bright hover:bg-gold/10">
                Found the first nation
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {top.map((n, i) => (
                <motion.div key={n.id} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 }}>
                  <Link href={`/nation/${n.id}`} className="panel flex items-center gap-4 p-4 transition hover:border-line-strong">
                    <span className="w-6 font-mono text-xs text-faint">#{n.rank ?? "—"}</span>
                    <Flag emblem={n.emblem} image={n.metadataUri} size={44} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-sm uppercase tracking-wide text-fg">{n.name}</span>
                      <span className="block font-mono text-[11px] text-faint">
                        ${n.ticker} · {formatCompact(n.citizens)} citizens
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block font-mono text-xs text-fg">{formatWif(n.marketCapWif)}</span>
                      <ChangePill value={n.change24h} />
                    </span>
                  </Link>
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
