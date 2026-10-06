"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { Crown, Flame, Shield, Sparkles, Swords, TrendingDown } from "lucide-react";
import {
  TIERS,
  THEMES,
  formatDate,
  formatSmall,
  formatEth,
  formatInt,
  formatUsd,
  shortAddress,
  type NationSummary,
} from "@atlaspad/shared";
import { AnimatedNumber } from "../ui/AnimatedNumber";
import { Badge } from "../ui/Badge";
import { ChangePill } from "../ui/ChangePill";
import { ExplorerLink, Progress } from "../ui/misc";
import { Flag } from "../emblem/Flag";

const STATUS_BADGE: Record<string, { label: string; tone: "gold" | "down" | "up" | "warn"; icon: React.ReactNode }> = {
  GOLDEN_AGE: { label: "Golden Age", tone: "gold", icon: <Crown className="size-3" /> },
  ECONOMIC_CRISIS: { label: "Economic crisis", tone: "down", icon: <TrendingDown className="size-3" /> },
  NATIONAL_EMERGENCY: { label: "National emergency", tone: "down", icon: <TrendingDown className="size-3" /> },
  ECONOMIC_BOOM: { label: "Economic boom", tone: "up", icon: <Sparkles className="size-3" /> },
  TRADE_FESTIVAL: { label: "Trade festival", tone: "warn", icon: <Flame className="size-3" /> },
  MARKET_CRASH: { label: "Market crash", tone: "down", icon: <TrendingDown className="size-3" /> },
};

export function NationHeader({ nation, ethUsd, territoryRank }: { nation: NationSummary; ethUsd: number | null; territoryRank: number | null }) {
  const now = Date.now() / 1000;
  const statuses = nation.statuses.filter((s) => s.until > now);
  const usd = (eth: number | null) => (ethUsd !== null && eth !== null ? formatUsd(eth * ethUsd) : null);
  return (
    <header className="relative">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex items-center gap-5">
          <motion.div initial={{ opacity: 0, rotateY: -60 }} animate={{ opacity: 1, rotateY: 0 }} transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}>
            <Flag emblem={nation.emblem} size={96} glow />
          </motion.div>
          <div className="min-w-0">
            <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
              <Badge tone="gold">#{nation.rank ?? "—"} World</Badge>
              <Badge>{TIERS[nation.tier]?.name}</Badge>
              <Badge>{THEMES[nation.theme]?.name}</Badge>
              {nation.graduated ? <Badge tone="info">Uniswap · locked LP</Badge> : <Badge tone="warn">Bonding curve</Badge>}
              {nation.activeWars > 0 && (
                <Badge tone="war">
                  <Swords className="size-3" /> At war
                </Badge>
              )}
              {statuses.map((s) => {
                const b = STATUS_BADGE[s.type];
                return b ? (
                  <Badge key={s.type} tone={b.tone}>
                    {b.icon} {b.label}
                  </Badge>
                ) : null;
              })}
            </div>
            <motion.h1
              initial={{ opacity: 0, y: 12, filter: "blur(6px)" }}
              animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
              transition={{ duration: 0.8 }}
              className="truncate font-display text-3xl font-semibold uppercase tracking-wide text-fg sm:text-5xl"
            >
              {nation.name}
            </motion.h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs text-dim">
              <ExplorerLink kind="token" value={nation.token}>
                ${nation.ticker}
              </ExplorerLink>
              <span>
                Founder{" "}
                <Link href={`/citizen/${nation.founder}`} className="text-dim hover:text-gold-bright">
                  {shortAddress(nation.founder)}
                </Link>
              </span>
              <span>Founded {formatDate(nation.createdAt)}</span>
            </div>
          </div>
        </div>
        <div className="flex items-end gap-6">
          <div className="text-right">
            <div className="label mb-1">GDP · market cap</div>
            <div className="font-display text-3xl text-fg">
              <AnimatedNumber value={nation.marketCapEth} format={(v) => formatEth(v)} />
            </div>
            <div className="mt-1 flex items-center justify-end gap-2 font-mono text-xs text-faint">
              {usd(nation.marketCapEth) ?? ""}
              <ChangePill value={nation.change24h} />
              <span>24h</span>
            </div>
          </div>
        </div>
      </div>

      {!nation.graduated && nation.curveProgress !== null && (
        <div className="mt-6">
          <div className="mb-1.5 flex justify-between font-mono text-[10px] uppercase tracking-[0.16em] text-faint">
            <span>Founding curve</span>
            <span>{(nation.curveProgress * 100).toFixed(1)}% sold · graduates to Uniswap at 100%</span>
          </div>
          <Progress value={nation.curveProgress} />
        </div>
      )}

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4 lg:grid-cols-8">
        {[
          { label: "Citizens", value: <AnimatedNumber value={nation.citizens} format={(v) => formatInt(v)} />, hint: "Wallets holding ≥0.0001% of supply (system & DEX addresses excluded)" },
          { label: "Population score", value: nation.populationScore.toFixed(0) },
          { label: "Economic power", value: <AnimatedNumber value={nation.economicPower} format={(v) => v.toFixed(0)} /> },
          { label: "Military power", value: <AnimatedNumber value={nation.militaryPower} format={(v) => v.toFixed(0)} /> },
          { label: "Influence", value: <AnimatedNumber value={nation.influenceScore} format={(v) => v.toFixed(0)} /> },
          { label: "Territory", value: territoryRank ? `#${territoryRank}` : "—", hint: `${nation.territoryCells} hexes` },
          { label: "24h volume", value: formatEth(nation.volume24hEth) },
          { label: "Treasury", value: formatEth(nation.treasuryEth) },
        ].map((s) => (
          <div key={s.label} className="bg-panel/90 px-4 py-3" title={s.hint}>
            <div className="label mb-1 truncate">{s.label}</div>
            <div className="truncate whitespace-nowrap font-display text-base text-fg tabular sm:text-lg">{s.value}</div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
        <span className="flex items-center gap-1">
          <Shield className="size-3" /> Defense {nation.defensivePower.toFixed(0)}
        </span>
        <span>Civilization score {nation.civilizationScore.toFixed(1)}</span>
        <span>
          Wars {nation.warWins}W–{nation.warLosses}L
        </span>
        <span>Liquidity {formatEth(nation.liquidityEth)}</span>
        <span>Price {nation.priceEth ? `${formatSmall(nation.priceEth)} ETH` : "—"}</span>
      </div>
    </header>
  );
}
