import { BuildingType, TIERS } from "./constants";

/** Market + population inputs for one nation at one point in time. All ETH values in ETH (not wei). */
export interface NationMetrics {
  marketCapEth: number;
  liquidityEth: number;
  volume24hEth: number;
  citizens: number;
}

export interface NationGameState {
  buildings: ReadonlySet<BuildingType>;
  influence: number;
  warWins: number;
  allies: number;
}

export interface NationStats {
  economicPower: number;
  militaryPower: number;
  defensivePower: number;
  influenceScore: number;
  populationScore: number;
  developmentScore: number;
  civilizationScore: number;
  tier: number;
  territoryCells: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Log-scaled 0..1 score: `lo` maps to ~0.05, `hi` (and above) maps to 1. */
export function logScore(x: number, lo: number, hi: number): number {
  if (!Number.isFinite(x) || x <= 0) return 0;
  return clamp(Math.log10(1 + x / lo) / Math.log10(1 + hi / lo), 0, 1);
}

const has = (s: NationGameState, b: BuildingType) => (s.buildings.has(b) ? 1 : 0);
const round1 = (x: number) => Math.round(x * 10) / 10;

export function economicPower(m: NationMetrics, s: NationGameState): number {
  const base =
    0.5 * logScore(m.marketCapEth, 0.01, 10_000) +
    0.3 * logScore(m.liquidityEth, 0.01, 5_000) +
    0.2 * logScore(m.volume24hEth, 0.001, 2_000);
  const mult = 1 + 0.1 * has(s, BuildingType.Bank) + 0.05 * has(s, BuildingType.Port);
  return round1(clamp(100 * base * mult, 0, 100));
}

export function populationScore(citizens: number): number {
  return round1(100 * logScore(citizens, 1, 100_000));
}

export function militaryPower(m: NationMetrics, s: NationGameState, econ: number): number {
  const base =
    0.45 * logScore(m.citizens, 1, 100_000) + 0.35 * (econ / 100) + 0.2 * Math.min(1, s.warWins / 10);
  const mult = 1 + 0.1 * has(s, BuildingType.Factory) + 0.05 * has(s, BuildingType.Capitol);
  return round1(clamp(100 * base * mult, 0, 100));
}

export function defensivePower(military: number, s: NationGameState): number {
  const mult = 1 + 0.1 * has(s, BuildingType.Capitol) + 0.1 * has(s, BuildingType.Monument);
  return round1(clamp(military * mult, 0, 100));
}

export function influenceScore(influence: number): number {
  return round1(100 * logScore(influence, 10, 1_000_000));
}

export function developmentScore(s: NationGameState): number {
  return round1((s.buildings.size / 8) * 100);
}

export function tierForScore(score: number): number {
  let t = 0;
  for (const tier of TIERS) if (score >= tier.minScore) t = tier.tier;
  return t;
}

/** Hex cells a nation claims on the world map. Grows super-linearly with civilization score. */
export function territoryCells(civilizationScore: number, warBonusPct = 0): number {
  const base = 6 + Math.floor(Math.pow(clamp(civilizationScore, 0, 100), 1.35) / 2.2);
  return Math.round(base * (1 + warBonusPct / 100));
}

export function computeStats(m: NationMetrics, s: NationGameState, warBonusPct = 0): NationStats {
  const econ = economicPower(m, s);
  const pop = populationScore(m.citizens);
  const mil = militaryPower(m, s, econ);
  const def = defensivePower(mil, s);
  const inf = influenceScore(s.influence);
  const dev = developmentScore(s);
  const spaceMult = s.buildings.has(BuildingType.Spaceport) ? 1.1 : 1;
  const civ = round1(clamp((0.35 * econ + 0.25 * pop + 0.15 * mil + 0.15 * inf + 0.1 * dev) * spaceMult, 0, 100));
  return {
    economicPower: econ,
    militaryPower: mil,
    defensivePower: def,
    influenceScore: inf,
    populationScore: pop,
    developmentScore: dev,
    civilizationScore: civ,
    tier: tierForScore(civ),
    territoryCells: territoryCells(civ, warBonusPct),
  };
}
