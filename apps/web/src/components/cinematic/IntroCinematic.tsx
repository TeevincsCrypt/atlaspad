"use client";
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { FastForward } from "lucide-react";
import { useUi } from "@/lib/store";
import { LogoMark } from "../nav/Logo";

const ease = [0.16, 1, 0.3, 1] as const;
const DURATION_MS = 7200;
const WORD = "ATLASPAD";

// Deterministic starfield (same on every render).
const STARS = Array.from({ length: 70 }, (_, i) => {
  const r = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return { x: r(1) * 100, y: r(2) * 100, s: 0.6 + r(3) * 1.8, d: r(4) * 2.5, gold: r(5) > 0.78 };
});

// Decided once per page load on the client: first visit (or ?intro), never on the admin pages.
let initialShow: boolean | undefined;
function shouldShow(): boolean {
  if (initialShow === undefined) {
    const forced = new URLSearchParams(window.location.search).has("intro");
    const admin = window.location.pathname.startsWith("/admin");
    initialShow = !admin && (forced || !useUi.getState().introSeen);
  }
  return initialShow;
}
const noopSubscribe = () => () => {};

/**
 * Full-screen cinematic intro on a visitor's first visit: the compass forms out of a starfield, a light burst
 * reveals the wordmark and the $WIF tagline, then the scene opens onto the live world behind it.
 * Plays once per browser (the persisted `introSeen` flag); add `?intro` to any URL to replay it.
 */
export function IntroCinematic() {
  const initial = useSyncExternalStore(noopSubscribe, shouldShow, () => false);
  const [dismissed, setDismissed] = useState(false);
  const show = initial && !dismissed;
  const setIntroSeen = useUi((s) => s.setIntroSeen);
  const reduced = useReducedMotion();

  const finish = useCallback(() => {
    setDismissed(true);
    setIntroSeen(true);
  }, [setIntroSeen]);

  useEffect(() => {
    if (!show) return;
    const t = setTimeout(finish, reduced ? 2200 : DURATION_MS);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && finish();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
    };
  }, [show, finish, reduced]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="intro"
          className="fixed inset-0 z-[100] overflow-hidden bg-[#03040a]"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, scale: 1.06 }}
          transition={{ duration: 0.9, ease }}
          aria-label="AtlasPad intro"
        >
          {/* starfield */}
          {STARS.map((s, i) => (
            <motion.span
              key={i}
              className="absolute rounded-full"
              style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.s, height: s.s, background: s.gold ? "#f3d58f" : "#cfd6ea" }}
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.9, 0.35, 0.8] }}
              transition={{ duration: 3.2, delay: s.d * 0.4, repeat: Infinity, repeatType: "mirror" }}
            />
          ))}

          {/* slow light rays behind the mark */}
          <motion.div
            className="absolute left-1/2 top-[40%] size-[140vmax] -translate-x-1/2 -translate-y-1/2"
            style={{
              background: "repeating-conic-gradient(from 0deg, rgba(243,213,143,0.06) 0deg 3deg, transparent 4deg 22.5deg)",
              maskImage: "radial-gradient(circle, black 0%, transparent 55%)",
              WebkitMaskImage: "radial-gradient(circle, black 0%, transparent 55%)",
            }}
            initial={{ opacity: 0, rotate: -20 }}
            animate={{ opacity: 1, rotate: 25 }}
            transition={{ opacity: { duration: 1.2, delay: 0.6 }, rotate: { duration: 8, ease: "linear" } }}
          />

          <div className="absolute inset-0 flex flex-col items-center justify-center px-6 text-center">
            <div className="relative grid place-items-center">
              {/* glow */}
              <motion.div
                className="absolute size-[300px] rounded-full sm:size-[420px]"
                style={{ background: "radial-gradient(circle, rgba(243,213,143,0.55), rgba(214,178,110,0.15) 45%, transparent 70%)" }}
                initial={{ opacity: 0, scale: 0.4 }}
                animate={{ opacity: [0, 0.9, 0.45], scale: [0.4, 1.25, 1] }}
                transition={{ duration: 2.4, delay: 0.5, times: [0, 0.55, 1], ease }}
              />
              {/* shockwave */}
              <motion.div
                className="absolute size-40 rounded-full border border-gold-bright/70"
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: [0, 0.9, 0], scale: [0.6, 3.6] }}
                transition={{ duration: 1.6, delay: 1.5, ease: "easeOut" }}
              />
              {/* the compass */}
              <motion.div
                initial={reduced ? { opacity: 0 } : { opacity: 0, scale: 0.35, rotate: -120, filter: "blur(12px)" }}
                animate={{ opacity: 1, scale: 1, rotate: 0, filter: "blur(0px)" }}
                transition={{ duration: 1.8, delay: 0.3, ease }}
                style={{ filter: "drop-shadow(0 0 30px rgba(243,213,143,0.55))" }}
              >
                <LogoMark size={176} />
              </motion.div>
            </div>

            {/* wordmark */}
            <div className="mt-8 flex font-display text-3xl font-semibold text-fg sm:text-5xl" aria-label={WORD}>
              {WORD.split("").map((c, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  transition={{ duration: 0.7, delay: 2.0 + i * 0.07, ease }}
                  className="tracking-[0.32em]"
                >
                  {c}
                </motion.span>
              ))}
            </div>

            <motion.p
              className="mt-6 font-display text-lg text-fg/90 sm:text-2xl"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 3.2, ease }}
            >
              Every token is a nation.
            </motion.p>
            <motion.p
              className="text-gold-gradient mt-1 font-display text-lg font-semibold sm:text-2xl"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 4.1, ease }}
            >
              Every nation runs on $WIF.
            </motion.p>
            <motion.p
              className="mt-8 font-mono text-[10px] uppercase tracking-[0.32em] text-dim sm:text-xs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.8, delay: 5.1 }}
            >
              Found · Trade · Govern · Conquer — Robinhood Chain
            </motion.p>
          </div>

          <motion.button
            onClick={finish}
            className="absolute bottom-8 right-6 flex items-center gap-2 rounded-lg border border-line-strong bg-black/50 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.16em] text-dim backdrop-blur hover:text-fg"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6 }}
          >
            Skip <FastForward className="size-3.5" />
          </motion.button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
