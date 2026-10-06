"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { isAddress, parseEther, type Address, type Hex } from "viem";
import { atlasGovernorAbi } from "@atlaspad/shared/abis";
import {
  BUILDINGS,
  GOVERNANCE,
  GameAction,
  ProposalKind,
  encodeGameActionPayload,
  encodeSymbolPayload,
  encodeTreasuryPayload,
  formatCompact,
  formatDuration,
  formatEth,
  validateBuild,
  type BuildingType,
  type NationSummary,
} from "@atlaspad/shared";
import { contracts } from "@/lib/env";
import { useUi } from "@/lib/store";
import { queryKeys, useWorld, type NationDetail } from "@/lib/api";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { TxDialog } from "../tx/TxDialog";
import { EmblemEditor } from "../emblem/EmblemEditor";
import { toast } from "../ui/Toaster";
import { useVotingPower } from "./useGovernance";

export type ProposalPreset =
  | { type: "build"; building?: number }
  | { type: "war"; target?: number }
  | { type: "alliance-create" }
  | { type: "alliance-invite"; target?: number }
  | { type: "alliance-join"; allianceId?: number }
  | { type: "alliance-leave" }
  | { type: "treasury" }
  | { type: "symbol" };

const TYPES: { key: ProposalPreset["type"]; label: string; hint: string }[] = [
  { key: "build", label: "Build infrastructure", hint: "Spend game resources on a building" },
  { key: "war", label: "Declare war", hint: "A 48-hour contest decided by measurable metrics" },
  { key: "alliance-create", label: "Found an alliance", hint: "Create a new alliance led by this nation" },
  { key: "alliance-invite", label: "Invite to alliance", hint: "Leader only — invite another nation" },
  { key: "alliance-join", label: "Join an alliance", hint: "Accept a pending invitation" },
  { key: "alliance-leave", label: "Leave alliance", hint: "Withdraw from the current alliance" },
  { key: "treasury", label: "Treasury spending", hint: "Send ETH from the national treasury (max 25%)" },
  { key: "symbol", label: "Change national symbol", hint: "Update the on-chain flag" },
];

export function CreateProposal({
  open,
  onClose,
  nation,
  detail,
  preset,
}: {
  open: boolean;
  onClose: () => void;
  nation: NationSummary;
  detail: NationDetail;
  preset?: ProposalPreset;
}) {
  const world = useWorld();
  const qc = useQueryClient();
  const power = useVotingPower(nation.token, nation.id);
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const [type, setType] = useState<ProposalPreset["type"]>(preset?.type ?? "build");
  const [building, setBuilding] = useState<number>(preset && preset.type === "build" ? preset.building ?? 0 : 0);
  const [target, setTarget] = useState<number>(preset && (preset.type === "war" || preset.type === "alliance-invite") ? preset.target ?? 0 : 0);
  const [allianceId, setAllianceId] = useState<number>(preset && preset.type === "alliance-join" ? preset.allianceId ?? 0 : detail.invites[0]?.allianceId ?? 0);
  const [allianceName, setAllianceName] = useState("");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [emblem, setEmblem] = useState<bigint>(BigInt(nation.emblem));
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [review, setReview] = useState(false);

  const others = useMemo(() => (world.data?.nations ?? []).filter((n) => n.id !== nation.id).sort((a, b) => a.name.localeCompare(b.name)), [world.data, nation.id]);
  const releaseCap = (nation.treasuryEth * GOVERNANCE.maxReleaseBps) / 10_000;

  const built = new Set(detail.buildings.filter((b) => b.status === "complete").map((b) => b.type as BuildingType));
  const constructing = new Set(detail.buildings.filter((b) => b.status === "constructing").map((b) => b.type as BuildingType));
  const buildCheck = validateBuild({ type: building, built, underConstruction: constructing, resources: nation.resources, citizens: nation.citizens, graduated: nation.graduated });

  const draft = useMemo((): { kind: ProposalKind; payload: Hex; summary: string; error: string | null } | null => {
    try {
      switch (type) {
        case "build":
          return {
            kind: ProposalKind.GameAction,
            payload: encodeGameActionPayload(GameAction.Build, BigInt(building)),
            summary: `Build a ${BUILDINGS[building]!.name}`,
            error: null,
          };
        case "war":
          return target
            ? { kind: ProposalKind.GameAction, payload: encodeGameActionPayload(GameAction.DeclareWar, BigInt(target)), summary: `Declare war on ${others.find((o) => o.id === target)?.name}`, error: null }
            : { kind: ProposalKind.GameAction, payload: "0x", summary: "", error: "Choose a target nation." };
        case "alliance-create":
          return allianceName.trim().length >= 2 && allianceName.trim().length <= 32
            ? { kind: ProposalKind.GameAction, payload: encodeGameActionPayload(GameAction.CreateAlliance, 0n, allianceName.trim()), summary: `Found the alliance “${allianceName.trim()}”`, error: null }
            : { kind: ProposalKind.GameAction, payload: "0x", summary: "", error: "Alliance name must be 2–32 characters." };
        case "alliance-invite":
          return target
            ? { kind: ProposalKind.GameAction, payload: encodeGameActionPayload(GameAction.InviteToAlliance, BigInt(target)), summary: `Invite ${others.find((o) => o.id === target)?.name} to our alliance`, error: null }
            : { kind: ProposalKind.GameAction, payload: "0x", summary: "", error: "Choose a nation to invite." };
        case "alliance-join":
          return allianceId
            ? { kind: ProposalKind.GameAction, payload: encodeGameActionPayload(GameAction.JoinAlliance, BigInt(allianceId)), summary: `Join alliance #${allianceId}`, error: null }
            : { kind: ProposalKind.GameAction, payload: "0x", summary: "", error: "Choose an alliance invitation." };
        case "alliance-leave":
          return nation.allianceId
            ? { kind: ProposalKind.GameAction, payload: encodeGameActionPayload(GameAction.LeaveAlliance, BigInt(nation.allianceId)), summary: "Leave our alliance", error: null }
            : { kind: ProposalKind.GameAction, payload: "0x", summary: "", error: "This nation is not in an alliance." };
        case "treasury": {
          if (!isAddress(recipient)) return { kind: ProposalKind.Treasury, payload: "0x", summary: "", error: "Enter a valid recipient address." };
          const wei = parseEther((amount || "0") as `${number}`);
          if (wei <= 0n) return { kind: ProposalKind.Treasury, payload: "0x", summary: "", error: "Enter an amount." };
          return { kind: ProposalKind.Treasury, payload: encodeTreasuryPayload(recipient as Address, wei), summary: `Send ${formatEth(Number(amount))} from the treasury`, error: null };
        }
        case "symbol":
          return { kind: ProposalKind.Symbol, payload: encodeSymbolPayload(emblem, ""), summary: "Adopt a new national symbol", error: null };
      }
    } catch {
      return { kind: ProposalKind.GameAction, payload: "0x", summary: "", error: "Invalid input." };
    }
  }, [type, building, target, allianceName, allianceId, recipient, amount, emblem, nation.allianceId, others]);

  const description = `${title.trim() || draft?.summary || "Proposal"}${body.trim() ? `\n${body.trim()}` : ""}`;
  const voting = draft?.kind === ProposalKind.Treasury ? GOVERNANCE.treasuryVotingSeconds : GOVERNANCE.standardVotingSeconds;
  const quorumBps = draft?.kind === ProposalKind.Treasury ? GOVERNANCE.treasuryQuorumBps : GOVERNANCE.standardQuorumBps;
  const input = "w-full rounded-lg border border-line bg-black/30 px-3 py-2 text-sm text-fg outline-none focus:border-gold/50";

  return (
    <>
      <Dialog open={open && !review} onClose={onClose} title={`New proposal · ${nation.name}`} width="max-w-2xl">
        <div className="space-y-5">
          <div className="grid gap-1.5 sm:grid-cols-2">
            {TYPES.map((t) => (
              <button
                key={t.key}
                onClick={() => setType(t.key)}
                className={`rounded-lg border px-3 py-2 text-left transition ${type === t.key ? "border-gold/50 bg-gold/[0.07]" : "border-line hover:border-line-strong"}`}
              >
                <div className="text-sm text-fg">{t.label}</div>
                <div className="text-[11px] text-faint">{t.hint}</div>
              </button>
            ))}
          </div>

          {type === "build" && (
            <div className="space-y-2">
              <select value={building} onChange={(e) => setBuilding(Number(e.target.value))} className={input}>
                {BUILDINGS.map((b) => (
                  <option key={b.type} value={b.type}>
                    {b.icon} {b.name}
                  </option>
                ))}
              </select>
              <div className="rounded-lg border border-line p-3 text-xs text-dim">
                <div>{BUILDINGS[building]!.effect}</div>
                <div className="mt-1 font-mono text-[11px] text-faint">
                  Cost: {Object.entries(BUILDINGS[building]!.cost).map(([k, v]) => `${formatCompact(v)} ${k}`).join(" · ")} · {BUILDINGS[building]!.buildHours}h to build
                </div>
                <div className={`mt-2 ${buildCheck.ok ? "text-up" : "text-warn"}`}>
                  {buildCheck.ok ? "Requirements met today." : `Currently not possible: ${buildCheck.reason}`} The game engine checks again when the proposal is enacted.
                </div>
              </div>
            </div>
          )}
          {(type === "war" || type === "alliance-invite") && (
            <select value={target} onChange={(e) => setTarget(Number(e.target.value))} className={input}>
              <option value={0}>Choose a nation…</option>
              {others.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name} (${o.ticker})
                </option>
              ))}
            </select>
          )}
          {type === "war" && (
            <p className="text-xs leading-relaxed text-dim">
              Wars last 48 hours. The winner is decided deterministically from population growth, market momentum, trading activity and economic
              power (plus a defensive bonus for the defender). No tokens or ETH change hands — the winner earns influence and territory.
            </p>
          )}
          {type === "alliance-create" && <input value={allianceName} onChange={(e) => setAllianceName(e.target.value)} maxLength={32} placeholder="Alliance name" className={input} />}
          {type === "alliance-join" && (
            <select value={allianceId} onChange={(e) => setAllianceId(Number(e.target.value))} className={input}>
              <option value={0}>Choose an invitation…</option>
              {detail.invites.map((i) => (
                <option key={i.allianceId} value={i.allianceId}>
                  {i.allianceName} (#{i.allianceId})
                </option>
              ))}
            </select>
          )}
          {type === "treasury" && (
            <div className="space-y-2">
              <input value={recipient} onChange={(e) => setRecipient(e.target.value.trim())} placeholder="Recipient address (0x…)" className={`${input} font-mono`} />
              <input value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Amount in ETH" className={input} inputMode="decimal" />
              <p className="text-xs text-dim">
                Treasury: {formatEth(nation.treasuryEth)} · a single proposal can release at most 25% ({formatEth(releaseCap)}) at execution time. 3-day vote, 4%
                quorum, then a 1-day timelock.
              </p>
            </div>
          )}
          {type === "symbol" && <EmblemEditor value={emblem} onChange={setEmblem} />}

          <div className="space-y-2">
            <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={draft?.summary || "Title"} className={input} />
            <textarea value={body} onChange={(e) => setBody(e.target.value)} maxLength={1800} rows={3} placeholder="Why should citizens support this? (optional)" className={input} />
          </div>

          <div className="rounded-lg border border-line bg-white/[0.02] p-3 text-xs text-dim">
            Voting lasts {formatDuration(voting)} with a {quorumBps / 100}% quorum of total supply. You need {power.threshold !== null ? formatCompact(Number(power.threshold) / 1e18) : "—"} $
            {nation.ticker} of voting power (0.1% of supply) one second before proposing. Your voting power: {formatCompact(Number(power.votes) / 1e18)}.
          </div>
          {draft?.error && <div className="text-xs text-warn">{draft.error}</div>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            {power.address ? (
              <Button variant="primary" disabled={!draft || Boolean(draft.error) || !power.canPropose || !contracts} onClick={() => setReview(true)}>
                {power.canPropose ? "Review proposal" : "Not enough voting power"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => setWalletOpen(true)}>
                Connect wallet
              </Button>
            )}
          </div>
        </div>
      </Dialog>
      {contracts && draft && !draft.error && (
        <TxDialog
          open={review}
          onClose={() => {
            setReview(false);
          }}
          title="Submit proposal"
          action={`Propose: ${draft.summary}`}
          rows={[
            { label: "Nation", value: nation.name },
            { label: "Title", value: description.split("\n")[0], emphasis: true },
            { label: "Voting period", value: formatDuration(voting) },
            { label: "Quorum", value: `${quorumBps / 100}% of supply` },
          ]}
          previewCall={{ address: contracts.governor, abi: atlasGovernorAbi, functionName: "propose", args: [BigInt(nation.id), draft.kind, draft.payload, description] }}
          onConfirmed={() => {
            void qc.invalidateQueries({ queryKey: queryKeys.proposals(nation.id) });
            toast.success("Proposal submitted", "Citizens can vote once the indexer picks it up (seconds).");
            setReview(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
