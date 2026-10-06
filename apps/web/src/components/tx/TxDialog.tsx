"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { motion } from "motion/react";
import { AlertTriangle, Check, ChevronDown, Loader2, ShieldAlert, XCircle } from "lucide-react";
import type { TransactionReceipt } from "viem";
import { formatEth } from "@atlaspad/shared";
import { network } from "@/lib/env";
import { PHASE_LABEL, useAtlasTx, type ContractCall, type TxPhase } from "@/lib/tx";
import { useUi } from "@/lib/store";
import { Dialog } from "../ui/Dialog";
import { Button } from "../ui/Button";
import { ExplorerLink } from "../ui/misc";

export interface TxRow {
  label: string;
  value: React.ReactNode;
  emphasis?: boolean;
}

export interface TxDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  action: string;
  rows: TxRow[];
  /** The call to simulate for the gas estimate. Omit when it can only be built after a signature. */
  previewCall?: ContractCall | null;
  /** Builds the final call at confirmation time (e.g. after signing a permit). Defaults to previewCall. */
  buildCall?: (sign: ReturnType<typeof useAtlasTx>["sign"]) => Promise<ContractCall | null>;
  /** Shown as a required checkbox for irreversible actions. */
  acknowledge?: string;
  notice?: React.ReactNode;
  confirmLabel?: string;
  onConfirmed?: (receipt: TransactionReceipt) => void;
  successTitle?: string;
  successBody?: React.ReactNode;
}

const STEPS: { phase: TxPhase[]; label: string }[] = [
  { phase: ["awaiting_signature", "awaiting_wallet"], label: "Approve in wallet" },
  { phase: ["submitted"], label: "Submitted to network" },
  { phase: ["confirming"], label: "Waiting for confirmation" },
  { phase: ["confirmed"], label: "Confirmed on-chain" },
];

function stepState(phase: TxPhase, i: number): "done" | "active" | "todo" {
  const order: TxPhase[] = ["awaiting_signature", "awaiting_wallet", "submitted", "confirming", "confirmed"];
  const p = order.indexOf(phase);
  const s = order.indexOf(STEPS[i]!.phase[0]!);
  const sEnd = order.indexOf(STEPS[i]!.phase[STEPS[i]!.phase.length - 1]!);
  if (phase === "confirmed") return "done";
  if (p > sEnd) return "done";
  if (p >= s && p <= sEnd) return "active";
  return "todo";
}

export function TxDialog(props: TxDialogProps) {
  const { open, onClose, previewCall } = props;
  const { isConnected } = useAccount();
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const tx = useAtlasTx();
  const [ack, setAck] = useState(false);
  const [showTech, setShowTech] = useState(false);
  // Every opening requires a fresh acknowledgement.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setAck(false);
  }

  useEffect(() => {
    if (!open) return;
    tx.reset();
    if (previewCall) void tx.prepare(previewCall);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const confirm = async () => {
    const call = props.buildCall ? await props.buildCall(tx.sign) : previewCall;
    if (!call) return;
    if (props.buildCall && !previewCall) {
      const gas = await tx.prepare(call);
      if (gas === null) return;
    }
    const receipt = await tx.send(call);
    if (receipt) props.onConfirmed?.(receipt);
  };

  const inFlight = tx.busy && tx.phase !== "preparing";
  const finished = tx.phase === "confirmed";
  const canConfirm = isConnected && !tx.busy && tx.phase !== "failed" && (!props.acknowledge || ack) && (previewCall ? tx.gasWei !== null : true);

  return (
    <Dialog open={open} onClose={onClose} title={finished ? "Transaction confirmed" : props.title} dismissable={!inFlight}>
      {finished ? (
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex flex-col items-center py-4 text-center">
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: "spring", stiffness: 260, damping: 16 }}
            className="mb-4 grid size-16 place-items-center rounded-full border border-up/40 bg-up/10 shadow-[0_0_40px_-8px_rgba(53,210,154,0.7)]"
          >
            <Check className="size-8 text-up" />
          </motion.div>
          <div className="font-display text-sm uppercase tracking-[0.24em] text-up">Transaction confirmed</div>
          <div className="mt-2 text-lg text-fg">{props.successTitle ?? props.action}</div>
          {props.successBody && <div className="mt-2 text-sm text-dim">{props.successBody}</div>}
          {tx.hash && (
            <ExplorerLink kind="tx" value={tx.hash} className="mt-4 text-sm">
              View transaction
            </ExplorerLink>
          )}
          <Button className="mt-6 w-full" onClick={onClose}>
            Done
          </Button>
        </motion.div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-white/[0.02]">
            {[
              { label: "Network", value: `${network.chain.name} · chain ${network.chain.id}` },
              { label: "Action", value: props.action },
              ...props.rows,
              {
                label: "Estimated network fee",
                value:
                  tx.phase === "preparing" ? (
                    <span className="inline-flex items-center gap-1.5 text-faint">
                      <Loader2 className="size-3 animate-spin" /> Simulating…
                    </span>
                  ) : tx.gasWei !== null ? (
                    formatEth(Number(tx.gasWei) / 1e18)
                  ) : previewCall ? (
                    <span className="text-faint">Unavailable</span>
                  ) : (
                    <span className="text-faint">Estimated after signing</span>
                  ),
              },
            ].map((r, i) => (
              <div key={i} className="flex items-start justify-between gap-4 border-b border-line px-4 py-2.5 text-sm last:border-0">
                <span className="shrink-0 text-faint">{r.label}</span>
                <span className={`text-right ${"emphasis" in r && r.emphasis ? "font-medium text-fg" : "text-dim"}`}>{r.value}</span>
              </div>
            ))}
          </div>

          {props.notice && <div className="rounded-lg border border-info/25 bg-info/[0.06] px-3 py-2.5 text-xs leading-relaxed text-info">{props.notice}</div>}

          {props.acknowledge && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-warn/30 bg-warn/[0.06] px-3 py-2.5 text-xs leading-relaxed text-warn">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#ffb547]" disabled={inFlight} />
              <span className="flex gap-2">
                <ShieldAlert className="size-4 shrink-0" />
                {props.acknowledge}
              </span>
            </label>
          )}

          {inFlight && (
            <div className="space-y-2 rounded-xl border border-line px-4 py-3">
              {STEPS.map((s, i) => {
                const st = stepState(tx.phase, i);
                return (
                  <div key={s.label} className="flex items-center gap-3 text-sm">
                    <span className={`grid size-5 place-items-center rounded-full border ${st === "done" ? "border-up bg-up/15" : st === "active" ? "border-gold" : "border-line"}`}>
                      {st === "done" ? <Check className="size-3 text-up" /> : st === "active" ? <Loader2 className="size-3 animate-spin text-gold" /> : null}
                    </span>
                    <span className={st === "todo" ? "text-faint" : "text-fg"}>{i === 0 && tx.phase === "awaiting_signature" ? "Sign in wallet" : s.label}</span>
                  </div>
                );
              })}
              {tx.hash && (
                <div className="pt-1 text-xs">
                  <ExplorerLink kind="tx" value={tx.hash}>
                    View transaction
                  </ExplorerLink>
                </div>
              )}
            </div>
          )}

          {tx.error && (tx.phase === "failed" || tx.phase === "rejected" || tx.phase === "timeout") && (
            <div className={`rounded-lg border px-3 py-2.5 text-xs ${tx.phase === "rejected" ? "border-line-strong text-dim" : "border-down/30 bg-down/[0.07] text-down"}`}>
              <div className="flex items-center gap-2 font-medium">
                {tx.phase === "rejected" ? <XCircle className="size-4" /> : <AlertTriangle className="size-4" />}
                {tx.error.title}
              </div>
              <p className="mt-1 leading-relaxed">{tx.error.message}</p>
              {tx.hash && (
                <ExplorerLink kind="tx" value={tx.hash} className="mt-1">
                  View on explorer
                </ExplorerLink>
              )}
              <button onClick={() => setShowTech(!showTech)} className="mt-2 flex items-center gap-1 text-[11px] text-faint">
                Technical details <ChevronDown className={`size-3 transition ${showTech ? "rotate-180" : ""}`} />
              </button>
              {showTech && <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] text-faint">{tx.error.technical}</pre>}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-faint">
            Blockchain transactions are final and cannot be reversed. AtlasPad never moves funds without your explicit approval in your wallet.
          </p>

          <div className="flex gap-2">
            <Button variant="ghost" className="flex-1" onClick={onClose} disabled={inFlight}>
              Cancel
            </Button>
            {!isConnected ? (
              <Button variant="primary" className="flex-1" onClick={() => setWalletOpen(true)}>
                Connect wallet
              </Button>
            ) : tx.phase === "failed" || tx.phase === "rejected" || tx.phase === "timeout" ? (
              <Button
                variant="primary"
                className="flex-1"
                onClick={() => {
                  tx.reset();
                  if (previewCall) void tx.prepare(previewCall);
                }}
              >
                Try again
              </Button>
            ) : (
              <Button variant="primary" className="flex-1" onClick={confirm} disabled={!canConfirm} loading={inFlight}>
                {inFlight ? PHASE_LABEL[tx.phase] : props.confirmLabel ?? "Confirm in wallet"}
              </Button>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
