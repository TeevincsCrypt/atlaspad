import { describe, expect, it } from "vitest";
import {
  BuildingType,
  computeStats,
  crossedMilestones,
  decodeEmblem,
  detectMarketEvents,
  encodeEmblem,
  epochProduction,
  isWhaleBuy,
  logScore,
  resolveWar,
  tierForScore,
  validateBuild,
  validateJoin,
  validateWarDeclaration,
  type MarketSnapshot,
} from "../src/game";
import { WIF_MARKET_UNIT as U } from "../src/game/constants";

const snap = (over: Partial<MarketSnapshot> = {}): MarketSnapshot => ({
  at: 1_800_000_000,
  priceWif: 1e-9,
  marketCapWif: 1 * U,
  liquidityWif: 0.5 * U,
  citizens: 100,
  volume1hWif: 0.01 * U,
  volume24hWif: 0.24 * U,
  trades1h: 3,
  ...over,
});

describe("stats", () => {
  it("logScore is bounded and monotonic", () => {
    expect(logScore(0, 1, 100)).toBe(0);
    expect(logScore(1e9, 1, 100)).toBe(1);
    expect(logScore(10, 1, 100)).toBeGreaterThan(logScore(5, 1, 100));
  });

  it("computes tiers and buildings multipliers", () => {
    const base = { marketCapWif: 50 * U, liquidityWif: 10 * U, volume24hWif: 5 * U, citizens: 2000 };
    const none = computeStats(base, { buildings: new Set(), influence: 0, warWins: 0, allies: 0 });
    const bank = computeStats(base, { buildings: new Set([BuildingType.Bank]), influence: 0, warWins: 0, allies: 0 });
    expect(bank.economicPower).toBeGreaterThan(none.economicPower);
    expect(none.tier).toBe(tierForScore(none.civilizationScore));
    expect(none.territoryCells).toBeGreaterThanOrEqual(6);
  });

  it("an empty nation is a settlement", () => {
    const s = computeStats(
      { marketCapWif: 0 * U, liquidityWif: 0 * U, volume24hWif: 0 * U, citizens: 0 },
      { buildings: new Set(), influence: 0, warWins: 0, allies: 0 },
    );
    expect(s.tier).toBe(0);
    expect(s.civilizationScore).toBe(0);
  });
});

describe("market events", () => {
  const base = {
    previousAthMarketCapWif: 1 * U,
    athLiquidityWif: 0.5 * U,
    graduated: false,
    lastFired: {},
  };

  it("fires ECONOMIC_BOOM on +10% in an hour", () => {
    const ev = detectMarketEvents({
      ...base,
      now: snap({ priceWif: 1.15e-9, marketCapWif: 1.0 * U }),
      hourAgo: snap({ priceWif: 1e-9 }),
      dayAgo: null,
    });
    expect(ev.map((e) => e.type)).toContain("ECONOMIC_BOOM");
  });

  it("fires GOLDEN_AGE on a new ATH with +50% over 24h, otherwise RECORD_HIGH", () => {
    const golden = detectMarketEvents({
      ...base,
      now: snap({ priceWif: 2e-9, marketCapWif: 2 * U }),
      hourAgo: snap({ priceWif: 1.9e-9 }),
      dayAgo: snap({ priceWif: 1e-9 }),
    });
    expect(golden.find((e) => e.type === "GOLDEN_AGE")?.statusSeconds).toBe(86400);
    const record = detectMarketEvents({
      ...base,
      now: snap({ priceWif: 1.2e-9, marketCapWif: 1.2 * U }),
      hourAgo: snap({ priceWif: 1.19e-9 }),
      dayAgo: snap({ priceWif: 1.1e-9 }),
    });
    expect(record.map((e) => e.type)).toContain("RECORD_HIGH");
  });

  it("respects cooldowns", () => {
    const now = snap({ priceWif: 1.3e-9 });
    const ev = detectMarketEvents({
      ...base,
      now,
      hourAgo: snap({ priceWif: 1e-9 }),
      dayAgo: null,
      lastFired: { ECONOMIC_BOOM: now.at - 3600 },
    });
    expect(ev.map((e) => e.type)).not.toContain("ECONOMIC_BOOM");
  });

  it("detects crises, population explosions and festivals", () => {
    const ev = detectMarketEvents({
      ...base,
      now: snap({ priceWif: 0.4e-9, marketCapWif: 0.4 * U, citizens: 200, volume1hWif: 1 * U, volume24hWif: 1.23 * U, liquidityWif: 0.2 * U }),
      hourAgo: snap({ priceWif: 0.45e-9 }),
      dayAgo: snap({ priceWif: 1e-9, citizens: 100, liquidityWif: 0.5 * U }),
    });
    const types = ev.map((e) => e.type);
    expect(types).toContain("ECONOMIC_CRISIS");
    expect(types).toContain("POPULATION_EXPLOSION");
    expect(types).toContain("TRADE_FESTIVAL");
    expect(types).toContain("BANKING_CRISIS");
  });

  it("does not fire market events for micro nations", () => {
    const ev = detectMarketEvents({
      ...base,
      now: snap({ priceWif: 2e-9, marketCapWif: 0.01 * U }),
      hourAgo: snap({ priceWif: 1e-9 }),
      dayAgo: null,
    });
    expect(ev.map((e) => e.type)).not.toContain("ECONOMIC_BOOM");
  });

  it("whales and milestones", () => {
    expect(isWhaleBuy(1 * U, 10 * U)).toBe(true);
    expect(isWhaleBuy(0.1 * U, 1 * U)).toBe(false);
    expect(crossedMilestones(90, 1200, [10, 100, 1000])).toEqual([100, 1000]);
  });
});

describe("rules", () => {
  it("validates building prerequisites and costs", () => {
    const res = { influence: 0, culture: 0, energy: 1000, materials: 1000 };
    expect(
      validateBuild({ type: BuildingType.Bank, built: new Set(), underConstruction: new Set(), resources: res, citizens: 50, graduated: false }).ok,
    ).toBe(false);
    expect(
      validateBuild({ type: BuildingType.Capitol, built: new Set(), underConstruction: new Set(), resources: res, citizens: 5, graduated: false }).ok,
    ).toBe(true);
    const poor = validateBuild({
      type: BuildingType.Capitol,
      built: new Set(),
      underConstruction: new Set(),
      resources: { influence: 0, culture: 0, energy: 0, materials: 0 },
      citizens: 5,
      graduated: false,
    });
    expect(poor.ok).toBe(false);
  });

  it("validates war declarations", () => {
    const base = {
      attackerId: 1,
      defenderId: 2,
      defenderExists: true,
      sameAlliance: false,
      activeWarBetween: false,
      attackerActiveWars: 0,
      lastWarBetweenEndedAt: null,
      now: 1_000_000,
    };
    expect(validateWarDeclaration(base).ok).toBe(true);
    expect(validateWarDeclaration({ ...base, sameAlliance: true }).ok).toBe(false);
    expect(validateWarDeclaration({ ...base, lastWarBetweenEndedAt: 1_000_000 - 3600 }).ok).toBe(false);
    expect(validateWarDeclaration({ ...base, attackerActiveWars: 2 }).ok).toBe(false);
  });

  it("resolves wars deterministically with ties to the defender", () => {
    const side = {
      citizensStart: 100,
      citizensEnd: 120,
      marketCapStartWif: 1 * U,
      marketCapEndWif: 1.2 * U,
      warVolumeWif: 2 * U,
      economicPowerEnd: 40,
      defensivePowerEnd: 0,
      allies: 0,
    };
    const tie = resolveWar(side, side, 1000);
    expect(tie.winner).toBe("defender");
    expect(tie.spoils).toBe(100);
    const stronger = resolveWar({ ...side, citizensEnd: 200, warVolumeWif: 20 * U }, side, 10);
    expect(stronger.winner).toBe("attacker");
    expect(stronger.spoils).toBe(50);
    expect(resolveWar(side, side, 0)).toEqual(resolveWar(side, side, 0));
  });

  it("requires a valid invitation to join an alliance", () => {
    const base = {
      allianceExists: true,
      allianceActive: true,
      currentAllianceId: null,
      invitedAt: 100,
      memberCount: 2,
      now: 200,
      atWarWithMember: false,
    };
    expect(validateJoin(base).ok).toBe(true);
    expect(validateJoin({ ...base, invitedAt: null }).ok).toBe(false);
    expect(validateJoin({ ...base, now: 100 + 15 * 86400 }).ok).toBe(false);
    expect(validateJoin({ ...base, memberCount: 6 }).ok).toBe(false);
  });

  it("produces resources from activity", () => {
    const p = epochProduction(
      { citizens: 100, volume1hWif: 0.1 * U, liquidityWif: 1 * U, votesCast: 2, economicPower: 30, allies: 1, goldenAge: false },
      new Set([BuildingType.Factory]),
    );
    expect(p.materials).toBe(Math.round(42 * 1.25));
    expect(p.energy).toBeGreaterThan(0);
    expect(p.culture).toBeGreaterThan(10);
    expect(p.influence).toBe(Math.round(3 * 1.05));
  });
});

describe("emblem", () => {
  it("round-trips", () => {
    const e = { glyph: "frog", pattern: "chevron", primary: "#7cd957", secondary: "#ffd23f", accent: "#1e2a12" } as const;
    expect(decodeEmblem(encodeEmblem(e))).toEqual(e);
  });

  it("decodes any value", () => {
    const d = decodeEmblem((1n << 255n) + 12345n);
    expect(d.glyph).toBeTruthy();
    expect(d.primary).toMatch(/^#[0-9a-f]{6}$/);
  });
});
