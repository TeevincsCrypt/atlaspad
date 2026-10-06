import { ALLIANCE, BuildingType, type Resources } from "./constants";

export interface EpochActivity {
  citizens: number;
  volume1hEth: number;
  liquidityEth: number;
  /** Governance votes cast by this nation's citizens during the epoch. */
  votesCast: number;
  economicPower: number;
  allies: number;
  goldenAge: boolean;
}

const has = (b: ReadonlySet<BuildingType>, t: BuildingType) => (b.has(t) ? 1 : 0);

/**
 * Resources a nation produces in one hourly epoch. Integer amounts; deterministic.
 * Resources are game-only values: they cannot be bought, sold or withdrawn.
 */
export function epochProduction(a: EpochActivity, buildings: ReadonlySet<BuildingType>): Resources {
  const materials = Math.round(
    (2 + 4 * Math.sqrt(Math.max(0, a.citizens))) *
      (1 + 0.25 * has(buildings, BuildingType.Factory) + 0.1 * has(buildings, BuildingType.Port)),
  );
  const energy = Math.round(
    (1 + 20 * Math.log10(1 + 1000 * Math.max(0, a.volume1hEth)) + 10 * Math.log10(1 + 100 * Math.max(0, a.liquidityEth))) *
      (1 + 0.25 * has(buildings, BuildingType.Port)),
  );
  const culture = Math.round(
    (5 * a.votesCast * (1 + 0.25 * has(buildings, BuildingType.Stadium)) +
      Math.pow(Math.max(0, a.citizens), 0.3) +
      10 * has(buildings, BuildingType.Stadium) +
      10 * has(buildings, BuildingType.Monument)),
  );
  const allyBonus = Math.min(ALLIANCE.maxInfluenceBonusPct, a.allies * ALLIANCE.influenceBonusPctPerAlly) / 100;
  const influence = Math.round(
    (a.economicPower / 10 + (a.goldenAge ? 20 : 0)) *
      (1 + 0.25 * has(buildings, BuildingType.University) + allyBonus),
  );
  return { materials, energy, culture, influence };
}

export function addResources(a: Resources, b: Partial<Resources>, sign = 1): Resources {
  return {
    influence: a.influence + sign * (b.influence ?? 0),
    culture: a.culture + sign * (b.culture ?? 0),
    energy: a.energy + sign * (b.energy ?? 0),
    materials: a.materials + sign * (b.materials ?? 0),
  };
}

export function canAfford(have: Resources, cost: Partial<Resources>): boolean {
  return (
    have.influence >= (cost.influence ?? 0) &&
    have.culture >= (cost.culture ?? 0) &&
    have.energy >= (cost.energy ?? 0) &&
    have.materials >= (cost.materials ?? 0)
  );
}
