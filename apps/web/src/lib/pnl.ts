/** Shared formatting for PnL cards (used by the image route and the UI). */
export function formatPnlPct(p: number): string {
  const v = Math.round(p * 100);
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toLocaleString("en-US")}%`;
}

export function pnlTagline(p: number | null): string {
  if (p === null) return "Straight from the founder's vault.";
  if (p >= 10) return "Generational wealth? Probably.";
  if (p >= 1) return "Was it life-changing $WIF? Maybe…";
  if (p >= 0.2) return "The nation salutes you.";
  if (p >= 0) return "A win is a win.";
  if (p > -0.3) return "Tactical retreat.";
  return "The nation remembers your sacrifice.";
}

export function formatHeld(sec: number | null): string {
  if (sec === null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return sec % 60 ? `${m}min ${sec % 60}s` : `${m}min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}min`;
  return `${Math.floor(h / 24)} days`;
}

/** Prices like 0.0000710 → "0.0000710", large ones with separators. */
export function formatPrice(p: number | null): string {
  if (p === null || !Number.isFinite(p)) return "—";
  if (p >= 1) return p.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return p.toPrecision(3);
}
