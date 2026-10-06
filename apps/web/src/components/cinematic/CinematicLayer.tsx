"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { AnimatePresence, motion } from "motion/react";
import { ACHIEVEMENT_BY_CODE, type AchievementDTO } from "@atlaspad/shared";
import { useCitizen, useWorld } from "@/lib/api";
import { effects } from "@/lib/effects";
import { playSound } from "@/lib/sound";
import { useUi } from "@/lib/store";
import { Flag } from "../emblem/Flag";

const THEMES: Record<string, { from: string; accent: string; label: string }> = {
  GOLDEN_AGE: { from: "rgba(243,213,143,0.28)", accent: "#f3d58f", label: "Golden Age" },
  ECONOMIC_CRISIS: { from: "rgba(255,59,78,0.22)", accent: "#ff5a6e", label: "Economic Crisis" },
  WAR_DECLARED: { from: "rgba(255,59,78,0.26)", accent: "#ff3b4e", label: "War" },
  WAR_ENDED: { from: "rgba(214,178,110,0.22)", accent: "#e8c47a", label: "Victory" },
};

function Confetti() {
  const pieces = useMemo(
    () =>
      Array.from({ length: 70 }, (_, i) => ({
        left: (i * 37) % 100,
        delay: (i % 10) * 0.08,
        dur: 2.2 + ((i * 13) % 10) / 10,
        rot: (i * 47) % 360,
        color: ["#f3d58f", "#ffe9b8", "#d6b26e", "#fff6dc", "#c79e52"][i % 5],
      })),
    [],
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute top-0 block h-2.5 w-1.5 rounded-[1px]"
          style={{ left: `${p.left}%`, background: p.color }}
          initial={{ y: -20, rotate: p.rot, opacity: 0 }}
          animate={{ y: "105vh", rotate: p.rot + 540, opacity: [0, 1, 1, 0] }}
          transition={{ duration: p.dur, delay: p.delay, ease: "easeIn" }}
        />
      ))}
    </div>
  );
}

/** Full-screen banner for a major world event. */
function CinematicBanner({ c, compact }: { c: { type: string; nationId: number; targetId?: number | null; title: string; body: string }; compact: boolean }) {
  const world = useWorld();
  const theme = THEMES[c.type] ?? THEMES.GOLDEN_AGE!;
  const a = world.data?.nations.find((n) => n.id === c.nationId);
  const b = c.targetId ? world.data?.nations.find((n) => n.id === c.targetId) : undefined;
  const isWar = c.type === "WAR_DECLARED" || c.type === "WAR_ENDED";
  if (compact) {
    return (
      <motion.div
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -30, opacity: 0 }}
        className="pointer-events-none fixed inset-x-0 top-16 z-[70] flex justify-center px-4"
      >
        <div className="panel flex max-w-xl items-center gap-3 px-4 py-2.5" style={{ boxShadow: `0 0 40px -10px ${theme.accent}` }}>
          {a && <Flag emblem={a.emblem} size={30} />}
          <div className="min-w-0">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em]" style={{ color: theme.accent }}>
              {theme.label}
            </div>
            <div className="truncate text-sm text-fg">{c.title}</div>
          </div>
        </div>
      </motion.div>
    );
  }
  return (
    <motion.div className="pointer-events-none fixed inset-0 z-[70]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.6 }}>
      <div className="absolute inset-0" style={{ background: `radial-gradient(ellipse at center, ${theme.from}, transparent 60%)` }} />
      {c.type === "GOLDEN_AGE" && <Confetti />}
      {c.type === "ECONOMIC_CRISIS" && (
        <motion.div
          className="absolute inset-0 bg-[repeating-linear-gradient(115deg,rgba(255,60,80,0.05)_0_2px,transparent_2px_14px)]"
          animate={{ opacity: [0.2, 0.7, 0.3, 0.8, 0.2] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        />
      )}
      <div className="absolute inset-x-0 top-[30%] flex flex-col items-center px-6 text-center">
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="mb-6 h-px w-[min(640px,80vw)]"
          style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)` }}
        />
        {isWar && a && b ? (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="mb-4 flex items-center gap-5">
            <Flag emblem={a.emblem} size={64} glow />
            <span className="font-display text-2xl text-war">⚔</span>
            <Flag emblem={b.emblem} size={64} glow />
          </motion.div>
        ) : (
          a && (
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.3 }} className="mb-4">
              <Flag emblem={a.emblem} size={72} glow />
            </motion.div>
          )
        )}
        <motion.div
          initial={{ opacity: 0, letterSpacing: "0.6em" }}
          animate={{ opacity: 1, letterSpacing: "0.32em" }}
          transition={{ duration: 1.1, delay: 0.35 }}
          className="font-mono text-[11px] uppercase"
          style={{ color: theme.accent }}
        >
          {theme.label}
        </motion.div>
        <motion.h2
          initial={{ opacity: 0, y: 14, filter: "blur(8px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          transition={{ duration: 0.9, delay: 0.5 }}
          className="mt-3 max-w-4xl font-display text-2xl font-semibold uppercase leading-tight tracking-wide text-fg sm:text-4xl"
          style={{ textShadow: `0 0 40px ${theme.accent}66` }}
        >
          {c.title.replace(/^\S+\s/, "")}
        </motion.h2>
        {c.body && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="mt-3 max-w-xl text-sm text-dim">
            {c.body}
          </motion.p>
        )}
        <motion.div
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.9, delay: 0.2, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 h-px w-[min(640px,80vw)]"
          style={{ background: `linear-gradient(90deg, transparent, ${theme.accent}, transparent)` }}
        />
      </div>
    </motion.div>
  );
}

/** Dramatic unlock for the connected citizen's newly earned achievements. */
function AchievementUnlocks() {
  const { address } = useAccount();
  const citizen = useCitizen(address);
  const seen = useUi((s) => s.seenAchievements);
  const markSeen = useUi((s) => s.markAchievementsSeen);
  const [current, setCurrent] = useState<AchievementDTO | null>(null);

  useEffect(() => {
    const list = citizen.data?.profile.achievements;
    if (!list || !address || current) return;
    const key = (a: AchievementDTO) => `${address.toLowerCase()}:${a.code}`;
    const unseen = list.filter((a) => !seen.includes(key(a)));
    if (!unseen.length) return;
    const recent = unseen.filter((a) => Date.now() / 1000 - a.unlockedAt < 86400);
    const stale = unseen.filter((a) => !recent.includes(a));
    if (stale.length) markSeen(stale.map(key));
    const next = recent[0];
    if (next) {
      setCurrent(next);
      playSound("achievement");
      markSeen([key(next)]);
    }
  }, [citizen.data, address, seen, markSeen, current]);

  useEffect(() => {
    if (!current) return;
    const t = setTimeout(() => setCurrent(null), 4200);
    return () => clearTimeout(t);
  }, [current]);

  const def = current ? ACHIEVEMENT_BY_CODE[current.code] : null;
  return (
    <AnimatePresence>
      {current && def && (
        <motion.div className="fixed inset-0 z-[75] grid place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setCurrent(null)}>
          <div className="absolute inset-0 bg-black/60 backdrop-blur-[2px]" />
          <motion.div
            className="relative flex flex-col items-center text-center"
            initial={{ scale: 0.6, rotateY: 90 }}
            animate={{ scale: 1, rotateY: 0 }}
            transition={{ type: "spring", stiffness: 160, damping: 14 }}
          >
            <motion.div
              className="absolute -inset-24 rounded-full"
              style={{ background: "conic-gradient(from 0deg, transparent, rgba(243,213,143,0.35), transparent 30%, rgba(243,213,143,0.25), transparent 60%)" }}
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
            />
            <div className="panel glow-gold relative flex w-72 flex-col items-center gap-3 px-6 py-8">
              <div className="label text-gold">Achievement unlocked</div>
              <motion.div className="text-6xl" initial={{ scale: 0 }} animate={{ scale: [0, 1.3, 1] }} transition={{ delay: 0.25, duration: 0.6 }}>
                {def.icon}
              </motion.div>
              <div className="font-display text-lg font-semibold text-gold-gradient text-gold-bright">{def.name}</div>
              <div className="text-xs text-dim">{def.description}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-faint">{def.rarity} · +100 XP</div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function CinematicLayer() {
  const path = usePathname();
  const active = useUi((s) => s.activeCinematic);
  const cinematicsOn = useUi((s) => s.cinematicsOn);
  const [compact, setCompact] = useState<{ type: string; nationId: number; targetId?: number | null; title: string; body: string } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Off the map, major events appear as a compact banner instead of moving the camera.
  useEffect(
    () =>
      effects.on((e) => {
        if (e.kind !== "cinematic" || path.startsWith("/world") || !cinematicsOn) return;
        setCompact({ type: e.type, nationId: e.nationId, targetId: e.targetId, title: e.title, body: e.body });
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCompact(null), 5500);
      }),
    [path, cinematicsOn],
  );

  return (
    <>
      <AnimatePresence>{active && path.startsWith("/world") && <CinematicBanner key={`${active.type}-${active.nationId}`} c={active} compact={false} />}</AnimatePresence>
      <AnimatePresence>{compact && <CinematicBanner key={`c-${compact.title}`} c={compact} compact />}</AnimatePresence>
      <AchievementUnlocks />
    </>
  );
}
