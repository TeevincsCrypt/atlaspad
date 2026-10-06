"use client";
import { memo, useId } from "react";
import { decodeEmblem, type Emblem, type Glyph } from "@atlaspad/shared";

/** 24×24 glyph artwork. Drawn with `currentColor` so the flag decides the color. */
export const GLYPH_PATHS: Record<Glyph, React.ReactNode> = {
  crown: <path d="M3 17.5 5 7.5l4.5 4.5L12 5l2.5 7L19 7.5l2 10H3Zm0 1.5h18v2H3z" />,
  star: <path d="m12 2.8 2.7 5.9 6.4.7-4.8 4.3 1.4 6.3L12 16.8 6.3 20l1.4-6.3-4.8-4.3 6.4-.7z" />,
  sun: (
    <g>
      <circle cx="12" cy="12" r="4.6" />
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x="11.2" y="1.6" width="1.6" height="4" rx=".8" transform={`rotate(${i * 45} 12 12)`} />
      ))}
    </g>
  ),
  moon: <path d="M15.5 3.2A9 9 0 1 0 20.8 15 7.2 7.2 0 0 1 15.5 3.2Z" />,
  wave: <path d="M2 9c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2v3c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2Zm0 6c2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2v3c-2.5 0-2.5-2-5-2s-2.5 2-5 2-2.5-2-5-2-2.5 2-5 2Z" />,
  tree: <path d="M12 2 6 10h3l-4 6h5.5v6h3v-6H19l-4-6h3Z" />,
  skull: <path d="M12 2.5c-4.7 0-8 3.2-8 7.6 0 2.6 1.2 4.4 3 5.6V19h2v2h2v-2h2v2h2v-2h2v-3.3c1.8-1.2 3-3 3-5.6 0-4.4-3.3-7.6-8-7.6ZM8.5 9.5a2 2 0 1 1 0 4 2 2 0 0 1 0-4Zm7 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4ZM12 14l1.2 2h-2.4Z" />,
  frog: <path d="M7 4a3 3 0 0 0-3 3c0 .6.2 1.2.5 1.7A8 8 0 0 0 2 14.5C2 18.6 6.5 21 12 21s10-2.4 10-6.5a8 8 0 0 0-2.5-5.8c.3-.5.5-1.1.5-1.7a3 3 0 0 0-5.4-1.8 9 9 0 0 0-5.2 0A3 3 0 0 0 7 4Zm0 2a1 1 0 1 1 0 2 1 1 0 0 1 0-2Zm10 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2ZM6 14c1.5 1.6 3.6 2.4 6 2.4s4.5-.8 6-2.4l1 1.2c-1.8 2-4.3 3-7 3s-5.2-1-7-3Z" />,
  dog: <path d="M5 3 3 10c0 1.2.6 2.2 1.5 2.8L5 17c0 2.8 3.1 5 7 5s7-2.2 7-5l.5-4.2c.9-.6 1.5-1.6 1.5-2.8l-2-7-4 3.2a8.5 8.5 0 0 0-6 0Zm4.5 8a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6Zm5 0a1.3 1.3 0 1 1 0 2.6 1.3 1.3 0 0 1 0-2.6ZM12 15.5c1 0 2 .6 2 1.3s-1 1.7-2 1.7-2-1-2-1.7.9-1.3 2-1.3Z" />,
  cat: <path d="M4 2.5 5.2 10A8 8 0 0 0 4 14.5C4 18.6 7.6 21.5 12 21.5s8-2.9 8-7a8 8 0 0 0-1.2-4.5L20 2.5l-5.2 4a9 9 0 0 0-5.6 0ZM9 12a1.4 1.4 0 1 1 0 2.8A1.4 1.4 0 0 1 9 12Zm6 0a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8Zm-3 4 1.3 1.4h-2.6Z" />,
  rocket: <path d="M12 1.5c3.3 2.4 5 6 5 10.2 0 1.6-.3 3.1-.7 4.3H7.7c-.4-1.2-.7-2.7-.7-4.3C7 7.5 8.7 3.9 12 1.5Zm0 6.2a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2ZM7 13.5 3.5 17v3.5L8 18Zm10 0 3.5 3.5v3.5L16 18ZM9.5 17.5h5L12 22.5Z" />,
  gear: <path d="m10.3 2 .6 2.6a7.5 7.5 0 0 1 2.2 0l.6-2.6 2.5 1-.9 2.5c.6.5 1.2 1 1.6 1.6l2.5-.9 1 2.5-2.6.6a7.5 7.5 0 0 1 0 2.2l2.6.6-1 2.5-2.5-.9c-.4.6-1 1.2-1.6 1.6l.9 2.5-2.5 1-.6-2.6a7.5 7.5 0 0 1-2.2 0l-.6 2.6-2.5-1 .9-2.5c-.6-.4-1.2-1-1.6-1.6l-2.5.9-1-2.5 2.6-.6a7.5 7.5 0 0 1 0-2.2L2.1 9.7l1-2.5 2.5.9c.4-.6 1-1.1 1.6-1.6l-.9-2.5ZM12 8.4a3.6 3.6 0 1 0 0 7.2 3.6 3.6 0 0 0 0-7.2Z" />,
  eye: <path d="M12 5C6.5 5 2.7 9.1 1.5 12c1.2 2.9 5 7 10.5 7s9.3-4.1 10.5-7C21.3 9.1 17.5 5 12 5Zm0 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 2.3a1.7 1.7 0 1 0 0 3.4 1.7 1.7 0 0 0 0-3.4Z" />,
  flame: <path d="M12.5 1.5c.6 3.4-1.1 5.2-2.9 7.1C7.8 10.4 6 12.4 6 15.3 6 19 8.7 22 12 22s6-3 6-6.7c0-2.4-1-4.1-2.3-5.6-.1 1.5-.7 2.7-1.9 3.4.6-4.6-.5-8.6-1.3-11.6Zm-.7 12.8c1.5 1.4 2.7 2.6 2.7 4.3 0 1.4-1.1 2.4-2.5 2.4s-2.5-1-2.5-2.4c0-1.6 1.2-2.7 2.3-4.3Z" />,
  bolt: <path d="M13.5 1.5 4 14h6.5L9 22.5 20 9h-6.8Z" />,
  shield: <path d="M12 1.8 3.5 5v6.2c0 5.3 3.6 9.6 8.5 11 4.9-1.4 8.5-5.7 8.5-11V5Zm0 3.2 5.5 2.1v4.1c0 3.7-2.3 6.8-5.5 8.1Z" />,
  sword: <path d="M19.5 2 21 3.5 11.8 14.5l1.4 1.4-1.4 1.4-1.6-1.6-3.9 3.9.9.9-1.4 1.4-3.6-3.6 1.4-1.4.9.9 3.9-3.9-1.6-1.6 1.4-1.4 1.4 1.4Z" />,
  anchor: <path d="M12 1.8a2.8 2.8 0 0 0-1 5.4V9H8v2h3v8.4c-2.9-.4-5.2-2.6-5.8-5.4H7.5L4.5 10l-3 4h1.9c.7 4.5 4.3 7.7 8.6 7.7s7.9-3.2 8.6-7.7h1.9l-3-4-3 4h2.3c-.6 2.8-2.9 5-5.8 5.4V11h3V9h-3V7.2a2.8 2.8 0 0 0-1-5.4Zm0 1.8a1 1 0 1 1 0 2 1 1 0 0 1 0-2Z" />,
  diamond: <path d="M6.5 3h11l4.5 6-10 12.5L2 9Zm1 2-2.6 3.5h4.3L8 5Zm9 0-1.2 3.5h4.3ZM10 5l1 3.5h2L14 5Zm-5.4 5.5 6.2 7.7-2.6-7.7Zm5.6 0L12 16l1.8-5.5Zm5.4 0-2.6 7.7 6.2-7.7Z" />,
  planet: <path d="M12 5.5a6.5 6.5 0 0 0-6.4 5.4C2.9 12.8 1.6 14.4 2.1 15.5c.6 1.4 4.1 1.1 8.4-.6 4.3-1.8 7.3-4.1 6.8-5.5a6.5 6.5 0 0 0-5.3-3.9Zm6.3 5.8c-1.1 1.3-3.1 2.7-5.5 3.7-2.3 1-4.6 1.5-6.2 1.4A6.5 6.5 0 0 0 18.3 11.3Zm1.6-3c1.6.4 2.6 1 2.9 1.7.4.9-.3 2.1-1.8 3.4l-.1-.2a7.6 7.6 0 0 0-1-4.9Z" />,
  chip: <path d="M8 2h2v2h4V2h2v2h1.5A2.5 2.5 0 0 1 20 6.5V8h2v2h-2v4h2v2h-2v1.5a2.5 2.5 0 0 1-2.5 2.5H16v2h-2v-2h-4v2H8v-2H6.5A2.5 2.5 0 0 1 4 17.5V16H2v-2h2v-4H2V8h2V6.5A2.5 2.5 0 0 1 6.5 4H8Zm0 6v8h8V8Zm2 2h4v4h-4Z" />,
  dragon: <path d="M3 4c3.5 0 6 1.4 7.5 3.6L14 5.5l-.5 3.2 4-1.2-1.8 3.2 4.3.3-3.6 2.4 2.6 3.1-4.1-.3.4 4.3-3.1-2.8L10 21l-.4-4.3-3.9 1.8 1.7-3.8L3 14.1l3.7-1.6C4.6 11 3.2 8.5 3 4Zm9.3 5.8a.9.9 0 1 0 0 1.8.9.9 0 0 0 0-1.8Z" />,
  mountain: <path d="M8.5 5 1.5 19.5h21L16 9l-2.6 3.8Zm0 3.6 1.6 3.2-1.4 1-1.2-1.1-1.2 1.2Z" />,
  leaf: <path d="M20.5 3C9.5 3.4 4 8.6 4 15c0 1.6.4 3 1.1 4.2L3 21.3l1.4 1.4 2.1-2.1c1.2.7 2.6 1.1 4.2 1.1 6.4 0 11.6-5.5 12-16.5Zm-4.2 4.3L8 15.6l-1-1Z" />,
};

function Pattern({ e, id }: { e: Emblem; id: string }) {
  const { primary: p, secondary: s, accent: a } = e;
  switch (e.pattern) {
    case "solid":
      return <rect width="60" height="40" fill={p} />;
    case "horizontal":
      return (
        <g>
          <rect width="60" height="40" fill={p} />
          <rect y="13.33" width="60" height="13.34" fill={s} />
          <rect y="26.67" width="60" height="13.33" fill={a} />
        </g>
      );
    case "vertical":
      return (
        <g>
          <rect width="60" height="40" fill={p} />
          <rect x="20" width="20" height="40" fill={s} />
          <rect x="40" width="20" height="40" fill={a} />
        </g>
      );
    case "diagonal":
      return (
        <g>
          <rect width="60" height="40" fill={p} />
          <path d="M0 40 60 0v40Z" fill={s} />
          <path d="M-4 40 60 -2.5v6L4 40Z" fill={a} />
        </g>
      );
    case "cross":
      return (
        <g>
          <rect width="60" height="40" fill={p} />
          <rect x="16" width="9" height="40" fill={s} />
          <rect y="15.5" width="60" height="9" fill={s} />
          <rect x="18.5" width="4" height="40" fill={a} />
          <rect y="18" width="60" height="4" fill={a} />
        </g>
      );
    case "disc":
      return (
        <g>
          <rect width="60" height="40" fill={p} />
          <circle cx="30" cy="20" r="13" fill={s} />
        </g>
      );
    case "chevron":
      return (
        <g>
          <rect width="60" height="40" fill={p} />
          <rect y="20" width="60" height="20" fill={s} />
          <path d="M0 0 26 20 0 40Z" fill={a} />
        </g>
      );
    case "quartered":
      return (
        <g>
          <rect width="60" height="40" fill={p} />
          <rect x="30" width="30" height="20" fill={s} />
          <rect y="20" width="30" height="20" fill={s} />
          <clipPath id={`${id}-q`}>
            <rect width="60" height="40" />
          </clipPath>
        </g>
      );
  }
}

function glyphPlacement(e: Emblem): { x: number; y: number; size: number; color: string } {
  switch (e.pattern) {
    case "chevron":
      return { x: 3, y: 12, size: 16, color: e.primary };
    case "disc":
      return { x: 20, y: 10, size: 20, color: e.primary };
    case "cross":
      return { x: 36, y: 6, size: 14, color: e.secondary };
    case "quartered":
      return { x: 21, y: 11, size: 18, color: e.accent };
    default:
      return { x: 20, y: 10, size: 20, color: e.pattern === "solid" ? e.secondary : e.accent === e.secondary ? e.primary : e.accent };
  }
}

export interface FlagProps {
  emblem: string | bigint;
  size?: number;
  className?: string;
  rounded?: boolean;
  glow?: boolean;
  title?: string;
}

/** A nation's flag, rendered entirely from its on-chain emblem value. */
export const Flag = memo(function Flag({ emblem, size = 36, className = "", rounded = true, glow = false, title }: FlagProps) {
  const id = useId().replace(/:/g, "");
  const e = decodeEmblem(emblem);
  const g = glyphPlacement(e);
  return (
    <svg
      viewBox="0 0 60 40"
      width={size}
      height={(size * 2) / 3}
      className={`${rounded ? "rounded-[3px]" : ""} shrink-0 ${className}`}
      style={glow ? { filter: `drop-shadow(0 0 8px ${e.primary}88)` } : undefined}
      role="img"
      aria-label={title ?? "National flag"}
    >
      <defs>
        <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.18" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      <Pattern e={e} id={id} />
      <svg x={g.x} y={g.y} width={g.size} height={g.size} viewBox="0 0 24 24" fill={g.color} style={{ color: g.color }}>
        {GLYPH_PATHS[e.glyph]}
      </svg>
      <rect width="60" height="40" fill={`url(#${id}-sheen)`} />
      <rect x=".5" y=".5" width="59" height="39" fill="none" stroke="#fff" strokeOpacity="0.12" rx={rounded ? 2.5 : 0} />
    </svg>
  );
});

/** Just the glyph, tinted with the nation's primary color (for compact UI). */
export function Glyph({ emblem, size = 18, className = "" }: { emblem: string; size?: number; className?: string }) {
  const e = decodeEmblem(emblem);
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill={e.primary} className={className} aria-hidden>
      {GLYPH_PATHS[e.glyph]}
    </svg>
  );
}

export function nationColor(emblem: string): string {
  return decodeEmblem(emblem).primary;
}
