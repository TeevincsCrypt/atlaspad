"use client";
import { useMemo } from "react";
import { motion } from "motion/react";
import { BuildingType, decodeEmblem, TIERS, type NationSummary } from "@atlaspad/shared";
import { GLYPH_PATHS } from "../emblem/Flag";
import { useNow } from "@/lib/hooks";

function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * The nation's capital, generated from its real state: tier sets the skyline's size, buildings add landmarks,
 * trading activity lights windows, and statuses change the sky.
 */
export function CapitalView({ nation }: { nation: NationSummary }) {
  const e = decodeEmblem(nation.emblem);
  const now = useNow();
  const status = nation.statuses.find((s) => s.until > now)?.type ?? null;
  const golden = status === "GOLDEN_AGE";
  const crisis = status === "ECONOMIC_CRISIS" || status === "NATIONAL_EMERGENCY";
  const has = (b: BuildingType) => nation.buildings.includes(b);
  const activity = Math.min(1, Math.log10(1 + nation.trades24h) / 2);

  const towers = useMemo(() => {
    const r = rng(nation.id * 7919 + 17);
    const count = 6 + nation.tier * 6;
    const maxH = 60 + nation.tier * 38;
    const list: { x: number; w: number; h: number; windows: { x: number; y: number; lit: boolean; d: number }[] }[] = [];
    for (let i = 0; i < count; i++) {
      const w = 16 + r() * 22;
      const x = 40 + (i / count) * 720 + (r() - 0.5) * 20;
      const center = 1 - Math.abs(x - 400) / 420;
      const h = 24 + r() * maxH * (0.4 + center * 0.8);
      const windows = [];
      for (let wy = 8; wy < h - 6; wy += 9) {
        for (let wx = 4; wx < w - 4; wx += 7) {
          windows.push({ x: x + wx, y: 300 - h + wy, lit: r() < 0.18 + activity * 0.55, d: r() * 4 });
        }
      }
      list.push({ x, w, h, windows });
    }
    return list.sort((a, b) => b.h - a.h);
  }, [nation.id, nation.tier, activity]);

  const stars = useMemo(() => {
    const r = rng(nation.id * 31 + 5);
    return Array.from({ length: 40 }, () => ({ x: r() * 800, y: r() * 150, s: r() * 1.2 + 0.3, d: r() * 3 }));
  }, [nation.id]);

  const sky = golden ? ["#2a1e05", "#0b0904"] : crisis ? ["#2a070c", "#08040a"] : ["#0b1122", "#05070d"];

  return (
    <div className="relative overflow-hidden rounded-xl border border-line">
      <svg viewBox="0 0 800 340" className="block w-full" role="img" aria-label={`Capital of ${nation.name}`}>
        <defs>
          <linearGradient id={`sky-${nation.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={sky[1]} />
            <stop offset="1" stopColor={sky[0]} />
          </linearGradient>
          <radialGradient id={`glow-${nation.id}`} cx="0.5" cy="1" r="0.7">
            <stop offset="0" stopColor={golden ? "#f3d58f" : crisis ? "#ff3b4e" : e.primary} stopOpacity={golden ? 0.45 : 0.25} />
            <stop offset="1" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <linearGradient id={`tower-${nation.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1d2435" />
            <stop offset="1" stopColor="#0c1019" />
          </linearGradient>
        </defs>
        <rect width="800" height="340" fill={`url(#sky-${nation.id})`} />
        {stars.map((s, i) => (
          <circle key={i} cx={s.x} cy={s.y} r={s.s} fill="#dfe6ff" className="animate-twinkle" style={{ animationDelay: `${s.d}s` }} />
        ))}
        <rect width="800" height="340" fill={`url(#glow-${nation.id})`} />

        {crisis && (
          <g opacity="0.85">
            {[120, 320, 560].map((x, i) => (
              <motion.ellipse key={x} cx={x} cy={60 + i * 12} rx="150" ry="34" fill="#160a10" animate={{ x: [0, 30, 0] }} transition={{ duration: 9 + i, repeat: Infinity }} />
            ))}
            {Array.from({ length: 40 }, (_, i) => (
              <motion.line
                key={i}
                x1={(i * 53) % 800}
                y1={0}
                x2={(i * 53) % 800 - 8}
                y2={18}
                stroke="#6b7a99"
                strokeOpacity="0.35"
                animate={{ y: [60, 320] }}
                transition={{ duration: 0.9, repeat: Infinity, delay: (i % 9) * 0.1, ease: "linear" }}
              />
            ))}
          </g>
        )}

        {/* Skyline */}
        {towers.map((t, i) => (
          <g key={i}>
            <rect x={t.x} y={300 - t.h} width={t.w} height={t.h} fill={`url(#tower-${nation.id})`} stroke="#ffffff" strokeOpacity="0.04" />
            {t.windows.map((w, j) =>
              w.lit ? (
                <rect
                  key={j}
                  x={w.x}
                  y={w.y}
                  width="3"
                  height="4"
                  fill={golden ? "#ffd27a" : crisis ? (j % 7 === 0 ? "#ff5a6e" : "#4a4f5c") : "#ffe2a8"}
                  opacity={crisis ? 0.5 : 0.85}
                  className={crisis || j % 5 === 0 ? "animate-twinkle" : undefined}
                  style={{ animationDelay: `${w.d}s` }}
                />
              ) : null,
            )}
          </g>
        ))}

        {/* Landmarks for completed buildings */}
        {has(BuildingType.Monument) && (
          <g>
            <path d="M120 300 L128 170 L136 300 Z" fill="#2a3245" stroke={e.primary} strokeOpacity="0.6" />
            <circle cx="128" cy="168" r="3" fill="#ffd27a" className="animate-twinkle" />
          </g>
        )}
        {has(BuildingType.Stadium) && <ellipse cx="640" cy="292" rx="58" ry="14" fill="#151b29" stroke={e.primary} strokeOpacity="0.5" />}
        {has(BuildingType.Factory) && (
          <g>
            <rect x="690" y="250" width="44" height="50" fill="#151b29" />
            <rect x="718" y="214" width="8" height="40" fill="#1d2435" />
            <motion.circle cx="722" cy="206" r="8" fill="#5f6880" opacity="0.4" animate={{ cy: [206, 160], opacity: [0.4, 0], r: [6, 18] }} transition={{ duration: 4, repeat: Infinity }} />
          </g>
        )}
        {has(BuildingType.Port) && (
          <g>
            <rect x="0" y="300" width="800" height="40" fill="#071322" />
            <path d="M40 300 L40 236 L96 236" stroke="#3a4560" strokeWidth="3" fill="none" />
            <line x1="96" y1="236" x2="96" y2="262" stroke="#3a4560" strokeWidth="1.5" />
          </g>
        )}
        {has(BuildingType.Spaceport) && (
          <g>
            <path d="M560 300 L560 196 Q566 176 572 196 L572 300 Z" fill="#cfd6e6" />
            <motion.path d="M562 300 Q566 330 570 300" fill="#ffb547" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.6, repeat: Infinity }} />
          </g>
        )}
        {has(BuildingType.University) && <path d="M210 300 v-34 h56 v34 M206 266 l32 -16 l32 16 z" fill="#1a2132" stroke="#ffffff" strokeOpacity="0.06" />}
        {has(BuildingType.Bank) && <path d="M480 300 v-30 h46 v30 M476 270 h54 l-27 -14 z" fill="#1a2132" stroke={e.secondary} strokeOpacity="0.4" />}

        {/* Capitol with the national flag */}
        <g>
          {has(BuildingType.Capitol) ? (
            <>
              <rect x="360" y="246" width="80" height="54" fill="#1b2232" stroke="#ffffff" strokeOpacity="0.08" />
              <path d="M370 246 Q400 206 430 246 Z" fill="#232b3f" stroke={e.primary} strokeOpacity="0.7" />
              {[372, 386, 400, 414, 428].map((x) => (
                <rect key={x} x={x - 2} y="256" width="4" height="40" fill="#2b3550" />
              ))}
            </>
          ) : (
            <path d="M380 300 v-26 l20 -14 l20 14 v26 z" fill="#1b2232" />
          )}
          <line x1="400" y1={has(BuildingType.Capitol) ? 210 : 260} x2="400" y2={has(BuildingType.Capitol) ? 170 : 222} stroke="#9aa2b5" strokeWidth="1.5" />
          <motion.g
            style={{ originX: "400px" }}
            animate={{ skewY: [0, -4, 0, 3, 0] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
          >
            <rect x="401" y={has(BuildingType.Capitol) ? 170 : 222} width="30" height="20" fill={e.primary} />
            <svg x="410" y={has(BuildingType.Capitol) ? 174 : 226} width="12" height="12" viewBox="0 0 24 24" fill={e.secondary}>
              {GLYPH_PATHS[e.glyph]}
            </svg>
          </motion.g>
        </g>

        <rect y="300" width="800" height="40" fill="#05070d" opacity={has(BuildingType.Port) ? 0.4 : 1} />
        <line x1="0" y1="300" x2="800" y2="300" stroke={e.primary} strokeOpacity="0.35" />

        {golden &&
          [180, 400, 620].map((x, i) => (
            <motion.g key={x} initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0] }} transition={{ duration: 2.2, repeat: Infinity, delay: i * 0.7 }}>
              {Array.from({ length: 12 }, (_, k) => (
                <line key={k} x1={x} y1={90} x2={x + Math.cos((k / 12) * Math.PI * 2) * 34} y2={90 + Math.sin((k / 12) * Math.PI * 2) * 34} stroke="#f3d58f" strokeWidth="1.5" />
              ))}
            </motion.g>
          ))}
      </svg>
      <div className="pointer-events-none absolute left-3 top-3 flex gap-2">
        <span className="rounded-md border border-line-strong bg-black/50 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] text-dim backdrop-blur">
          {TIERS[nation.tier]?.name ?? "Settlement"} capital
        </span>
        {status && (
          <span className={`rounded-md border px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] backdrop-blur ${golden ? "border-gold/50 bg-gold/15 text-gold-bright" : crisis ? "border-down/50 bg-down/15 text-down" : "border-line-strong bg-black/50 text-dim"}`}>
            {status.replaceAll("_", " ")}
          </span>
        )}
      </div>
    </div>
  );
}
