"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock, Hammer, Landmark, Swords, Users, XCircle } from "lucide-react";
import { atlasGovernorAbi } from "@atlaspad/shared/abis";
import {
  GameAction,
  ProposalKind,
  ProposalState,
  describeAction,
  decodePayload,
  formatCompact,
  formatDuration,
  formatWif,
  shortAddress,
  timeAgo,
  type NationSummary,
  type ProposalDTO,
} from "@atlaspad/shared";
import type { Hex } from "viem";
import { contracts } from "@/lib/env";
import { queryKeys } from "@/lib/api";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { ExplorerLink, Progress } from "../ui/misc";
import { TxDialog } from "../tx/TxDialog";
import { toast } from "../ui/Toaster";
import { useProposalVoter } from "./useGovernance";
import { useNow } from "@/lib/hooks";

const STATE_LABEL: Record<number, { label: string; tone: "gold" | "up" | "down" | "neutral" | "info" | "warn" }> = {
  [ProposalState.Active]: { label: "Voting", tone: "gold" },
  [ProposalState.Canceled]: { label: "Canceled", tone: "neutral" },
  [ProposalState.Defeated]: { label: "Defeated", tone: "down" },
  [ProposalState.Queued]: { label: "Timelocked", tone: "info" },
  [ProposalState.Executable]: { label: "Passed · ready", tone: "up" },
  [ProposalState.Executed]: { label: "Enacted", tone: "up" },
  [ProposalState.Expired]: { label: "Expired", tone: "neutral" },
};

function KindIcon({ p }: { p: ProposalDTO }) {
  const d = decodePayload(p.kind, p.payload as Hex);
  if (d.kind === ProposalKind.Treasury) return <Landmark className="size-4 text-gold" />;
  if (d.kind === ProposalKind.GameAction) {
    if (d.action === GameAction.DeclareWar) return <Swords className="size-4 text-war" />;
    if (d.action === GameAction.Build) return <Hammer className="size-4 text-info" />;
    return <Users className="size-4 text-up" />;
  }
  return <Landmark className="size-4 text-dim" />;
}

export function ProposalCard({ p, nation, nationName }: { p: ProposalDTO; nation: NationSummary; nationName: (id: number) => string }) {
  const { address } = useAccount();
  const qc = useQueryClient();
  const voter = useProposalVoter(p.id, nation.token, p.snapshot);
  const [vote, setVote] = useState<0 | 1 | 2 | null>(null);
  const [exec, setExec] = useState<"execute" | "cancel" | null>(null);
  const decoded = decodePayload(p.kind, p.payload as Hex);
  const forV = BigInt(p.forVotes);
  const againstV = BigInt(p.againstVotes);
  const abstainV = BigInt(p.abstainVotes);
  const total = forV + againstV + abstainV;
  const quorum = BigInt(p.quorum);
  const quorumProgress = quorum > 0n ? Number(((forV + abstainV) * 10_000n) / quorum) / 10_000 : 0;
  const now = useNow();
  const state = STATE_LABEL[p.state] ?? STATE_LABEL[0]!;
  const title = p.description.split("\n")[0] || describeAction(decoded, nationName);
  const body = p.description.split("\n").slice(1).join("\n").trim();
  const tok = (v: bigint) => formatCompact(Number(v) / 1e18);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: queryKeys.proposals(nation.id) });
    voter.refetch();
  };

  return (
    <article className="panel-flat p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border border-line bg-black/30">
          <KindIcon p={p} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={state.tone}>{state.label}</Badge>
            <span className="font-mono text-[10px] text-faint">#{p.id}</span>
            <span className="font-mono text-[10px] text-faint">{describeAction(decoded, nationName)}</span>
          </div>
          <h4 className="mt-1.5 text-sm font-medium text-fg">{title}</h4>
          {body && <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-dim">{body}</p>}
          {decoded.kind === ProposalKind.Treasury && (
            <div className="mt-2 text-xs text-dim">
              Sends <span className="text-fg">{formatWif(Number(decoded.amountWei) / 1e18)}</span> to{" "}
              <ExplorerLink kind="address" value={decoded.recipient} />
            </div>
          )}
          {p.gameOutcome && (
            <div className={`mt-2 flex items-center gap-1.5 text-xs ${p.gameOutcome.status === "applied" ? "text-up" : "text-warn"}`}>
              {p.gameOutcome.status === "applied" ? <CheckCircle2 className="size-3.5" /> : <XCircle className="size-3.5" />}
              {p.gameOutcome.status === "applied" ? "Carried out by the game engine" : `Not carried out: ${p.gameOutcome.reason}`}
            </div>
          )}

          <div className="mt-3 space-y-1.5">
            <div className="flex h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              {total > 0n && (
                <>
                  <div className="bg-up" style={{ width: `${(Number(forV) / Number(total)) * 100}%` }} />
                  <div className="bg-down" style={{ width: `${(Number(againstV) / Number(total)) * 100}%` }} />
                  <div className="bg-white/25" style={{ width: `${(Number(abstainV) / Number(total)) * 100}%` }} />
                </>
              )}
            </div>
            <div className="flex flex-wrap justify-between gap-2 font-mono text-[10px] text-faint">
              <span>
                <span className="text-up">For {tok(forV)}</span> · <span className="text-down">Against {tok(againstV)}</span> · Abstain {tok(abstainV)}
              </span>
              <span>
                Quorum {tok(quorum)} ({Math.min(100, Math.round(quorumProgress * 100))}%)
              </span>
            </div>
            <Progress value={Math.min(1, quorumProgress)} tone={quorumProgress >= 1 ? "up" : "gold"} className="h-1" />
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 font-mono text-[10px] text-faint">
              <Clock className="size-3" />
              {p.state === ProposalState.Active
                ? `Voting ends in ${formatDuration(p.voteEnd - now)}`
                : p.state === ProposalState.Queued
                  ? `Executable in ${formatDuration(p.eta - now)}`
                  : p.state === ProposalState.Executable
                    ? `Must be executed within ${formatDuration(p.eta + 7 * 86400 - now)}`
                    : `Proposed ${timeAgo(p.createdAt)} by ${shortAddress(p.proposer)}`}
              <ExplorerLink kind="tx" value={p.txHash} className="ml-1 text-faint">
                tx
              </ExplorerLink>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {p.state === ProposalState.Active && address && !voter.hasVoted && voter.weight > 0n && (
                <>
                  <Button size="sm" variant="outline" onClick={() => setVote(1)}>
                    For
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => setVote(0)}>
                    Against
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setVote(2)}>
                    Abstain
                  </Button>
                </>
              )}
              {p.state === ProposalState.Active && address && voter.hasVoted && <Badge tone="up">You voted</Badge>}
              {p.state === ProposalState.Active && address && !voter.hasVoted && voter.weight === 0n && (
                <span className="font-mono text-[10px] text-faint">No voting power at snapshot</span>
              )}
              {p.state === ProposalState.Executable && (
                <Button size="sm" variant="primary" onClick={() => setExec("execute")}>
                  Execute
                </Button>
              )}
              {p.state === ProposalState.Active && address?.toLowerCase() === p.proposer && (
                <Button size="sm" variant="ghost" onClick={() => setExec("cancel")}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {contracts && (
        <>
          <TxDialog
            open={vote !== null}
            onClose={() => setVote(null)}
            title="Cast your vote"
            action={`Vote ${vote === 1 ? "FOR" : vote === 0 ? "AGAINST" : "ABSTAIN"} on proposal #${p.id}`}
            rows={[
              { label: "Proposal", value: title },
              { label: "Your voting power", value: `${tok(voter.weight)} $${nation.ticker} (at snapshot)`, emphasis: true },
            ]}
            previewCall={vote === null ? null : { address: contracts.governor, abi: atlasGovernorAbi, functionName: "castVote", args: [BigInt(p.id), vote, ""] }}
            notice="Votes are final and public. Voting power is your balance at the proposal snapshot, not now."
            onConfirmed={() => {
              refresh();
              toast.success("Vote recorded on-chain");
            }}
          />
          <TxDialog
            open={exec !== null}
            onClose={() => setExec(null)}
            title={exec === "execute" ? "Execute proposal" : "Cancel proposal"}
            action={exec === "execute" ? `Enact proposal #${p.id}: ${describeAction(decoded, nationName)}` : `Withdraw proposal #${p.id}`}
            rows={[{ label: "Proposal", value: title }]}
            previewCall={exec === null ? null : { address: contracts.governor, abi: atlasGovernorAbi, functionName: exec, args: [BigInt(p.id)] }}
            acknowledge={exec === "execute" && decoded.kind === ProposalKind.Treasury ? "I understand this transfers $WIF out of the national treasury and cannot be undone." : undefined}
            onConfirmed={() => {
              refresh();
              void qc.invalidateQueries({ queryKey: queryKeys.nation(nation.id) });
              toast.success(exec === "execute" ? "Proposal enacted" : "Proposal canceled");
            }}
          />
        </>
      )}
    </article>
  );
}
