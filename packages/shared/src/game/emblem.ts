/**
 * National emblems are stored fully on-chain as a single uint256 (AtlasLaunchpad.Nation.emblem):
 *   bits   0..7   glyph id
 *   bits   8..15  flag pattern id
 *   bits  16..39  primary color   (0xRRGGBB)
 *   bits  40..63  secondary color (0xRRGGBB)
 *   bits  64..87  accent color    (0xRRGGBB)
 * Out-of-range ids wrap modulo the list length, so every uint256 renders as a valid flag.
 */

export const GLYPHS = [
  "crown", "star", "sun", "moon", "wave", "tree", "skull", "frog",
  "dog", "cat", "rocket", "gear", "eye", "flame", "bolt", "shield",
  "sword", "anchor", "diamond", "planet", "chip", "dragon", "mountain", "leaf",
] as const;
export type Glyph = (typeof GLYPHS)[number];

export const PATTERNS = [
  "solid", "horizontal", "vertical", "diagonal", "cross", "disc", "chevron", "quartered",
] as const;
export type Pattern = (typeof PATTERNS)[number];

export interface Emblem {
  glyph: Glyph;
  pattern: Pattern;
  primary: string;
  secondary: string;
  accent: string;
}

const hex = (n: bigint) => `#${n.toString(16).padStart(6, "0")}`;
const parseHex = (c: string) => BigInt(`0x${c.replace("#", "").slice(0, 6).padStart(6, "0")}`);

export function decodeEmblem(value: bigint | string | number): Emblem {
  const v = BigInt(value);
  const glyph = GLYPHS[Number(v & 0xffn) % GLYPHS.length]!;
  const pattern = PATTERNS[Number((v >> 8n) & 0xffn) % PATTERNS.length]!;
  return {
    glyph,
    pattern,
    primary: hex((v >> 16n) & 0xffffffn),
    secondary: hex((v >> 40n) & 0xffffffn),
    accent: hex((v >> 64n) & 0xffffffn),
  };
}

export function encodeEmblem(e: Emblem): bigint {
  const g = BigInt(Math.max(0, GLYPHS.indexOf(e.glyph)));
  const p = BigInt(Math.max(0, PATTERNS.indexOf(e.pattern)));
  return g | (p << 8n) | (parseHex(e.primary) << 16n) | (parseHex(e.secondary) << 40n) | (parseHex(e.accent) << 64n);
}

/** Relative luminance helper used to pick legible text over a national color. */
export function isDark(color: string): boolean {
  const n = Number(parseHex(color));
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}
