/**
 * AtlasPad game constants. Everything here is a published game rule (see GAME_MECHANICS.md).
 * Game values (resources, power scores, influence) are NOT financial assets and have no monetary value.
 */

export const THEMES = [
  { id: 0, key: "medieval", name: "Medieval", palette: ["#C9A227", "#7A1F1F", "#2B2B2B"] },
  { id: 1, key: "cyberpunk", name: "Cyberpunk", palette: ["#FF2E88", "#00E5FF", "#120B2E"] },
  { id: 2, key: "space", name: "Space", palette: ["#8AB4FF", "#E8ECFF", "#0B1026"] },
  { id: 3, key: "ocean", name: "Ocean", palette: ["#1FB6C9", "#0E5E8C", "#06202F"] },
  { id: 4, key: "jungle", name: "Jungle", palette: ["#3FBF6E", "#1B5E20", "#0D2414"] },
  { id: 5, key: "meme", name: "Meme", palette: ["#7CD957", "#FFD23F", "#1E2A12"] },
  { id: 6, key: "ai", name: "AI", palette: ["#9D8CFF", "#3DDCFF", "#0F0F1F"] },
  { id: 7, key: "fantasy", name: "Fantasy", palette: ["#E58BFF", "#FFC46B", "#1F1030"] },
] as const;
export type ThemeKey = (typeof THEMES)[number]["key"];

/**
 * How much $WIF one "market unit" is worth to the game engine. Every market-driven game rule (economic power,
 * energy production, war trading activity, world events, milestones) is calibrated in market units, so the game
 * stays balanced whatever $WIF trades at. Recommended deployment: GRADUATION_WIF = 2 market units, which makes
 * the curve's opening market cap ≈ 0.6 units and the graduation market cap ≈ 10 units.
 */
export const WIF_MARKET_UNIT = 100_000;

/** Converts a $WIF amount (whole tokens, not base units) into game market units. */
export const toMarketUnits = (wif: number): number => wif / WIF_MARKET_UNIT;

/** Mirrors AtlasGovernor.GameAction. */
export enum GameAction {
  Build = 0,
  DeclareWar = 1,
  CreateAlliance = 2,
  InviteToAlliance = 3,
  JoinAlliance = 4,
  LeaveAlliance = 5,
}

/** Mirrors AtlasGovernor.Kind. */
export enum ProposalKind {
  Treasury = 0,
  GameAction = 1,
  Symbol = 2,
}

/** Mirrors AtlasGovernor.State. */
export enum ProposalState {
  Active = 0,
  Canceled = 1,
  Defeated = 2,
  Queued = 3,
  Executable = 4,
  Executed = 5,
  Expired = 6,
}

export const RESOURCES = ["influence", "culture", "energy", "materials"] as const;
export type ResourceKey = (typeof RESOURCES)[number];
export type Resources = Record<ResourceKey, number>;
export const ZERO_RESOURCES: Resources = { influence: 0, culture: 0, energy: 0, materials: 0 };

export enum BuildingType {
  Capitol = 0,
  Bank = 1,
  Factory = 2,
  University = 3,
  Stadium = 4,
  Port = 5,
  Monument = 6,
  Spaceport = 7,
}

export interface BuildingDef {
  type: BuildingType;
  key: string;
  name: string;
  icon: string;
  cost: Partial<Resources>;
  buildHours: number;
  requires: BuildingType[];
  minCitizens: number;
  requiresGraduation: boolean;
  effect: string;
}

export const BUILDINGS: readonly BuildingDef[] = [
  {
    type: BuildingType.Capitol,
    key: "capitol",
    name: "Capitol",
    icon: "🏛️",
    cost: { materials: 100, energy: 50 },
    buildHours: 6,
    requires: [],
    minCitizens: 1,
    requiresGraduation: false,
    effect: "Seat of government. Unlocks all other buildings. +5% military, +10% defense.",
  },
  {
    type: BuildingType.Bank,
    key: "bank",
    name: "Bank",
    icon: "🏦",
    cost: { materials: 300, energy: 200 },
    buildHours: 12,
    requires: [BuildingType.Capitol],
    minCitizens: 10,
    requiresGraduation: false,
    effect: "+10% economic power.",
  },
  {
    type: BuildingType.Factory,
    key: "factory",
    name: "Factory",
    icon: "🏭",
    cost: { materials: 300, energy: 150 },
    buildHours: 12,
    requires: [BuildingType.Capitol],
    minCitizens: 10,
    requiresGraduation: false,
    effect: "+25% materials production, +10% military.",
  },
  {
    type: BuildingType.University,
    key: "university",
    name: "University",
    icon: "🏫",
    cost: { materials: 500, energy: 300 },
    buildHours: 18,
    requires: [BuildingType.Capitol],
    minCitizens: 50,
    requiresGraduation: false,
    effect: "+25% influence production.",
  },
  {
    type: BuildingType.Stadium,
    key: "stadium",
    name: "Stadium",
    icon: "🏟️",
    cost: { materials: 800, energy: 400 },
    buildHours: 24,
    requires: [BuildingType.Capitol],
    minCitizens: 100,
    requiresGraduation: false,
    effect: "Citizen engagement: +10 culture per hour and +25% culture from governance.",
  },
  {
    type: BuildingType.Port,
    key: "port",
    name: "Port",
    icon: "⚓",
    cost: { materials: 800, energy: 600 },
    buildHours: 24,
    requires: [BuildingType.Bank],
    minCitizens: 50,
    requiresGraduation: true,
    effect: "Opens trade routes: +25% energy, +10% materials, +5% economic power.",
  },
  {
    type: BuildingType.Monument,
    key: "monument",
    name: "Monument",
    icon: "🗼",
    cost: { materials: 1500, energy: 1000, culture: 500 },
    buildHours: 36,
    requires: [BuildingType.Capitol],
    minCitizens: 100,
    requiresGraduation: false,
    effect: "+10 culture per hour, +10% defense.",
  },
  {
    type: BuildingType.Spaceport,
    key: "spaceport",
    name: "Spaceport",
    icon: "🚀",
    cost: { materials: 4000, energy: 4000, influence: 1000 },
    buildHours: 72,
    requires: [BuildingType.University, BuildingType.Factory, BuildingType.Bank],
    minCitizens: 1000,
    requiresGraduation: true,
    effect: "Advanced nation status: +10% civilization score and a spacefaring capital.",
  },
] as const;

export const TIERS = [
  { tier: 0, key: "settlement", name: "Settlement", minScore: 0 },
  { tier: 1, key: "town", name: "Town", minScore: 15 },
  { tier: 2, key: "city", name: "City", minScore: 35 },
  { tier: 3, key: "metropolis", name: "Metropolis", minScore: 55 },
  { tier: 4, key: "empire", name: "Empire", minScore: 75 },
] as const;

/** One game epoch: resources accrue and market events are evaluated once per hour. */
export const EPOCH_SECONDS = 3600;

export const WAR = {
  durationSeconds: 48 * 3600,
  maxActiveWarsPerNation: 2,
  rematchCooldownSeconds: 72 * 3600,
  territoryBonusPct: 10,
  territoryBonusSeconds: 7 * 24 * 3600,
  minSpoils: 50,
  spoilsPct: 10,
} as const;

export const ALLIANCE = {
  maxMembers: 6,
  inviteTtlSeconds: 14 * 24 * 3600,
  influenceBonusPctPerAlly: 5,
  maxInfluenceBonusPct: 25,
  warScoreBonusPctPerAlly: 2,
  maxWarScoreBonusPct: 10,
} as const;

/** A holder counts as a citizen only above this share of supply (anti-dust): 0.0001% (1e-6). */
export const CITIZEN_MIN_SUPPLY_FRACTION = 1e-6;

/** Mirrors AtlasGovernor / NationTreasury constants (checked against the deployed contracts in apps/indexer/test/integration.test.ts). */
export const GOVERNANCE = {
  proposalThresholdBps: 10,
  treasuryQuorumBps: 400,
  standardQuorumBps: 100,
  treasuryVotingSeconds: 3 * 86400,
  standardVotingSeconds: 86400,
  treasuryTimelockSeconds: 86400,
  executionWindowSeconds: 7 * 86400,
  maxReleaseBps: 2500,
  /** Releases are capped at maxReleaseBps of the balance per rolling window (NationTreasury.RELEASE_WINDOW). */
  releaseWindowSeconds: 7 * 24 * 3600,
} as const;
