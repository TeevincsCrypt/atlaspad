import { TIERS, formatCompact, formatWif, type FlywheelStats, type NationSummary } from "@atlaspad/shared";

/** Telegram HTML needs only &, < and > escaped. */
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Post {
  text: string;
  /** Image URL to send with the message (Telegram fetches it); falls back to a text message if that fails. */
  photo?: string;
  buttons?: { text: string; url: string }[];
}

/** The game events worth announcing in a public channel. */
export const ANNOUNCE_TYPES = [
  "FOUNDED",
  "GRADUATED",
  "GOLDEN_AGE",
  "ECONOMIC_BOOM",
  "WAR_DECLARED",
  "WAR_ENDED",
  "ALLIANCE_FORMED",
  "FOREIGN_INVESTMENT",
  "POPULATION_EXPLOSION",
  "CITIZEN_MILESTONE",
  "MCAP_MILESTONE",
] as const;

const ICON: Record<string, string> = {
  FOUNDED: "🏳️",
  GRADUATED: "🎓",
  GOLDEN_AGE: "👑",
  ECONOMIC_BOOM: "🚀",
  WAR_DECLARED: "⚔️",
  WAR_ENDED: "🏆",
  ALLIANCE_FORMED: "🤝",
  FOREIGN_INVESTMENT: "🐋",
  POPULATION_EXPLOSION: "👥",
  CITIZEN_MILESTONE: "👥",
  MCAP_MILESTONE: "💰",
};
const HEADLINE: Record<string, string> = {
  FOUNDED: "New nation founded",
  GRADUATED: "Graduated to Uniswap · LP burned",
  GOLDEN_AGE: "Golden Age",
  ECONOMIC_BOOM: "Economic boom",
  WAR_DECLARED: "War declared",
  WAR_ENDED: "War over",
  ALLIANCE_FORMED: "Alliance formed",
  FOREIGN_INVESTMENT: "Whale alert",
  POPULATION_EXPLOSION: "Population explosion",
  CITIZEN_MILESTONE: "Citizen milestone",
  MCAP_MILESTONE: "Market cap milestone",
};
const STAGE_ICON = ["🏕️", "🏘️", "🏙️", "🌆", "👑"];

export const nationUrl = (site: string, id: number) => `${site}/nation/${id}`;
export const cardUrl = (site: string, id: number) => `${site}/nation/${id}/opengraph-image?t=${Math.floor(Date.now() / 60000)}`;

export function nationStats(n: NationSummary): string {
  return `💰 ${esc(formatWif(n.marketCapWif))} mcap · 👥 ${n.citizens.toLocaleString("en-US")} citizens · ${STAGE_ICON[n.tier] ?? ""} ${TIERS[n.tier]?.name ?? ""}`;
}

export function eventPost(site: string, e: { type: string; title: string; body: string; nationId: number | null }, n: NationSummary | null): Post {
  const head = `${ICON[e.type] ?? "📣"} <b>${esc(HEADLINE[e.type] ?? e.title)}</b>`;
  const lines = [head, "", esc(e.body)];
  if (n) lines.push("", `<b>${esc(n.name)}</b> ($${esc(n.ticker)})`, nationStats(n));
  if (e.type === "FOUNDED" && n) lines.push("", `Buy with $WIF and become a citizen 👇`);
  const big = e.type === "FOUNDED" || e.type === "GRADUATED" || e.type === "GOLDEN_AGE";
  return {
    text: lines.join("\n"),
    photo: n && big ? cardUrl(site, n.id) : undefined,
    buttons: n ? [{ text: e.type === "FOUNDED" ? `Buy $${n.ticker}` : `Open ${n.name}`, url: nationUrl(site, n.id) }] : undefined,
  };
}

export function stagePost(site: string, n: NationSummary): Post {
  const tier = TIERS[n.tier];
  const next = TIERS[n.tier + 1];
  const lines = [
    `${STAGE_ICON[n.tier] ?? "⬆️"} <b>${esc(n.name)} is now ${n.tier === 4 ? "an" : "a"} ${esc(tier?.name ?? "")}!</b>`,
    "",
    nationStats(n),
    next ? `Next: ${esc(next.name)} at ${next.minCitizens.toLocaleString("en-US")} citizens.` : "The highest stage there is. 👑",
  ];
  return { text: lines.join("\n"), photo: cardUrl(site, n.id), buttons: [{ text: `Join ${n.name}`, url: nationUrl(site, n.id) }] };
}

export function helpText(site: string): string {
  return [
    "🧭 <b>AtlasPad</b>: every token is a nation, every nation runs on $WIF.",
    "",
    "/top: the leading nations",
    "/new: the newest nations",
    "/nation &lt;ticker or name&gt;: one nation's card",
    "/burned: total $WIF burned",
    "",
    `Found yours at ${esc(site.replace(/^https?:\/\//, ""))}`,
  ].join("\n");
}

export function listText(title: string, nations: NationSummary[]): string {
  if (!nations.length) return `${title}\n\nNo nations yet. Be the first to found one.`;
  return [
    title,
    "",
    ...nations.map(
      (n, i) => `${i + 1}. <b>${esc(n.name)}</b> $${esc(n.ticker)} · ${esc(formatWif(n.marketCapWif))} · ${formatCompact(n.citizens)} citizens · ${TIERS[n.tier]?.name ?? ""}`,
    ),
  ].join("\n");
}

export function burnedText(f: FlywheelStats): string {
  return [
    "🔥 <b>$WIF burned forever</b>",
    "",
    `<b>${esc(formatWif(f.wifBurned, { compact: false }))}</b>`,
    `100% of founding fees + 0.25% of every curve trade.`,
    "",
    `🔒 Locked in pools: ${esc(formatWif(f.wifLocked))}`,
    `🔁 Traded through AtlasPad: ${esc(formatWif(f.wifVolume))}`,
  ].join("\n");
}

/** "/nation@AtlasBot $PEPE" → { cmd: "nation", arg: "$PEPE" } */
export function parseCommand(text: string): { cmd: string; arg: string } | null {
  const m = text.trim().match(/^\/([a-z_]+)(?:@\w+)?(?:\s+([\s\S]*))?$/i);
  return m ? { cmd: m[1]!.toLowerCase(), arg: (m[2] ?? "").trim() } : null;
}

export function findNation(nations: NationSummary[], q: string): NationSummary | null {
  const s = q.replace(/^\$/, "").trim().toLowerCase();
  if (!s) return null;
  return nations.find((n) => n.ticker.toLowerCase() === s) ?? nations.find((n) => n.name.toLowerCase() === s) ?? nations.find((n) => n.name.toLowerCase().includes(s)) ?? null;
}
