"use client";
import { use } from "react";
import Link from "next/link";
import { motion } from "motion/react";
import { ALLIANCE, formatDate, formatWif, formatInt, timeAgo } from "@atlaspad/shared";
import { useAlliance } from "@/lib/api";
import { Flag } from "@/components/emblem/Flag";
import { Badge } from "@/components/ui/Badge";
import { Panel } from "@/components/ui/Panel";
import { DataUnavailable, Skeleton } from "@/components/ui/misc";

export default function AlliancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const q = useAlliance(Number(id));
  if (q.isError) return <div className="mx-auto max-w-3xl px-4 pt-28"><DataUnavailable reason="This alliance could not be loaded." /></div>;
  if (!q.data) return <div className="mx-auto max-w-5xl px-4 pt-28"><Skeleton className="h-96" /></div>;
  const { alliance, members, invites, nations } = q.data;
  const byId = (nid: number) => nations.find((n) => n.id === nid);
  const current = members.filter((m) => m.leftAt === null).map((m) => byId(m.nationId)).filter(Boolean) as NonNullable<ReturnType<typeof byId>>[];
  const sum = (f: (n: (typeof current)[number]) => number) => current.reduce((s, n) => s + f(n), 0);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6">
      <div className="mb-10 text-center">
        <Badge tone={alliance.active ? "gold" : "neutral"}>{alliance.active ? "Alliance" : `Dissolved ${alliance.dissolvedAt ? formatDate(alliance.dissolvedAt) : ""}`}</Badge>
        <h1 className="mt-4 font-display text-3xl font-semibold uppercase tracking-[0.08em] text-gold-gradient text-gold-bright sm:text-5xl">{alliance.name}</h1>
        <p className="mt-2 text-sm text-dim">Founded {formatDate(alliance.createdAt)} · {current.length} / {ALLIANCE.maxMembers} members</p>
        <div className="mt-8 flex flex-wrap justify-center gap-6">
          {current.map((n, i) => (
            <motion.div key={n.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.1 }}>
              <Link href={`/nation/${n.id}`} className="flex flex-col items-center gap-2">
                <Flag emblem={n.emblem} size={72} glow={n.id === alliance.leaderId} />
                <span className="font-display text-xs uppercase tracking-wide text-fg">{n.name}</span>
                {n.id === alliance.leaderId && <Badge tone="gold">Leader</Badge>}
              </Link>
            </motion.div>
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        {[
          ["Combined GDP", formatWif(sum((n) => n.marketCapWif ?? 0))],
          ["Combined citizens", formatInt(sum((n) => n.citizens))],
          ["Combined influence", formatInt(sum((n) => n.resources.influence))],
          ["Alliance score", sum((n) => n.civilizationScore).toFixed(1)],
        ].map(([k, v]) => (
          <div key={k} className="panel-flat px-4 py-3">
            <div className="label mb-1">{k}</div>
            <div className="font-display text-xl text-fg">{v}</div>
          </div>
        ))}
      </div>
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Panel title="Charter" label="Game rules">
          <ul className="space-y-1.5 text-xs leading-relaxed text-dim">
            <li>• Up to {ALLIANCE.maxMembers} member nations; membership by invitation from the leading nation.</li>
            <li>• +{ALLIANCE.influenceBonusPctPerAlly}% influence production per ally (max {ALLIANCE.maxInfluenceBonusPct}%).</li>
            <li>• +{ALLIANCE.warScoreBonusPctPerAlly}% war score per ally (max {ALLIANCE.maxWarScoreBonusPct}%).</li>
            <li>• Members cannot declare war on each other.</li>
            <li>• Every membership change is an on-chain governance decision of the nation involved.</li>
          </ul>
        </Panel>
        <Panel title="Pending invitations">
          {invites.length === 0 ? (
            <p className="text-xs text-faint">None.</p>
          ) : (
            <div className="space-y-2">
              {invites.map((i) => {
                const n = byId(i.nationId);
                return (
                  <Link key={i.nationId} href={`/nation/${i.nationId}`} className="flex items-center gap-3 rounded-lg border border-line px-3 py-2">
                    {n && <Flag emblem={n.emblem} size={26} />}
                    <span className="flex-1 text-sm text-fg">{n?.name}</span>
                    <span className="font-mono text-[10px] text-faint">invited {timeAgo(i.invitedAt)}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}
