"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Hammer, Lock, Plus, Shield, Swords, Users, Vote } from "lucide-react";
import { nationTokenAbi } from "@atlaspad/shared/abis";
import {
  ACHIEVEMENT_BY_CODE,
  ALLIANCE,
  BUILDINGS,
  GOVERNANCE,
  RESOURCES,
  WAR,
  formatCompact,
  formatDate,
  formatDuration,
  formatWif,
  formatInt,
  formatSmall,
  shortAddress,
  timeAgo,
  validateBuild,
  type BuildingType,
  type NationSummary,
} from "@atlaspad/shared";
import type { Address } from "viem";
import { queryKeys, useCandles, useHolders, useNews, useProposals, useSeries, useTrades, useTreasury, useWorld, type NationDetail } from "@/lib/api";
import { network } from "@/lib/env";
import { Panel } from "../ui/Panel";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Tabs } from "../ui/Tabs";
import { DataUnavailable, EmptyState, ExplorerLink, Progress, Skeleton } from "../ui/misc";
import { AreaChart, PriceChart } from "../charts/PriceChart";
import { Flag } from "../emblem/Flag";
import { NewsFeedItem } from "../news/NewsFeedItem";
import { ProposalCard } from "../governance/ProposalCard";
import { CreateProposal, type ProposalPreset } from "../governance/CreateProposal";
import { useVotingPower } from "../governance/useGovernance";
import { TxDialog } from "../tx/TxDialog";
import { toast } from "../ui/Toaster";
import { useNow } from "@/lib/hooks";

// ---------------------------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------------------------

const INTERVALS = [
  { key: "300", label: "5m" },
  { key: "900", label: "15m" },
  { key: "3600", label: "1h" },
  { key: "14400", label: "4h" },
  { key: "86400", label: "1d" },
] as const;

export function EconomyTab({ nation }: { nation: NationSummary }) {
  const [interval, setInterval] = useState<(typeof INTERVALS)[number]["key"]>("900");
  const candles = useCandles(nation.id, Number(interval));
  const series = useSeries(nation.id, 30);
  const trades = useTrades(nation.id);
  const pts = (f: (p: NonNullable<typeof series.data>[number]) => number | null) =>
    (series.data ?? []).map((p) => ({ time: p.time, value: f(p) ?? 0 }));
  return (
    <div className="space-y-4">
      <Panel
        label="Price · WIF per token"
        title={nation.priceWif ? `${formatSmall(nation.priceWif)} WIF` : "—"}
        actions={<Tabs tabs={INTERVALS.map((i) => ({ key: i.key, label: i.label }))} value={interval} onChange={setInterval} size="sm" />}
        bodyClassName="p-2 sm:p-3"
      >
        {candles.isError ? (
          <DataUnavailable reason="Price history could not be loaded." />
        ) : candles.data?.length ? (
          <PriceChart candles={candles.data} />
        ) : candles.isLoading ? (
          <Skeleton className="h-[320px]" />
        ) : (
          <EmptyState title="No trades yet" body="The first trade will draw this nation's price history." />
        )}
      </Panel>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {[
          { label: "Market cap (WIF)", data: pts((p) => p.marketCapWif), color: "#d6b26e", fmt: (v: number) => formatWif(v, { symbol: false }) },
          { label: "Citizens", data: pts((p) => p.citizens), color: "#6ea8ff", fmt: (v: number) => formatInt(v) },
          { label: "Liquidity (WIF)", data: pts((p) => p.liquidityWif), color: "#35d29a", fmt: (v: number) => formatWif(v, { symbol: false }) },
          { label: "Hourly volume (WIF)", data: pts((p) => p.volumeWif), color: "#ffb547", fmt: (v: number) => formatWif(v, { symbol: false }) },
          { label: "Treasury (WIF)", data: pts((p) => p.treasuryWif), color: "#e8c47a", fmt: (v: number) => formatWif(v, { symbol: false }) },
          { label: "Civilization score", data: pts((p) => p.civilizationScore), color: "#9d8cff", fmt: (v: number) => v.toFixed(1) },
        ].map((c) => (
          <Panel key={c.label} label="30 days · hourly" title={c.label} bodyClassName="p-2">
            {series.isError ? <DataUnavailable compact /> : c.data.length > 1 ? <AreaChart points={c.data} color={c.color} format={c.fmt} /> : <div className="grid h-[140px] place-items-center text-xs text-faint">Not enough history yet</div>}
          </Panel>
        ))}
      </div>
      <Panel title="Recent trades" label="Live">
        {trades.isError ? (
          <DataUnavailable />
        ) : !trades.data?.length ? (
          <EmptyState title="No trades yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="label">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-normal">Side</th>
                  <th className="py-2 pr-3 font-normal">WIF</th>
                  <th className="py-2 pr-3 font-normal">${nation.ticker}</th>
                  <th className="py-2 pr-3 font-normal">Price</th>
                  <th className="py-2 pr-3 font-normal">Trader</th>
                  <th className="py-2 pr-3 font-normal">Venue</th>
                  <th className="py-2 font-normal">When</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {trades.data.map((t) => (
                  <tr key={`${t.txHash}-${t.logIndex}`} className="border-b border-line/60">
                    <td className={`py-2 pr-3 ${t.side === "buy" ? "text-up" : "text-down"}`}>{t.side.toUpperCase()}</td>
                    <td className="py-2 pr-3 text-fg">{formatWif(t.wifAmount, { symbol: false })}</td>
                    <td className="py-2 pr-3 text-dim">{formatCompact(t.tokenAmount)}</td>
                    <td className="py-2 pr-3 text-dim">{formatSmall(t.priceWif)}</td>
                    <td className="py-2 pr-3">
                      <Link href={`/citizen/${t.trader}`} className="text-dim hover:text-gold-bright">
                        {shortAddress(t.trader)}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 text-faint">{t.venue}</td>
                    <td className="py-2">
                      <ExplorerLink kind="tx" value={t.txHash} className="text-faint">
                        {timeAgo(t.timestamp)}
                      </ExplorerLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Citizens
// ---------------------------------------------------------------------------------------------

export function CitizensTab({ nation }: { nation: NationSummary }) {
  const holders = useHolders(nation.id);
  const series = useSeries(nation.id, 30);
  const growth = nation.citizens24hAgo !== null && nation.citizens24hAgo > 0 ? nation.citizens / nation.citizens24hAgo - 1 : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Citizens", formatInt(nation.citizens)],
          ["All holders", holders.data ? formatInt(holders.data.total) : "—"],
          ["24h growth", growth === null ? "—" : `${growth >= 0 ? "+" : ""}${(growth * 100).toFixed(1)}%`],
          ["Top 10 citizens hold", holders.data ? `${(holders.data.top10Share * 100).toFixed(1)}%` : "—"],
        ].map(([k, v]) => (
          <div key={k} className="panel-flat px-4 py-3">
            <div className="label mb-1">{k}</div>
            <div className="font-display text-xl text-fg">{v}</div>
          </div>
        ))}
      </div>
      <Panel title="Population over time" label="30 days" bodyClassName="p-2">
        {(series.data?.length ?? 0) > 1 ? <AreaChart points={(series.data ?? []).map((p) => ({ time: p.time, value: p.citizens }))} color="#6ea8ff" format={(v) => formatInt(v)} /> : <div className="grid h-[140px] place-items-center text-xs text-faint">Not enough history yet</div>}
      </Panel>
      <Panel title="Register of citizens" label="Top holders">
        <p className="mb-3 text-xs leading-relaxed text-faint">
          A citizen holds at least 0.0001% of supply. Burn, DEX, pool and AtlasPad system contracts are listed but never counted. Wallet addresses are
          public blockchain data; AtlasPad stores nothing else about citizens.
        </p>
        {holders.isError ? (
          <DataUnavailable />
        ) : !holders.data ? (
          <Skeleton className="h-60" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="label">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-normal">#</th>
                  <th className="py-2 pr-3 font-normal">Address</th>
                  <th className="py-2 pr-3 font-normal">Balance</th>
                  <th className="py-2 pr-3 font-normal">Share</th>
                  <th className="py-2 font-normal">Since</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {holders.data.holders.map((h, i) => (
                  <tr key={h.address} className="border-b border-line/60">
                    <td className="py-2 pr-3 text-faint">{i + 1}</td>
                    <td className="py-2 pr-3">
                      <span className="flex items-center gap-2">
                        {h.isCitizen ? (
                          <Link href={`/citizen/${h.address}`} className="text-dim hover:text-gold-bright">
                            {shortAddress(h.address)}
                          </Link>
                        ) : (
                          <ExplorerLink kind="address" value={h.address} />
                        )}
                        {h.label && <Badge tone={h.isCitizen ? "gold" : "neutral"}>{h.label}</Badge>}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-fg">{formatCompact(Number(h.balance) / 1e18)}</td>
                    <td className="py-2 pr-3 text-dim">{(h.share * 100).toFixed(2)}%</td>
                    <td className="py-2 text-faint">{timeAgo(h.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Government
// ---------------------------------------------------------------------------------------------

export function GovernmentTab({ nation, detail, onPropose }: { nation: NationSummary; detail: NationDetail; onPropose: (p?: ProposalPreset) => void }) {
  const proposals = useProposals(nation.id);
  const world = useWorld();
  const { address } = useAccount();
  const power = useVotingPower(nation.token, nation.id);
  const qc = useQueryClient();
  const [activate, setActivate] = useState(false);
  const name = (id: number) => world.data?.nations.find((n) => n.id === id)?.name ?? `Nation #${id}`;
  const active = (proposals.data ?? []).filter((p) => p.state === 0 || p.state === 3 || p.state === 4);
  const past = (proposals.data ?? []).filter((p) => !(p.state === 0 || p.state === 3 || p.state === 4));
  const undelegated = power.balance > 0n && (!power.delegate || power.delegate === "0x0000000000000000000000000000000000000000");
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-sm uppercase tracking-[0.18em] text-dim">Open decisions</h3>
          <Button size="sm" variant="outline" onClick={() => onPropose()}>
            <Plus className="size-3.5" /> New proposal
          </Button>
        </div>
        {proposals.isError ? (
          <DataUnavailable />
        ) : !proposals.data ? (
          <Skeleton className="h-40" />
        ) : active.length === 0 ? (
          <EmptyState icon="🗳️" title="No open proposals" body="Any citizen with 0.1% of voting power can propose: build, ally, declare war or spend the treasury." />
        ) : (
          active.map((p) => <ProposalCard key={p.id} p={p} nation={nation} nationName={name} />)
        )}
        {past.length > 0 && (
          <>
            <h3 className="pt-2 font-display text-sm uppercase tracking-[0.18em] text-dim">History</h3>
            {past.map((p) => (
              <ProposalCard key={p.id} p={p} nation={nation} nationName={name} />
            ))}
          </>
        )}
      </div>
      <div className="space-y-4">
        <Panel title="Constitution" label="On-chain rules">
          <dl className="space-y-2 text-xs">
            {[
              ["Founder", <Link key="f" href={`/citizen/${nation.founder}`} className="text-gold-bright">{shortAddress(nation.founder)}</Link>],
              ["Founder allocation", `${formatCompact(Number(detail.founderAllocation) / 1e18)} $${nation.ticker} (30-day vesting, claimable after graduation)`],
              ["Government", "Token-weighted democracy"],
              ["Proposal threshold", `${GOVERNANCE.proposalThresholdBps / 100}% of supply`],
              ["Game & symbol votes", `1 day · ${GOVERNANCE.standardQuorumBps / 100}% quorum`],
              ["Treasury votes", `3 days · ${GOVERNANCE.treasuryQuorumBps / 100}% quorum · 1 day timelock`],
              ["Treasury limit", "25% of balance per proposal"],
              ["Admin keys", "None"],
            ].map(([k, v]) => (
              <div key={String(k)} className="flex justify-between gap-3">
                <dt className="text-faint">{k}</dt>
                <dd className="text-right text-dim">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Your citizenship" label={address ? shortAddress(address) : "Not connected"}>
          {!address ? (
            <p className="text-xs text-dim">Connect a wallet to see your voting power.</p>
          ) : (
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-faint">Balance</span>
                <span className="font-mono text-fg">{formatCompact(Number(power.balance) / 1e18)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-faint">Voting power</span>
                <span className="font-mono text-fg">{formatCompact(Number(power.votes) / 1e18)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-faint">Can propose</span>
                <span className={power.canPropose ? "text-up" : "text-faint"}>{power.canPropose ? "Yes" : "No"}</span>
              </div>
              {undelegated && (
                <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setActivate(true)}>
                  <Vote className="size-3.5" /> Activate voting power
                </Button>
              )}
              <p className="pt-1 text-[11px] text-faint">Tokens self-delegate automatically when received. Voting power on a proposal is your balance one second before it was created.</p>
            </div>
          )}
        </Panel>
      </div>
      {address && (
        <TxDialog
          open={activate}
          onClose={() => setActivate(false)}
          title="Activate voting power"
          action={`Delegate your $${nation.ticker} votes to yourself`}
          rows={[{ label: "Delegate to", value: shortAddress(address) }]}
          previewCall={{ address: nation.token as Address, abi: nationTokenAbi, functionName: "delegate", args: [address] }}
          onConfirmed={() => {
            power.refetch();
            void qc.invalidateQueries({ queryKey: queryKeys.proposals(nation.id) });
            toast.success("Voting power activated");
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------------------------

export function InfrastructureTab({ nation, detail, onPropose }: { nation: NationSummary; detail: NationDetail; onPropose: (p?: ProposalPreset) => void }) {
  const built = new Set(detail.buildings.filter((b) => b.status === "complete").map((b) => b.type as BuildingType));
  const constructing = new Set(detail.buildings.filter((b) => b.status === "constructing").map((b) => b.type as BuildingType));
  const now = useNow();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {RESOURCES.map((r) => (
          <div key={r} className="panel-flat px-4 py-3">
            <div className="label mb-1">{r}</div>
            <div className="font-display text-xl text-fg">{formatInt(nation.resources[r])}</div>
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-relaxed text-faint">
        Resources are game values produced every hour by citizens, trading activity, liquidity and governance participation. They cannot be bought,
        sold or withdrawn and have no monetary value.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {BUILDINGS.map((b) => {
          const isBuilt = built.has(b.type);
          const inProgress = detail.buildings.find((x) => x.type === b.type && x.status === "constructing");
          const check = validateBuild({ type: b.type, built, underConstruction: constructing, resources: nation.resources, citizens: nation.citizens, graduated: nation.graduated });
          const progress = inProgress ? Math.min(1, (now - inProgress.startedAt) / (inProgress.completesAt - inProgress.startedAt)) : 0;
          return (
            <div key={b.type} className={`panel-flat relative overflow-hidden p-4 ${isBuilt ? "border-gold/30" : ""}`}>
              {isBuilt && <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold to-transparent" />}
              <div className="flex items-start justify-between">
                <span className="text-3xl">{b.icon}</span>
                {isBuilt ? <Badge tone="gold">Built</Badge> : inProgress ? <Badge tone="info">Constructing</Badge> : check.ok ? <Badge tone="up">Available</Badge> : <Badge><Lock className="size-3" /> Locked</Badge>}
              </div>
              <div className="mt-3 font-display text-sm text-fg">{b.name}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-dim">{b.effect}</p>
              <div className="mt-2 font-mono text-[10px] text-faint">
                {Object.entries(b.cost).map(([k, v]) => `${formatCompact(v)} ${k}`).join(" · ")} · {b.buildHours}h
              </div>
              {inProgress && (
                <div className="mt-3">
                  <Progress value={progress} tone="info" />
                  <div className="mt-1 font-mono text-[10px] text-faint">Completes in {formatDuration(inProgress.completesAt - now)}</div>
                </div>
              )}
              {!isBuilt && !inProgress && (
                <>
                  {!check.ok && <div className="mt-2 text-[11px] text-warn">{check.reason}</div>}
                  <Button size="sm" variant="ghost" className="mt-2 w-full" onClick={() => onPropose({ type: "build", building: b.type })}>
                    <Hammer className="size-3.5" /> Propose construction
                  </Button>
                </>
              )}
            </div>
          );
        })}
      </div>
      {detail.resourceLedger.length > 0 && (
        <Panel title="Resource ledger" label="Spending & spoils">
          <div className="space-y-1.5 font-mono text-[11px]">
            {detail.resourceLedger.map((l, i) => (
              <div key={i} className="flex justify-between gap-3 border-b border-line/50 pb-1.5">
                <span className="text-dim">{l.reason}</span>
                <span className="text-faint">
                  {RESOURCES.filter((r) => l[r] !== 0).map((r) => `${l[r] > 0 ? "+" : ""}${l[r]} ${r}`).join(" · ")} · {timeAgo(l.at)}
                </span>
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Military
// ---------------------------------------------------------------------------------------------

export function MilitaryTab({ nation, detail, onPropose }: { nation: NationSummary; detail: NationDetail; onPropose: (p?: ProposalPreset) => void }) {
  const now = useNow();
  const world = useWorld();
  const byId = (id: number) => world.data?.nations.find((n) => n.id === id);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Military power", nation.militaryPower.toFixed(0)],
          ["Defensive power", nation.defensivePower.toFixed(0)],
          ["Record", `${nation.warWins}W – ${nation.warLosses}L`],
          ["Active wars", `${nation.activeWars} / ${WAR.maxActiveWarsPerNation}`],
        ].map(([k, v]) => (
          <div key={k} className="panel-flat px-4 py-3">
            <div className="label mb-1">{k}</div>
            <div className="font-display text-xl text-fg">{v}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm uppercase tracking-[0.18em] text-dim">Wars</h3>
        <Button size="sm" variant="danger" onClick={() => onPropose({ type: "war" })}>
          <Swords className="size-3.5" /> Propose a war
        </Button>
      </div>
      {detail.wars.length === 0 ? (
        <EmptyState icon="🕊️" title="At peace" body="This nation has never fought a war. Wars are declared by citizen vote and decided by measurable metrics — never by chance." />
      ) : (
        <div className="space-y-2">
          {detail.wars.map((w) => {
            const enemyId = w.attackerId === nation.id ? w.defenderId : w.attackerId;
            const enemy = byId(enemyId);
            const won = w.winnerId === nation.id;
            return (
              <Link key={w.id} href={`/war/${w.id}`} className="panel-flat flex items-center gap-4 p-4 transition hover:border-line-strong">
                <Swords className={`size-5 ${w.status === "active" ? "text-war" : "text-faint"}`} />
                {enemy && <Flag emblem={enemy.emblem} image={enemy.metadataUri} size={36} />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-fg">
                    {w.attackerId === nation.id ? "Declared war on" : "Attacked by"} {enemy?.name ?? `Nation #${enemyId}`}
                  </div>
                  <div className="font-mono text-[10px] text-faint">
                    {w.status === "active" ? `Ends in ${formatDuration(w.endsAt - now)}` : `Ended ${formatDate(w.endsAt)}`}
                  </div>
                </div>
                {w.status === "ended" ? <Badge tone={won ? "gold" : "down"}>{won ? "Victory" : "Defeat"}</Badge> : <Badge tone="war">Live</Badge>}
              </Link>
            );
          })}
        </div>
      )}
      <Panel title="How wars are decided" label="Published rules">
        <p className="text-xs leading-relaxed text-dim">
          Each side scores up to 30 points for population growth, 25 for market-cap momentum, 25 for trading activity during the war, and 20 for
          economic power at the end. The defender adds up to 10 for defensive power; allies add 2% each (max 10%). The higher score wins; ties go to
          the defender. The winner gains influence (10% of the loser&apos;s, minimum 50) and +10% territory for 7 days. No tokens or $WIF are at stake
          and nobody can bet on outcomes.
        </p>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Diplomacy
// ---------------------------------------------------------------------------------------------

export function DiplomacyTab({ nation, detail, onPropose }: { nation: NationSummary; detail: NationDetail; onPropose: (p?: ProposalPreset) => void }) {
  const now = useNow();
  const world = useWorld();
  const byId = (id: number) => world.data?.nations.find((n) => n.id === id);
  const rivals = useMemo(() => [...new Set(detail.wars.map((w) => (w.attackerId === nation.id ? w.defenderId : w.attackerId)))], [detail.wars, nation.id]);
  const isLeader = detail.alliance?.leaderId === nation.id;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Panel title={detail.alliance ? detail.alliance.name : "No alliance"} label="Alliance">
        {detail.alliance ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {detail.alliance.memberIds.map((id) => {
                const n = byId(id);
                return (
                  <Link key={id} href={`/nation/${id}`} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 hover:border-line-strong">
                    {n && <Flag emblem={n.emblem} image={n.metadataUri} size={22} />}
                    <span className="text-xs text-fg">{n?.name ?? `#${id}`}</span>
                    {id === detail.alliance!.leaderId && <Badge tone="gold">Leader</Badge>}
                  </Link>
                );
              })}
            </div>
            <p className="text-xs text-dim">
              Allies boost each other&apos;s influence production by {ALLIANCE.influenceBonusPctPerAlly}% per ally and war scores by {ALLIANCE.warScoreBonusPctPerAlly}% per ally. Allies
              cannot declare war on each other.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/alliance/${detail.alliance.id}`}>
                <Button size="sm" variant="secondary">
                  <Shield className="size-3.5" /> Alliance hall
                </Button>
              </Link>
              {isLeader && (
                <Button size="sm" variant="outline" onClick={() => onPropose({ type: "alliance-invite" })}>
                  <Users className="size-3.5" /> Propose an invitation
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => onPropose({ type: "alliance-leave" })}>
                Propose leaving
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-dim">Alliances hold up to {ALLIANCE.maxMembers} nations. Members cannot declare war on each other, produce +{ALLIANCE.influenceBonusPctPerAlly}% influence per ally (max {ALLIANCE.maxInfluenceBonusPct}%), and add +{ALLIANCE.warScoreBonusPctPerAlly}% war score per ally (max {ALLIANCE.maxWarScoreBonusPct}%). Membership requires an invitation from the alliance&apos;s leading nation.</p>
            <Button size="sm" variant="outline" onClick={() => onPropose({ type: "alliance-create" })}>
              <Plus className="size-3.5" /> Propose founding an alliance
            </Button>
          </div>
        )}
      </Panel>
      <Panel title="Invitations" label="Pending">
        {detail.invites.length === 0 ? (
          <p className="text-xs text-faint">No pending invitations.</p>
        ) : (
          <div className="space-y-2">
            {detail.invites.map((i) => (
              <div key={i.allianceId} className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
                <div>
                  <div className="text-sm text-fg">{i.allianceName}</div>
                  <div className="font-mono text-[10px] text-faint">Invited {timeAgo(i.invitedAt)} · expires in {formatDuration(i.invitedAt + ALLIANCE.inviteTtlSeconds - now)}</div>
                </div>
                <Button size="sm" variant="outline" onClick={() => onPropose({ type: "alliance-join", allianceId: i.allianceId })}>
                  Propose joining
                </Button>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Rivals" label="War history" className="lg:col-span-2">
        {rivals.length === 0 ? (
          <p className="text-xs text-faint">No rivalries yet.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {rivals.map((id) => {
              const n = byId(id);
              return (
                <Link key={id} href={`/nation/${id}`} className="flex items-center gap-2 rounded-lg border border-war/30 px-2.5 py-1.5">
                  {n && <Flag emblem={n.emblem} image={n.metadataUri} size={22} />}
                  <span className="text-xs text-fg">{n?.name ?? `#${id}`}</span>
                </Link>
              );
            })}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------------------------

export function HistoryTab({ nation, detail }: { nation: NationSummary; detail: NationDetail }) {
  const news = useNews({ nationId: nation.id, limit: 200 });
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Panel title="Chronicle" label="Every entry is backed by on-chain activity">
        {news.isError ? (
          <DataUnavailable />
        ) : !news.data ? (
          <Skeleton className="h-60" />
        ) : (
          <div className="divide-y divide-line">
            {news.data.map((n) => (
              <NewsFeedItem key={n.id} item={n} />
            ))}
            <div className="py-3 font-mono text-[11px] text-faint">Founded {formatDate(nation.createdAt)}.</div>
          </div>
        )}
      </Panel>
      <Panel title="Achievements" label={`${detail.achievements.length} unlocked`}>
        <div className="grid grid-cols-2 gap-2">
          {detail.achievements.map((a) => {
            const def = ACHIEVEMENT_BY_CODE[a.code];
            return (
              <div key={a.code} className="rounded-lg border border-gold/25 bg-gold/[0.05] p-2.5 text-center">
                <div className="text-2xl">{def?.icon}</div>
                <div className="mt-1 text-[11px] text-fg">{def?.name}</div>
                <div className="font-mono text-[9px] text-faint">{formatDate(a.unlockedAt)}</div>
              </div>
            );
          })}
          {detail.achievements.length === 0 && <p className="col-span-2 text-xs text-faint">None yet.</p>}
        </div>
      </Panel>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Treasury
// ---------------------------------------------------------------------------------------------

export function TreasuryTab({ nation, onPropose }: { nation: NationSummary; onPropose: (p?: ProposalPreset) => void }) {
  const t = useTreasury(nation.id);
  const series = useSeries(nation.id, 30);
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Balance", t.data ? formatWif(t.data.balanceWif) : "—"],
          ["Total received", t.data ? formatWif(t.data.receivedWif) : "—"],
          ["Total spent", t.data ? formatWif(t.data.releasedWif) : "—"],
          ["Max per proposal (25%)", t.data ? formatWif(t.data.balanceWif * 0.25) : "—"],
        ].map(([k, v]) => (
          <div key={k} className="panel-flat px-4 py-3">
            <div className="label mb-1">{k}</div>
            <div className="font-display text-xl text-fg">{v}</div>
          </div>
        ))}
      </div>
      <Panel
        title="National treasury"
        label="NationTreasury contract · governed by citizens"
        actions={
          <Button size="sm" variant="outline" onClick={() => onPropose({ type: "treasury" })}>
            Propose spending
          </Button>
        }
      >
        <p className="mb-4 text-xs leading-relaxed text-dim">
          Funded by 0.5% of every bonding-curve trade plus voluntary donations. Funds are real $WIF held in the{" "}
          {network.contracts ? <ExplorerLink kind="address" value={network.contracts.treasury}>NationTreasury contract</ExplorerLink> : "NationTreasury contract"}{" "}
          and can only leave through a passed, timelocked proposal of this nation — at most 25% per 7-day window, however many proposals pass. Nobody, including AtlasPad, can withdraw them otherwise.
        </p>
        {(series.data?.length ?? 0) > 1 && <AreaChart points={(series.data ?? []).map((p) => ({ time: p.time, value: p.treasuryWif }))} color="#e8c47a" format={(v) => formatWif(v, { symbol: false })} />}
        {t.isError ? (
          <DataUnavailable />
        ) : !t.data ? (
          <Skeleton className="h-40" />
        ) : t.data.txs.length === 0 ? (
          <EmptyState title="No treasury activity yet" />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="label">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-normal">Flow</th>
                  <th className="py-2 pr-3 font-normal">Amount</th>
                  <th className="py-2 pr-3 font-normal">Type</th>
                  <th className="py-2 pr-3 font-normal">Counterparty</th>
                  <th className="py-2 font-normal">When</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {t.data.txs.map((x, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className={`py-2 pr-3 ${x.direction === "in" ? "text-up" : "text-down"}`}>{x.direction === "in" ? "IN" : "OUT"}</td>
                    <td className="py-2 pr-3 text-fg">{formatWif(x.amountWif)}</td>
                    <td className="py-2 pr-3 text-dim">{x.kind === "trade_fee" ? "Trade fee" : x.kind === "donation" ? "Donation" : `Proposal #${x.proposalId}`}</td>
                    <td className="py-2 pr-3">
                      <ExplorerLink kind="address" value={x.counterparty} />
                    </td>
                    <td className="py-2">
                      <ExplorerLink kind="tx" value={x.txHash} className="text-faint">
                        {timeAgo(x.timestamp)}
                      </ExplorerLink>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
