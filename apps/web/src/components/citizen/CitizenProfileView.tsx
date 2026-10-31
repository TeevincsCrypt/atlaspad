"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { useState } from "react";
import { Lock, ReceiptText } from "lucide-react";
import { PnlCardDialog } from "../pnl/PnlCard";
import {
  ACHIEVEMENTS,
  CITIZEN_RANKS,
  formatCompact,
  formatDate,
  formatWif,
  formatInt,
  shortAddress,
  timeAgo,
  type PositionDTO,
} from "@atlaspad/shared";
import { useCitizen, useWorld } from "@/lib/api";
import { Flag } from "../emblem/Flag";
import { Badge } from "../ui/Badge";
import { Panel } from "../ui/Panel";
import { CopyButton, DataUnavailable, EmptyState, ExplorerLink, Progress, Skeleton } from "../ui/misc";

const RARITY: Record<string, string> = {
  common: "border-line-strong",
  rare: "border-info/40",
  epic: "border-[#9d8cff]/50",
  legendary: "border-gold/60 glow-gold",
};

export function CitizenProfileView({ address }: { address: string }) {
  const q = useCitizen(address);
  const [pnlTx, setPnlTx] = useState<string | null>(null);
  const world = useWorld();
  const byId = (id: number) => world.data?.nations.find((n) => n.id === id);
  if (q.isError) return <DataUnavailable reason="This citizen profile could not be loaded." />;
  if (!q.data) return <Skeleton className="h-96" />;
  const { profile, trades, proposals, positions = [] } = q.data;
  const nextRank = CITIZEN_RANKS.find((r) => r.minXp > profile.xp);
  const prevRank = [...CITIZEN_RANKS].reverse().find((r) => r.minXp <= profile.xp)!;
  const unlocked = new Map(profile.achievements.map((a) => [a.code, a]));
  const citizenAchievements = ACHIEVEMENTS.filter((a) => a.scope === "citizen");

  return (
    <div className="space-y-6">
      <header className="panel relative overflow-hidden p-6">
        <div className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-gold/10 blur-3xl" />
        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="label mb-2">Citizen profile</div>
            <div className="flex items-center gap-2">
              <h1 className="font-mono text-xl text-fg sm:text-2xl">{shortAddress(profile.address, 8)}</h1>
              <CopyButton value={profile.address} />
              <ExplorerLink kind="address" value={profile.address}>
                <span className="text-xs">Explorer</span>
              </ExplorerLink>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="gold">{profile.rankTitle}</Badge>
              {profile.titles.map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
          </div>
          <div className="min-w-[240px]">
            <div className="flex items-end justify-between">
              <div>
                <div className="label">Experience</div>
                <div className="font-display text-3xl text-gold-bright">{formatInt(profile.xp)} XP</div>
              </div>
              <div className="text-right">
                <div className="label">World rank</div>
                <div className="font-display text-2xl text-fg">{profile.rank ? `#${profile.rank}` : "—"}</div>
              </div>
            </div>
            <Progress className="mt-3" value={nextRank ? (profile.xp - prevRank.minXp) / (nextRank.minXp - prevRank.minXp) : 1} />
            <div className="mt-1 font-mono text-[10px] text-faint">{nextRank ? `${formatInt(nextRank.minXp - profile.xp)} XP to ${nextRank.title}` : "Highest rank reached"}</div>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-5">
          {[
            ["Citizenships", profile.citizenships.length],
            ["Nations founded", profile.foundedNationIds.length],
            ["Votes cast", profile.votesCast],
            ["Proposals", profile.proposalsCreated],
            ["Wars voted on", profile.warsParticipated],
          ].map(([k, v]) => (
            <div key={k} className="bg-panel/90 px-4 py-3">
              <div className="label mb-1">{k}</div>
              <div className="font-display text-xl text-fg">{v}</div>
            </div>
          ))}
        </div>
      </header>

      <PnlPanel positions={positions} />

      <Panel title="Achievements" label={`${profile.achievements.length} / ${citizenAchievements.length} collected`}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {citizenAchievements.map((a, i) => {
            const got = unlocked.get(a.code);
            return (
              <motion.div
                key={a.code}
                initial={{ opacity: 0, rotateY: 40 }}
                animate={{ opacity: 1, rotateY: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`relative flex flex-col items-center rounded-xl border p-3 text-center ${got ? `${RARITY[a.rarity]} bg-gradient-to-b from-white/[0.05] to-transparent` : "border-line opacity-45"}`}
              >
                <div className={`text-3xl ${got ? "" : "grayscale"}`}>{a.icon}</div>
                <div className="mt-2 text-xs font-medium text-fg">{a.name}</div>
                <div className="mt-1 text-[10px] leading-snug text-faint">{a.description}</div>
                <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.14em] text-faint">{got ? formatDate(got.unlockedAt) : a.rarity}</div>
                {!got && <Lock className="absolute right-2 top-2 size-3 text-faint" />}
              </motion.div>
            );
          })}
        </div>
      </Panel>

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Citizenships" label="Nations">
          {profile.citizenships.length === 0 ? (
            <EmptyState title="Not a citizen of any nation yet" body="Hold at least 0.0001% of a nation's supply to become a citizen." />
          ) : (
            <div className="space-y-2">
              {profile.citizenships.map((c) => (
                <Link key={c.nationId} href={`/nation/${c.nationId}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-line-strong">
                  <Flag emblem={c.emblem} image={c.metadataUri} size={32} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{c.name}</span>
                    <span className="font-mono text-[10px] text-faint">
                      Citizen since {timeAgo(c.since)} {c.isFounder && "· Founder"}
                    </span>
                  </span>
                  <span className="text-right font-mono text-xs">
                    <span className="block text-fg">{formatCompact(Number(c.balance) / 1e18)}</span>
                    <span className="text-faint">{(c.share * 100).toFixed(3)}%</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
        <Panel title="Governance activity" label="Votes & proposals">
          {profile.recentVotes.length === 0 && proposals.length === 0 ? (
            <EmptyState title="No governance activity yet" />
          ) : (
            <div className="space-y-1.5 text-xs">
              {proposals.map((p) => (
                <Link key={`p${p.id}`} href={`/nation/${p.nationId}?tab=government`} className="flex justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
                  <span className="truncate text-fg">📜 Proposed: {p.description.split("\n")[0]}</span>
                  <span className="shrink-0 text-faint">{byId(p.nationId)?.name}</span>
                </Link>
              ))}
              {profile.recentVotes.map((v) => (
                <Link key={`v${v.proposalId}`} href={`/nation/${v.nationId}?tab=government`} className="flex justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-white/[0.03]">
                  <span className="text-dim">
                    🗳️ Voted <span className={v.support === 1 ? "text-up" : v.support === 0 ? "text-down" : "text-faint"}>{v.support === 1 ? "for" : v.support === 0 ? "against" : "abstain"}</span> on #{v.proposalId}
                  </span>
                  <span className="shrink-0 text-faint">
                    {byId(v.nationId)?.name} · {timeAgo(v.timestamp)}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {profile.foundedNationIds.length > 0 && (
        <Panel title="Founded nations" label="Founder">
          <div className="flex flex-wrap gap-2">
            {profile.foundedNationIds.map((id) => {
              const n = byId(id);
              return (
                <Link key={id} href={`/nation/${id}`} className="flex items-center gap-2 rounded-lg border border-gold/30 px-3 py-2 hover:border-gold/60">
                  {n && <Flag emblem={n.emblem} image={n.metadataUri} size={26} />}
                  <span className="text-sm text-fg">{n?.name ?? `#${id}`}</span>
                </Link>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title="Recent trades" label="On-chain">
        {trades.length === 0 ? (
          <p className="text-xs text-faint">No trades.</p>
        ) : (
          <div className="space-y-1 font-mono text-xs">
            {trades.map((t) => (
              <div key={`${t.txHash}-${t.logIndex}`} className="flex justify-between gap-3">
                <span className={t.side === "buy" ? "text-up" : "text-down"}>
                  {t.side.toUpperCase()} {byId(t.nationId)?.ticker ? `$${byId(t.nationId)?.ticker}` : `#${t.nationId}`}
                </span>
                <span className="flex items-center gap-2 text-dim">
                  {formatWif(t.wifAmount)}
                  {t.side === "sell" && (
                    <button onClick={() => setPnlTx(t.txHash)} className="inline-flex items-center gap-1 rounded border border-gold/30 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] text-gold-bright hover:bg-gold/10">
                      <ReceiptText className="size-3" /> PnL card
                    </button>
                  )}
                </span>
                <ExplorerLink kind="tx" value={t.txHash} className="text-faint">
                  {timeAgo(t.timestamp)}
                </ExplorerLink>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <PnlCardDialog tx={pnlTx} onClose={() => setPnlTx(null)} />
    </div>
  );
}

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${formatWif(Math.abs(v))}`;
const tone = (v: number | null) => (v === null || Math.abs(v) < 1e-9 ? "text-dim" : v > 0 ? "text-up" : "text-down");

/** Profit and loss per nation, from this wallet's indexed trades (average-cost method, in $WIF). */
function PnlPanel({ positions }: { positions: PositionDTO[] }) {
  const realized = positions.reduce((s, p) => s + p.realizedWif, 0);
  const unrealized = positions.reduce((s, p) => s + (p.unrealizedWif ?? 0), 0);
  const value = positions.reduce((s, p) => s + (p.valueWif ?? 0), 0);
  const total = realized + unrealized;
  return (
    <Panel title="Profit & loss" label="From on-chain trades · in $WIF">
      {positions.length === 0 ? (
        <EmptyState title="No trades yet" body="Profit and loss appears here after this wallet buys or sells a nation." />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
            {[
              { k: "Total P&L", v: signed(total), c: tone(total) },
              { k: "Unrealized", v: signed(unrealized), c: tone(unrealized) },
              { k: "Realized", v: signed(realized), c: tone(realized) },
              { k: "Holdings value", v: formatWif(value), c: "text-fg" },
            ].map((x) => (
              <div key={x.k} className="bg-panel/90 px-4 py-3">
                <div className="label mb-1">{x.k}</div>
                <div className={`font-display text-lg tabular ${x.c}`}>{x.v}</div>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left font-mono text-xs">
              <thead className="text-[10px] uppercase tracking-[0.14em] text-faint">
                <tr>
                  <th className="py-2 font-normal">Nation</th>
                  <th className="py-2 text-right font-normal">Holding</th>
                  <th className="py-2 text-right font-normal">Avg cost → now</th>
                  <th className="py-2 text-right font-normal">Value</th>
                  <th className="py-2 text-right font-normal">Unrealized</th>
                  <th className="py-2 text-right font-normal">Realized</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => {
                  const pct = p.avgCostWif && p.priceWif ? p.priceWif / p.avgCostWif - 1 : null;
                  return (
                    <tr key={p.nationId} className="border-t border-line">
                      <td className="py-2">
                        <Link href={`/nation/${p.nationId}`} className="flex items-center gap-2 hover:text-gold-bright">
                          <Flag emblem={p.emblem} image={p.metadataUri} size={22} />
                          <span className="truncate text-fg">${p.ticker}</span>
                        </Link>
                      </td>
                      <td className="py-2 text-right text-dim">{formatCompact(p.balance)}</td>
                      <td className="py-2 text-right text-dim">
                        {p.avgCostWif ? p.avgCostWif.toPrecision(3) : "—"} → {p.priceWif ? p.priceWif.toPrecision(3) : "—"}
                        {pct !== null && <span className={`ml-1.5 ${tone(pct)}`}>({pct >= 0 ? "+" : ""}{(pct * 100).toFixed(1)}%)</span>}
                      </td>
                      <td className="py-2 text-right text-fg">{p.valueWif === null ? "—" : formatWif(p.valueWif)}</td>
                      <td className={`py-2 text-right ${tone(p.unrealizedWif)}`}>{p.unrealizedWif === null ? "—" : signed(p.unrealizedWif)}</td>
                      <td className={`py-2 text-right ${tone(p.realizedWif)}`}>{signed(p.realizedWif)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-[11px] text-faint">Average-cost method. Tokens received by transfer have no known cost and are left out of unrealized P&amp;L.</p>
        </>
      )}
    </Panel>
  );
}
