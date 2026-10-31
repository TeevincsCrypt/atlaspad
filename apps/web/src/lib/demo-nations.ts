import { computeStats, encodeEmblem, WIF_MARKET_UNIT, type Glyph, type NationSummary, type Pattern } from "@atlaspad/shared";

/**
 * Fifteen illustrative DEMO nations, from a three-citizen settlement to a fourteen-thousand-citizen empire, so
 * visitors can see what a busy Atlas looks like. They are NOT on-chain: they have no token, no contract address and
 * no trades, they are badged "DEMO" everywhere they appear, they are never counted in world totals, and they can be
 * hidden with the "Demo nations" switch (or disabled for a deployment with NEXT_PUBLIC_DEMO_NATIONS=off).
 * Their game stats come from the same published rules as real nations (computeStats).
 */
export const DEMO_ENABLED = process.env.NEXT_PUBLIC_DEMO_NATIONS !== "off";
export const DEMO_ID_BASE = 1_000_000;

export const isDemo = (n: Pick<NationSummary, "id"> & { demo?: true }): boolean => n.demo === true || n.id > DEMO_ID_BASE;

const U = WIF_MARKET_UNIT;

// name, ticker, theme, glyph, pattern, colors, citizens, market cap (market units), liquidity, 24h volume,
// 24h change, buildings, influence, war wins
type Spec = [string, string, number, Glyph, Pattern, [string, string, string], number, number, number, number, number, number[], number, number];
const SPECS: Spec[] = [
  ["Mossbay", "MOSS", 3, "leaf", "solid", ["#2e7d5b", "#d9f2e4", "#123524"], 3, 0.7, 0.05, 0.004, 0.02, [], 20, 0],
  ["Driftwood", "DRFT", 3, "anchor", "horizontal", ["#7aa6c2", "#f1e9da", "#2b3a4a"], 8, 0.9, 0.12, 0.01, -0.04, [], 60, 0],
  ["Kelpshire", "KELP", 3, "wave", "vertical", ["#1fb6a6", "#0d3b4f", "#e6fffb"], 14, 1.5, 0.3, 0.05, 0.08, [0], 180, 0],
  ["Emberfall", "EMBR", 7, "flame", "diagonal", ["#e8562a", "#ffd166", "#2a0f0a"], 27, 2.4, 0.5, 0.12, 0.15, [0], 420, 1],
  ["Glimmerholt", "GLIM", 7, "diamond", "cross", ["#9d8cff", "#f3edff", "#211a47"], 41, 3.6, 0.8, 0.2, -0.06, [0, 1], 900, 1],
  ["Saltmarch", "SALT", 0, "shield", "chevron", ["#c9a227", "#f4ead0", "#2b2b2b"], 64, 5, 1.2, 0.35, 0.03, [0, 1, 2], 1_800, 2],
  ["Stormreach", "STRM", 1, "bolt", "diagonal", ["#3ddcff", "#0f0f1f", "#ff2e88"], 95, 7.5, 1.8, 0.6, 0.22, [0, 1, 2], 3_200, 2],
  ["Lumen Coast", "LUMN", 3, "sun", "horizontal", ["#ffb547", "#1fb6c9", "#06202f"], 160, 11, 2.6, 1.1, 0.09, [0, 1, 2, 3], 6_500, 3],
  ["Ironveil", "IRNV", 0, "sword", "quartered", ["#9aa5b1", "#141820", "#c0392b"], 240, 18, 4, 1.6, -0.11, [0, 1, 2, 3], 11_000, 4],
  ["Solaria", "SOLR", 2, "planet", "disc", ["#8ab4ff", "#0b1026", "#ffe08a"], 410, 30, 6.5, 2.8, 0.31, [0, 1, 2, 3, 4], 24_000, 4],
  ["Verdant Reach", "VRDN", 4, "tree", "vertical", ["#3fbf6e", "#f4f1e8", "#1b5e20"], 760, 55, 11, 5, 0.06, [0, 1, 2, 3, 4, 5], 48_000, 5],
  ["Obsidia", "OBSD", 6, "eye", "solid", ["#141820", "#9d8cff", "#3ddcff"], 1_300, 90, 19, 8, -0.02, [0, 1, 2, 3, 4, 5], 90_000, 6],
  ["Aurora Prime", "AURA", 2, "star", "chevron", ["#e58bff", "#0b1026", "#ffc46b"], 2_900, 160, 34, 14, 0.12, [0, 1, 2, 3, 4, 5, 6], 160_000, 7],
  ["Crowned Tide", "CRWN", 3, "crown", "horizontal", ["#0e5e8c", "#e8c47a", "#06202f"], 6_500, 320, 70, 26, 0.04, [0, 1, 2, 3, 4, 5, 6], 240_000, 8],
  ["Celestine", "CLST", 7, "dragon", "quartered", ["#d6b26e", "#1f1030", "#f3d58f"], 14_000, 640, 125, 42, 0.18, [0, 1, 2, 3, 4, 5, 6, 7], 320_000, 9],
];

const SUPPLY = 1_000_000_000;
const DAY = 86_400;
const NOW = 1_793_000_000; // fixed, so demo data is stable across renders and builds

export const DEMO_NATIONS: NationSummary[] = SPECS.map((s, i) => {
  const [name, ticker, theme, glyph, pattern, [primary, secondary, accent], citizens, mcapU, liqU, volU, change24h, buildings, influence, warWins] = s;
  const marketCapWif = mcapU * U;
  const graduated = marketCapWif >= 10 * U;
  const stats = computeStats(
    { marketCapWif, liquidityWif: liqU * U, volume24hWif: volU * U, citizens },
    { buildings: new Set(buildings), influence, warWins, allies: 0 },
  );
  return {
    id: DEMO_ID_BASE + 1 + i,
    demo: true,
    name,
    ticker,
    token: `demo:${ticker.toLowerCase()}`, // only used to place the nation on the map; never shown as an address
    pair: "",
    founder: "",
    theme,
    emblem: encodeEmblem({ glyph, pattern, primary, secondary, accent }).toString(),
    metadataUri: "",
    description: `${name} is a demo nation that shows what AtlasPad looks like at scale. It is not on-chain.`,
    createdAt: NOW - (40 - i * 2) * DAY,
    graduated,
    graduatedAt: graduated ? NOW - (20 - i) * DAY : null,
    totalSupply: (BigInt(SUPPLY) * 10n ** 18n).toString(),
    priceWif: marketCapWif / SUPPLY,
    marketCapWif,
    liquidityWif: liqU * U,
    volume24hWif: volU * U,
    trades24h: Math.round(5 + citizens / 12),
    change1h: change24h / 6,
    change24h,
    athMarketCapWif: marketCapWif * 1.15,
    curveProgress: graduated ? 1 : Math.min(0.99, marketCapWif / (10 * U)),
    treasuryWif: Math.round(volU * U * 0.005 * 30),
    wifBurned: Math.round(100 + volU * U * 0.0025 * 30),
    citizens,
    citizens24hAgo: Math.round(citizens * 0.93),
    ...stats,
    resources: { influence, culture: Math.round(influence / 3), energy: Math.round(influence / 2), materials: Math.round(influence * 0.8) },
    rank: null,
    previousRank: null,
    statuses: [],
    activeWars: 0,
    allianceId: null,
    buildings,
    warWins,
    warLosses: Math.floor(warWins / 3),
  } satisfies NationSummary;
});
