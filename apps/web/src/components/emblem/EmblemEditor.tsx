"use client";
import { GLYPHS, PATTERNS, decodeEmblem, encodeEmblem, type Emblem } from "@atlaspad/shared";
import { Flag, GLYPH_PATHS } from "./Flag";

const PALETTE = [
  "#d6b26e", "#f3d58f", "#c0392b", "#ff5a6e", "#ff9f1c", "#ffd23f", "#7cd957", "#35d29a", "#2ec4b6", "#1fb6c9",
  "#3ddcff", "#6ea8ff", "#3a5bd9", "#9d8cff", "#b388ff", "#e58bff", "#ff2e88", "#f4f1e8", "#9aa5b1", "#141820",
];

function ColorPicker({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <div className="label mb-1.5">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {PALETTE.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            className={`size-6 rounded-md border transition ${value.toLowerCase() === c ? "scale-110 border-white" : "border-white/10 hover:scale-105"}`}
            style={{ background: c }}
            aria-label={c}
          />
        ))}
        <label className="relative size-6 cursor-pointer overflow-hidden rounded-md border border-dashed border-white/30" title="Custom color">
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 size-10 -translate-x-1 -translate-y-1 cursor-pointer opacity-0" />
          <span className="grid size-full place-items-center text-[10px] text-faint">+</span>
        </label>
      </div>
    </div>
  );
}

/** Edits an on-chain emblem value (glyph, pattern, three colors) with a live flag preview. */
export function EmblemEditor({ value, onChange }: { value: bigint; onChange: (v: bigint) => void }) {
  const e = decodeEmblem(value);
  const set = (patch: Partial<Emblem>) => onChange(encodeEmblem({ ...e, ...patch }));
  return (
    <div className="grid gap-6 md:grid-cols-[220px_1fr]">
      <div className="flex flex-col items-center gap-3">
        <div className="animate-float">
          <Flag emblem={value} size={200} glow />
        </div>
        <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Stored fully on-chain</div>
      </div>
      <div className="space-y-5">
        <div>
          <div className="label mb-1.5">Symbol</div>
          <div className="grid grid-cols-8 gap-1.5">
            {GLYPHS.map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => set({ glyph: g })}
                title={g}
                className={`grid aspect-square place-items-center rounded-lg border transition ${e.glyph === g ? "border-gold/60 bg-gold/10" : "border-line hover:border-line-strong"}`}
              >
                <svg viewBox="0 0 24 24" className="size-5" fill={e.glyph === g ? "#f3d58f" : "#9aa2b5"}>
                  {GLYPH_PATHS[g]}
                </svg>
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="label mb-1.5">Pattern</div>
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
            {PATTERNS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => set({ pattern: p })}
                className={`rounded-lg border p-1 transition ${e.pattern === p ? "border-gold/60" : "border-line hover:border-line-strong"}`}
                title={p}
              >
                <Flag emblem={encodeEmblem({ ...e, pattern: p })} size={44} />
              </button>
            ))}
          </div>
        </div>
        <ColorPicker label="Primary" value={e.primary} onChange={(primary) => set({ primary })} />
        <ColorPicker label="Secondary" value={e.secondary} onChange={(secondary) => set({ secondary })} />
        <ColorPicker label="Accent" value={e.accent} onChange={(accent) => set({ accent })} />
      </div>
    </div>
  );
}
