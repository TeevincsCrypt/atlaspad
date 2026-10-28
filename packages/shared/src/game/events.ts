import { WIF_MARKET_UNIT } from "./constants";

/**
 * World event rules. Every event is derived from indexed on-chain data; nothing is random.
 */

export const EVENT_TYPES = {
  FOUNDED: { icon: "🏳️", title: "NATION FOUNDED", severity: "notable" },
  GRADUATED: { icon: "🌐", title: "JOINED WORLD MARKETS", severity: "notable" },
  ECONOMIC_BOOM: { icon: "🚀", title: "ECONOMIC BOOM", severity: "notable" },
  MARKET_CRASH: { icon: "📉", title: "MARKET CRASH", severity: "notable" },
  GOLDEN_AGE: { icon: "👑", title: "GOLDEN AGE", severity: "major" },
  ECONOMIC_CRISIS: { icon: "🌩️", title: "ECONOMIC CRISIS", severity: "major" },
  RECORD_HIGH: { icon: "📈", title: "RECORD ECONOMY", severity: "minor" },
  POPULATION_EXPLOSION: { icon: "👥", title: "POPULATION EXPLOSION", severity: "notable" },
  TRADE_FESTIVAL: { icon: "🔥", title: "TRADE FESTIVAL", severity: "notable" },
  BANKING_CRISIS: { icon: "⚠️", title: "BANKING CRISIS", severity: "notable" },
  NATIONAL_EMERGENCY: { icon: "☠️", title: "NATIONAL EMERGENCY", severity: "major" },
  FOREIGN_INVESTMENT: { icon: "🐋", title: "FOREIGN INVESTMENT", severity: "notable" },
  CITIZEN_MILESTONE: { icon: "👥", title: "POPULATION MILESTONE", severity: "notable" },
  MCAP_MILESTONE: { icon: "💰", title: "ECONOMIC MILESTONE", severity: "notable" },
  WAR_DECLARED: { icon: "⚔️", title: "WAR DECLARED", severity: "major" },
  WAR_ENDED: { icon: "🏆", title: "WAR ENDED", severity: "major" },
  ALLIANCE_FORMED: { icon: "🤝", title: "ALLIANCE FORMED", severity: "notable" },
  ALLIANCE_INVITE: { icon: "✉️", title: "DIPLOMATIC INVITATION", severity: "minor" },
  ALLIANCE_JOINED: { icon: "🤝", title: "ALLIANCE EXPANDED", severity: "notable" },
  ALLIANCE_LEFT: { icon: "💔", title: "ALLIANCE BROKEN", severity: "notable" },
  BUILDING_STARTED: { icon: "🏗️", title: "CONSTRUCTION STARTED", severity: "minor" },
  BUILDING_COMPLETED: { icon: "🏗️", title: "CONSTRUCTION COMPLETE", severity: "notable" },
  ACTION_REJECTED: { icon: "📜", title: "DECREE REJECTED", severity: "minor" },
  PROPOSAL_CREATED: { icon: "🗳️", title: "NEW PROPOSAL", severity: "minor" },
  TREASURY_RELEASE: { icon: "🏦", title: "TREASURY SPENDING", severity: "notable" },
  SYMBOL_CHANGED: { icon: "🎌", title: "NEW NATIONAL SYMBOL", severity: "minor" },
  ACHIEVEMENT: { icon: "🏅", title: "ACHIEVEMENT", severity: "minor" },
} as const;

export type EventType = keyof typeof EVENT_TYPES;
export type EventSeverity = "minor" | "notable" | "major";

/** Snapshot of a nation's market state at an epoch boundary. */
export interface MarketSnapshot {
  at: number; // unix seconds
  priceWif: number;
  marketCapWif: number;
  liquidityWif: number;
  citizens: number;
  volume1hWif: number;
  volume24hWif: number;
  trades1h: number;
}

export interface MarketEventContext {
  now: MarketSnapshot;
  hourAgo: MarketSnapshot | null;
  dayAgo: MarketSnapshot | null;
  /** All-time high market cap before `now` ($WIF). */
  previousAthMarketCapWif: number;
  /** All-time high liquidity before `now` ($WIF). */
  athLiquidityWif: number;
  graduated: boolean;
  /** Unix seconds each event type last fired for this nation. */
  lastFired: Partial<Record<EventType, number>>;
}

export interface DetectedEvent {
  type: EventType;
  data: Record<string, number | string | boolean>;
  /** Seconds the nation carries this status on the map (golden age / crisis glow), if any. */
  statusSeconds?: number;
}

export const EVENT_RULES = {
  boomChange1h: 0.1,
  crashChange1h: -0.2,
  goldenAgeChange24h: 0.5,
  crisisChange24h: -0.5,
  recordHighStep: 1.05,
  populationGrowth24h: 0.25,
  populationMinGain: 25,
  festivalVolumeMultiple: 5,
  festivalMinVolumeWif: 0.25 * WIF_MARKET_UNIT,
  bankingCrisisLiquidityDrop: 0.5,
  bankingCrisisMinLiquidityWif: 0.1 * WIF_MARKET_UNIT,
  emergencyLiquidityFraction: 0.1,
  emergencyMinAthLiquidityWif: 0.5 * WIF_MARKET_UNIT,
  minMarketCapWif: 0.1 * WIF_MARKET_UNIT,
  whaleMinWif: 0.25 * WIF_MARKET_UNIT,
  whaleMcapFraction: 0.03,
  cooldowns: {
    ECONOMIC_BOOM: 6 * 3600,
    MARKET_CRASH: 6 * 3600,
    GOLDEN_AGE: 48 * 3600,
    ECONOMIC_CRISIS: 48 * 3600,
    RECORD_HIGH: 12 * 3600,
    POPULATION_EXPLOSION: 24 * 3600,
    TRADE_FESTIVAL: 12 * 3600,
    BANKING_CRISIS: 24 * 3600,
    NATIONAL_EMERGENCY: 72 * 3600,
    FOREIGN_INVESTMENT: 3600,
  } as Partial<Record<EventType, number>>,
  statusSeconds: {
    GOLDEN_AGE: 24 * 3600,
    ECONOMIC_CRISIS: 24 * 3600,
    ECONOMIC_BOOM: 3 * 3600,
    MARKET_CRASH: 3 * 3600,
    TRADE_FESTIVAL: 3 * 3600,
    NATIONAL_EMERGENCY: 24 * 3600,
  } as Partial<Record<EventType, number>>,
} as const;

export function pctChange(now: number, then: number | null | undefined): number | null {
  if (then === null || then === undefined || then <= 0 || !Number.isFinite(now)) return null;
  return now / then - 1;
}

function cooled(ctx: MarketEventContext, type: EventType): boolean {
  const last = ctx.lastFired[type];
  const cd = EVENT_RULES.cooldowns[type] ?? 0;
  return last === undefined || ctx.now.at - last >= cd;
}

/** Evaluate market-driven events at an epoch boundary. Deterministic for the same inputs. */
export function detectMarketEvents(ctx: MarketEventContext): DetectedEvent[] {
  const out: DetectedEvent[] = [];
  const { now, hourAgo, dayAgo } = ctx;
  const push = (type: EventType, data: DetectedEvent["data"]) => {
    if (!cooled(ctx, type)) return;
    const statusSeconds = EVENT_RULES.statusSeconds[type];
    out.push(statusSeconds ? { type, data, statusSeconds } : { type, data });
  };
  const bigEnough = now.marketCapWif >= EVENT_RULES.minMarketCapWif;

  const c1h = pctChange(now.priceWif, hourAgo?.priceWif);
  const c24h = pctChange(now.priceWif, dayAgo?.priceWif);

  if (bigEnough && c1h !== null && now.trades1h > 0) {
    if (c1h >= EVENT_RULES.boomChange1h) push("ECONOMIC_BOOM", { change1h: c1h });
    if (c1h <= EVENT_RULES.crashChange1h) push("MARKET_CRASH", { change1h: c1h });
  }

  const newAth = now.marketCapWif > ctx.previousAthMarketCapWif * EVENT_RULES.recordHighStep;
  if (bigEnough && newAth && ctx.previousAthMarketCapWif > 0) {
    if (c24h !== null && c24h >= EVENT_RULES.goldenAgeChange24h) {
      push("GOLDEN_AGE", { marketCapWif: now.marketCapWif, change24h: c24h });
    } else {
      push("RECORD_HIGH", { marketCapWif: now.marketCapWif });
    }
  }

  if (bigEnough && c24h !== null && c24h <= EVENT_RULES.crisisChange24h) {
    push("ECONOMIC_CRISIS", { change24h: c24h });
  }

  if (dayAgo) {
    const gain = now.citizens - dayAgo.citizens;
    if (
      gain >= EVENT_RULES.populationMinGain &&
      dayAgo.citizens > 0 &&
      now.citizens >= dayAgo.citizens * (1 + EVENT_RULES.populationGrowth24h)
    ) {
      push("POPULATION_EXPLOSION", { gained: gain, citizens: now.citizens });
    }
  }

  const priorHourlyAvg = (now.volume24hWif - now.volume1hWif) / 23;
  if (
    now.volume1hWif >= EVENT_RULES.festivalMinVolumeWif &&
    now.volume1hWif >= EVENT_RULES.festivalVolumeMultiple * Math.max(priorHourlyAvg, 1e-9)
  ) {
    push("TRADE_FESTIVAL", { volume1hWif: now.volume1hWif });
  }

  if (
    dayAgo &&
    dayAgo.liquidityWif >= EVENT_RULES.bankingCrisisMinLiquidityWif &&
    now.liquidityWif <= dayAgo.liquidityWif * EVENT_RULES.bankingCrisisLiquidityDrop
  ) {
    push("BANKING_CRISIS", { liquidityWif: now.liquidityWif, liquidity24hAgoWif: dayAgo.liquidityWif });
  }

  if (
    ctx.graduated &&
    ctx.athLiquidityWif >= EVENT_RULES.emergencyMinAthLiquidityWif &&
    now.liquidityWif < ctx.athLiquidityWif * EVENT_RULES.emergencyLiquidityFraction
  ) {
    push("NATIONAL_EMERGENCY", { liquidityWif: now.liquidityWif, athLiquidityWif: ctx.athLiquidityWif });
  }

  return out;
}

/** A buy large enough to count as foreign investment ("whale"). Evaluated per trade. */
export function isWhaleBuy(wifAmount: number, marketCapBeforeWif: number): boolean {
  return (
    wifAmount >= EVENT_RULES.whaleMinWif && wifAmount >= marketCapBeforeWif * EVENT_RULES.whaleMcapFraction
  );
}

export const CITIZEN_MILESTONES = [10, 100, 1_000, 10_000, 100_000] as const;
/** Market-cap milestones in $WIF: 1, 10, 100, 1,000 and 10,000 market units. */
export const MCAP_MILESTONES_WIF = [1, 10, 100, 1_000, 10_000].map((u) => u * WIF_MARKET_UNIT);
/** The milestone that unlocks the "Economic Power" achievement (100 market units). */
export const ECONOMIC_POWER_MCAP_WIF = 100 * WIF_MARKET_UNIT;

/** Milestones crossed between two values (exclusive of `before`, inclusive of `after`). */
export function crossedMilestones(before: number, after: number, milestones: readonly number[]): number[] {
  return milestones.filter((m) => before < m && after >= m);
}
