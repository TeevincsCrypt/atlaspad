"use client";
import { use } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { Shield, Swords, Trophy } from "lucide-react";
import { WAR, formatDate, formatDuration, formatEth, formatInt, formatPct, type NationSummary } from "@atlaspad/shared";
import { useWar } from "@/lib/api";
import { Flag } from "@/components/emblem/Flag";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { DataUnavailable, ExplorerLink, Progress, Skeleton } from "@/components/ui/misc";
import { NewsFeedItem } from "@/components/news/NewsFeedItem";

const SCORE_ROWS = [
  { key: "growth", label: "Population growth", max: 30 },
  { key: "momentum", label: "Market momentum", max: 25 },
  { key: "activity", label: "Trading activity", max: 25 },
  { key: "economy", label: "Economic power", max: 20 },
  { key: "defense", label: "Defensive bonus", max: 10 },
  { key: "allianceBonus", label: "Alliance bonus", max: 10 },
] as const;

function Side({ n, align, winner, start }: { n: NationSummary; align: "left" | "right"; winner: boolean; start: { citizens: number; marketCapEth: number } }) {
  const growth = start.citizens > 0 ? n.citizens / start.citizens - 1 : null;
  const momentum = start.marketCapEth > 0 && n.marketCapEth !== null ? n.marketCapEth / start.marketCapEth - 1 : null;
  return (
    <motion.div initial={{ opacity: 0, x: align === "left" ? -40 : 40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }} className={`flex flex-col ${align === "left" ? "items-start text-left" : "items-end text-right"}`}>
      <Flag emblem={n.emblem} size={110} glow />
      <Link href={`/nation/${n.id}`} className="mt-4 font-display text-2xl font-semibold uppercase tracking-wide text-fg hover:text-gold-bright sm:text-3xl">
        {n.name}
      </Link>
      {winner && (
        <Badge tone="gold" className="mt-2">
          <Trophy className="size-3" /> Victor
        </Badge>
      )}
      <dl className="mt-4 space-y-1.5 font-mono text-xs">
        {[
          ["Economic power", n.economicPower.toFixed(0)],
          ["Population", formatInt(n.citizens)],
          ["Influence", formatInt(n.resources.influence)],
          ["24h activity", formatEth(n.volume24hEth)],
          ["Growth since declaration", formatPct(growth)],
          ["Market momentum", formatPct(momentum)],
          ["Defensive power", n.defensivePower.toFixed(0)],
        ].map(([k, v]) => (
          <div key={k} className={`flex gap-3 ${align === "right" ? "flex-row-reverse" : ""}`}>
            <dt className="text-faint">{k}</dt>
            <dd className="text-fg">{v}</dd>
          </div>
        ))}
      </dl>
    </motion.div>
  );
}

export default function WarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useWar(Number(id));
  if (q.isError) return <div className="mx-auto max-w-3xl px-4 pt-28"><DataUnavailable reason="This war could not be loaded." /></div>;
  if (!q.data) return <div className="mx-auto max-w-5xl px-4 pt-28"><Skeleton className="h-96" /></div>;
  const { war, attacker, defender, projection } = q.data;
  const active = war.status === "active";
  const now = Date.now() / 1000;
  const scores = active ? projection : war.attackerScore && war.defenderScore ? { attacker: war.attackerScore, defender: war.defenderScore, leader: war.winnerId ?? 0 } : null;
  const elapsed = Math.min(1, (now - war.declaredAt) / (war.endsAt - war.declaredAt));

  return (
    <div className="relative min-h-[100dvh] overflow-hidden pb-24 pt-24">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,59,78,0.12),transparent_60%)]" />
      <div className="relative mx-auto max-w-6xl px-4 sm:px-6">
        <div className="mb-10 text-center">
          <Badge tone={active ? "war" : "neutral"}>{active ? "War in progress" : `Ended ${formatDate(war.endsAt)}`}</Badge>
          <h1 className="mt-4 font-display text-3xl font-semibold uppercase tracking-wide text-fg sm:text-5xl">
            {attacker.name} <span className="text-war">vs</span> {defender.name}
          </h1>
          {war.reason && <p className="mt-3 text-sm text-dim">“{war.reason.split("\n")[0]}”</p>}
        </div>
        <div className="grid items-center gap-10 md:grid-cols-[1fr_auto_1fr]">
          <Side n={attacker} align="left" winner={war.winnerId === attacker.id} start={war.attackerStart} />
          <div className="flex flex-col items-center gap-3">
            <motion.div animate={{ scale: [1, 1.08, 1] }} transition={{ repeat: Infinity, duration: 2 }} className="grid size-20 place-items-center rounded-full border border-war/40 bg-war/10 shadow-[0_0_60px_-10px_rgba(255,59,78,0.8)]">
              <Swords className="size-9 text-war" />
            </motion.div>
            {active ? (
              <>
                <div className="font-mono text-xs uppercase tracking-[0.2em] text-faint">Ends in</div>
                <div className="font-display text-2xl text-fg">{formatDuration(war.endsAt - now)}</div>
                <Progress value={elapsed} tone="down" className="w-40" />
              </>
            ) : (
              <div className="font-mono text-xs uppercase tracking-[0.2em] text-gold">Spoils {war.spoils} influence</div>
            )}
          </div>
          <Side n={defender} align="right" winner={war.winnerId === defender.id} start={war.defenderStart} />
        </div>

        <Panel className="mt-12" title={active ? "Projected score if the war ended now" : "Final score"} label="Deterministic rules · no randomness">
          {!scores ? (
            <p className="text-sm text-faint">Score unavailable.</p>
          ) : (
            <div className="space-y-3">
              {SCORE_ROWS.map((r) => {
                const a = Number(scores.attacker[r.key] ?? 0);
                const d = Number(scores.defender[r.key] ?? 0);
                return (
                  <div key={r.key} className="grid grid-cols-[1fr_140px_1fr] items-center gap-3 text-xs">
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-mono text-fg">{a.toFixed(1)}</span>
                      <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-white/5">
                        <div className="ml-auto h-full rounded-full bg-war/70" style={{ width: `${(a / r.max) * 100}%` }} />
                      </div>
                    </div>
                    <div className="text-center text-faint">{r.label}</div>
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-full max-w-[220px] overflow-hidden rounded-full bg-white/5">
                        <div className="h-full rounded-full bg-info/70" style={{ width: `${(d / r.max) * 100}%` }} />
                      </div>
                      <span className="font-mono text-fg">{d.toFixed(1)}</span>
                    </div>
                  </div>
                );
              })}
              <div className="grid grid-cols-[1fr_140px_1fr] items-center gap-3 border-t border-line pt-3">
                <div className="text-right font-display text-2xl text-fg">{Number(scores.attacker.total ?? 0).toFixed(1)}</div>
                <div className="text-center font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Total</div>
                <div className="font-display text-2xl text-fg">{Number(scores.defender.total ?? 0).toFixed(1)}</div>
              </div>
            </div>
          )}
          <p className="mt-5 flex gap-2 text-[11px] leading-relaxed text-faint">
            <Shield className="size-3.5 shrink-0" />
            Wars last {WAR.durationSeconds / 3600} hours. Ties go to the defender. The winner gains influence and +{WAR.territoryBonusPct}% territory for 7 days. No tokens or
            ETH are at stake, and AtlasPad offers no betting on outcomes.
          </p>
        </Panel>
        <div className="mt-6 flex justify-center text-xs">
          <ExplorerLink kind="tx" value={war.txHash}>
            Declaration transaction
          </ExplorerLink>
        </div>
        {q.data.news.length > 0 && (
          <Panel className="mt-6" title="War dispatches">
            <div className="divide-y divide-line">
              {q.data.news.map((n) => (
                <NewsFeedItem key={n.id} item={n} compact />
              ))}
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
