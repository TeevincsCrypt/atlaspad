"use client";
import { motion } from "motion/react";
import { Flame } from "lucide-react";
import { formatUsd, formatWif } from "@atlaspad/shared";
import { AnimatedNumber } from "@/components/ui/AnimatedNumber";

/**
 * The headline proof of the flywheel: all $WIF burned by AtlasPad so far (every founding fee plus 0.25% of every
 * curve trade), read from indexed on-chain WifBurned events and updated live.
 */
export function BurnCounter({ burned, wifUsd, volume }: { burned: number | null; wifUsd: number | null; volume: number | null }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.45, duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
      className="relative mt-8 max-w-xl overflow-hidden rounded-2xl border border-[#ff8a4c]/30 bg-gradient-to-br from-[#2a1208]/80 via-black/60 to-black/40 px-5 py-4 backdrop-blur"
    >
      <div className="pointer-events-none absolute -left-10 -top-16 size-48 rounded-full bg-[#ff7a3c]/20 blur-3xl" />
      <div className="relative flex items-center gap-4">
        <div className="relative grid size-14 shrink-0 place-items-center rounded-xl bg-[#ff7a3c]/15">
          <Flame className="size-7 animate-pulse-soft text-[#ff9a5c]" />
          <span className="absolute inset-0 animate-ping rounded-xl bg-[#ff7a3c]/10 [animation-duration:2.4s]" />
        </div>
        <div className="min-w-0">
          <div className="label mb-1 text-[#ffb489]">Total $WIF burned forever</div>
          <div className="font-display text-3xl font-semibold text-fg tabular sm:text-4xl">
            {burned === null ? <span className="text-sm text-faint">Data unavailable</span> : <AnimatedNumber value={burned} format={(v) => formatWif(v, { compact: v >= 1_000_000 })} />}
          </div>
          <div className="mt-1 font-mono text-[11px] text-dim">
            {burned !== null && wifUsd !== null && burned > 0 ? `≈ ${formatUsd(burned * wifUsd)} · ` : ""}
            100% of founding fees + 0.25% of every trade
            {volume ? ` · ${formatWif(volume)} traded` : ""}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
