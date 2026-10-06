"use client";
import { useEffect, useMemo } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Check, Loader2, X } from "lucide-react";
import type { Hash } from "viem";
import { decodeEmblem } from "@atlaspad/shared";
import type { TxPhase } from "@/lib/tx";
import { playSound } from "@/lib/sound";
import { Flag } from "../emblem/Flag";
import { ExplorerLink } from "../ui/misc";

const STAGES = [
  { key: "land", label: "Land rises from the sea" },
  { key: "capital", label: "The capital is raised" },
  { key: "flag", label: "The national flag is hoisted" },
  { key: "token", label: "Token contract deploys" },
  { key: "liquidity", label: "Bonding-curve liquidity initializes" },
] as const;

function hexPath(cx: number, cy: number, r: number) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    return `${i ? "L" : "M"}${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ") + "Z";
}

/**
 * The founding cinematic. The visual stages play while the wallet and network work; the final reveal only
 * appears once the transaction receipt confirms the nation on-chain.
 */
export function FoundingSequence({
  open,
  phase,
  name,
  ticker,
  emblem,
  hash,
  nationId,
  error,
  onClose,
}: {
  open: boolean;
  phase: TxPhase;
  name: string;
  ticker: string;
  emblem: bigint;
  hash: Hash | null;
  nationId: number | null;
  error: string | null;
  onClose: () => void;
}) {
  const color = decodeEmblem(emblem).primary;
  const confirmed = phase === "confirmed" && nationId !== null;
  const failed = phase === "failed" || phase === "rejected" || phase === "timeout";
  const progress = useMemo(() => {
    // Visual stages advance with the real transaction lifecycle.
    switch (phase) {
      case "awaiting_wallet":
        return 1;
      case "submitted":
        return 2;
      case "confirming":
        return 3;
      case "confirmed":
        return 5;
      default:
        return 0;
    }
  }, [phase]);

  useEffect(() => {
    if (confirmed) playSound("founded");
  }, [confirmed]);

  const hexes = useMemo(() => {
    const out: { x: number; y: number; d: number }[] = [];
    const r = 18;
    for (let q = -3; q <= 3; q++) {
      for (let s = -3; s <= 3; s++) {
        if (Math.abs(q + s) > 3) continue;
        const x = 200 + r * Math.sqrt(3) * (q + s / 2);
        const y = 200 + r * 1.5 * s;
        out.push({ x, y, d: Math.hypot(q, s) * 0.12 });
      }
    }
    return out;
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[90] overflow-y-auto bg-void/95 backdrop-blur" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${color}22, transparent 60%)` }} />
          {(confirmed || failed) && (
            <button onClick={onClose} className="absolute right-5 top-5 z-10 rounded-lg p-2 text-faint hover:text-fg" aria-label="Close">
              <X className="size-5" />
            </button>
          )}
          <div className="relative mx-auto flex min-h-full max-w-3xl flex-col items-center justify-center px-6 py-16 text-center">
            <svg viewBox="0 0 400 400" className="w-[min(380px,80vw)]">
              <defs>
                <radialGradient id="sea" cx="0.5" cy="0.5" r="0.5">
                  <stop offset="0" stopColor="#0d1830" />
                  <stop offset="1" stopColor="#03040a" stopOpacity="0" />
                </radialGradient>
              </defs>
              <circle cx="200" cy="200" r="190" fill="url(#sea)" />
              {hexes.map((h, i) => (
                <motion.path
                  key={i}
                  d={hexPath(h.x, h.y, 17)}
                  fill={progress >= 1 ? color : "#1a2132"}
                  fillOpacity={progress >= 1 ? 0.55 : 0.4}
                  stroke={color}
                  strokeOpacity={0.6}
                  initial={{ scale: 0, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.3 + h.d, type: "spring", stiffness: 200, damping: 16 }}
                  style={{ transformOrigin: `${h.x}px ${h.y}px` }}
                />
              ))}
              {progress >= 1 && (
                <motion.g initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ duration: 0.9 }}>
                  <rect x="170" y="180" width="60" height="34" fill="#1b2232" stroke={color} strokeOpacity="0.7" />
                  <path d="M176 180 Q200 150 224 180 Z" fill="#232b3f" stroke={color} />
                  {[180, 192, 204, 216].map((x) => (
                    <rect key={x} x={x} y="188" width="4" height="24" fill="#2b3550" />
                  ))}
                </motion.g>
              )}
              {progress >= 2 && (
                <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <motion.line x1="200" y1="150" x2="200" y2="150" stroke="#9aa2b5" strokeWidth="2" animate={{ y2: 96 }} transition={{ duration: 1.1 }} />
                  <motion.foreignObject x="202" width="64" height="44" initial={{ y: 140 }} animate={{ y: 96 }} transition={{ duration: 1.1 }}>
                    <motion.div animate={{ skewY: [0, -5, 0, 4, 0] }} transition={{ repeat: Infinity, duration: 2.8 }} style={{ transformOrigin: "left center" }}>
                      <Flag emblem={emblem} size={60} rounded={false} />
                    </motion.div>
                  </motion.foreignObject>
                </motion.g>
              )}
              {confirmed &&
                Array.from({ length: 24 }, (_, i) => (
                  <motion.circle
                    key={i}
                    cx="200"
                    cy="160"
                    r="2.5"
                    fill="#f3d58f"
                    initial={{ opacity: 1 }}
                    animate={{ cx: 200 + Math.cos((i / 24) * Math.PI * 2) * 170, cy: 160 + Math.sin((i / 24) * Math.PI * 2) * 170, opacity: 0 }}
                    transition={{ duration: 1.6, ease: "easeOut" }}
                  />
                ))}
            </svg>

            <AnimatePresence mode="wait">
              {confirmed ? (
                <motion.div key="welcome" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9 }}>
                  <div className="font-mono text-[11px] uppercase tracking-[0.4em] text-gold">Nation founded</div>
                  <h2 className="mt-3 font-display text-3xl font-semibold uppercase tracking-wide text-fg sm:text-5xl" style={{ textShadow: `0 0 50px ${color}88` }}>
                    Welcome to <span className="text-gold-gradient">{name}</span>
                  </h2>
                  <p className="mt-3 text-base text-dim">You are the Founding Monarch of ${ticker}.</p>
                  <div className="mt-8 flex flex-wrap justify-center gap-3">
                    <Link href={`/nation/${nationId}`} className="rounded-xl bg-gradient-to-b from-[#f3d58f] to-[#c79e52] px-6 py-3 font-display text-xs font-semibold uppercase tracking-[0.2em] text-[#1a1306]">
                      Visit your nation
                    </Link>
                    <Link href="/world" className="rounded-xl border border-gold/40 px-6 py-3 font-display text-xs uppercase tracking-[0.2em] text-gold-bright">
                      See it on the map
                    </Link>
                  </div>
                  {hash && (
                    <div className="mt-5 text-sm">
                      <ExplorerLink kind="tx" value={hash}>
                        Transaction confirmed — view on explorer
                      </ExplorerLink>
                    </div>
                  )}
                </motion.div>
              ) : (
                <motion.div key="progress" exit={{ opacity: 0 }} className="w-full max-w-sm">
                  <div className="font-display text-lg text-fg">{failed ? "The founding did not complete." : "Your nation is being founded…"}</div>
                  <div className="mt-6 space-y-2.5 text-left">
                    {STAGES.map((s, i) => {
                      const done = i < progress;
                      const active = i === progress && !failed;
                      return (
                        <motion.div key={s.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 * i }} className="flex items-center gap-3 text-sm">
                          <span className={`grid size-5 place-items-center rounded-full border ${done ? "border-up bg-up/15" : active ? "border-gold" : "border-line"}`}>
                            {done ? <Check className="size-3 text-up" /> : active ? <Loader2 className="size-3 animate-spin text-gold" /> : null}
                          </span>
                          <span className={done || active ? "text-fg" : "text-faint"}>{s.label}</span>
                        </motion.div>
                      );
                    })}
                  </div>
                  <div className="mt-6 font-mono text-[11px] uppercase tracking-[0.16em] text-faint">
                    {phase === "awaiting_wallet" && "Confirm the transaction in your wallet"}
                    {phase === "submitted" && "Submitted — waiting for the network"}
                    {phase === "confirming" && "Waiting for on-chain confirmation"}
                  </div>
                  {hash && (
                    <div className="mt-3 text-xs">
                      <ExplorerLink kind="tx" value={hash}>
                        View transaction
                      </ExplorerLink>
                    </div>
                  )}
                  {failed && error && <div className="mt-5 rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-xs text-down">{error}</div>}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
