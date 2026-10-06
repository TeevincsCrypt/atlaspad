import { ALLIANCE, BUILDINGS, type BuildingType, WAR, type Resources } from "./constants";
import { canAfford } from "./resources";
import { logScore } from "./stats";

export type RuleResult = { ok: true } | { ok: false; reason: string };
const ok: RuleResult = { ok: true };
const no = (reason: string): RuleResult => ({ ok: false, reason });

// ---------------------------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------------------------

export interface BuildContext {
  type: number;
  built: ReadonlySet<BuildingType>;
  underConstruction: ReadonlySet<BuildingType>;
  resources: Resources;
  citizens: number;
  graduated: boolean;
}

export function validateBuild(c: BuildContext): RuleResult {
  const def = BUILDINGS[c.type];
  if (!def) return no("Unknown building type.");
  if (c.built.has(def.type)) return no(`${def.name} already built.`);
  if (c.underConstruction.has(def.type)) return no(`${def.name} is already under construction.`);
  for (const req of def.requires) {
    if (!c.built.has(req)) return no(`${def.name} requires a completed ${BUILDINGS[req]!.name}.`);
  }
  if (c.citizens < def.minCitizens) return no(`${def.name} requires ${def.minCitizens} citizens.`);
  if (def.requiresGraduation && !c.graduated) return no(`${def.name} requires the nation to join world markets.`);
  if (!canAfford(c.resources, def.cost)) return no(`Insufficient resources for ${def.name}.`);
  return ok;
}

// ---------------------------------------------------------------------------------------------
// War
// ---------------------------------------------------------------------------------------------

export interface WarDeclarationContext {
  attackerId: number;
  defenderId: number;
  defenderExists: boolean;
  sameAlliance: boolean;
  activeWarBetween: boolean;
  attackerActiveWars: number;
  lastWarBetweenEndedAt: number | null;
  now: number;
}

export function validateWarDeclaration(c: WarDeclarationContext): RuleResult {
  if (c.attackerId === c.defenderId) return no("A nation cannot declare war on itself.");
  if (!c.defenderExists) return no("Target nation does not exist.");
  if (c.sameAlliance) return no("Allies cannot declare war on each other.");
  if (c.activeWarBetween) return no("These nations are already at war.");
  if (c.attackerActiveWars >= WAR.maxActiveWarsPerNation) {
    return no(`A nation may fight at most ${WAR.maxActiveWarsPerNation} wars at once.`);
  }
  if (c.lastWarBetweenEndedAt !== null && c.now - c.lastWarBetweenEndedAt < WAR.rematchCooldownSeconds) {
    return no("Peace treaty in effect: 72 hours must pass before these nations fight again.");
  }
  return ok;
}

/** Metrics captured for one side at war start and at war end. */
export interface WarSideMetrics {
  citizensStart: number;
  citizensEnd: number;
  marketCapStartEth: number;
  marketCapEndEth: number;
  /** Trading volume (ETH) during the war window. */
  warVolumeEth: number;
  economicPowerEnd: number;
  defensivePowerEnd: number;
  allies: number;
}

export interface WarScoreBreakdown {
  growth: number;
  momentum: number;
  activity: number;
  economy: number;
  defense: number;
  allianceBonus: number;
  total: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const r2 = (x: number) => Math.round(x * 100) / 100;

/**
 * War score (0..~110). Weights: population growth 30, market momentum 25, trading activity 25,
 * economic power 20; the defender adds a defensive bonus of up to 10. Allies add 2% each (max 10%).
 */
export function warScore(m: WarSideMetrics, isDefender: boolean): WarScoreBreakdown {
  const growthRaw = m.citizensStart > 0 ? m.citizensEnd / m.citizensStart - 1 : m.citizensEnd > 0 ? 1 : 0;
  const momentumRaw = m.marketCapStartEth > 0 ? m.marketCapEndEth / m.marketCapStartEth - 1 : 0;
  const growth = 30 * ((clamp(growthRaw, -0.5, 1) + 0.5) / 1.5);
  const momentum = 25 * ((clamp(momentumRaw, -0.5, 1) + 0.5) / 1.5);
  const activity = 25 * logScore(m.warVolumeEth, 0.001, 1_000);
  const economy = 20 * (m.economicPowerEnd / 100);
  const defense = isDefender ? 10 * (m.defensivePowerEnd / 100) : 0;
  const subtotal = growth + momentum + activity + economy + defense;
  const allyPct = Math.min(ALLIANCE.maxWarScoreBonusPct, m.allies * ALLIANCE.warScoreBonusPctPerAlly);
  const allianceBonus = subtotal * (allyPct / 100);
  return {
    growth: r2(growth),
    momentum: r2(momentum),
    activity: r2(activity),
    economy: r2(economy),
    defense: r2(defense),
    allianceBonus: r2(allianceBonus),
    total: r2(subtotal + allianceBonus),
  };
}

export interface WarResult {
  attacker: WarScoreBreakdown;
  defender: WarScoreBreakdown;
  winner: "attacker" | "defender";
  /** Influence transferred: winner gains `spoils`, loser loses `spoils / 2` (floored, not below zero). */
  spoils: number;
}

export function resolveWar(attacker: WarSideMetrics, defender: WarSideMetrics, loserInfluence: number): WarResult {
  const a = warScore(attacker, false);
  const d = warScore(defender, true);
  const winner = a.total > d.total ? "attacker" : "defender"; // ties go to the defender
  const spoils = Math.max(WAR.minSpoils, Math.floor((loserInfluence * WAR.spoilsPct) / 100));
  return { attacker: a, defender: d, winner, spoils };
}

// ---------------------------------------------------------------------------------------------
// Alliances
// ---------------------------------------------------------------------------------------------

export interface AllianceMembershipContext {
  currentAllianceId: number | null;
}

export function validateCreateAlliance(c: AllianceMembershipContext & { name: string }): RuleResult {
  if (c.currentAllianceId !== null) return no("Leave your current alliance before founding a new one.");
  if (c.name.trim().length < 2) return no("Alliance name too short.");
  return ok;
}

export function validateInvite(c: {
  inviterAllianceId: number | null;
  inviterIsLeader: boolean;
  inviteeExists: boolean;
  inviteeAllianceId: number | null;
  memberCount: number;
}): RuleResult {
  if (c.inviterAllianceId === null || !c.inviterIsLeader) return no("Only an alliance's leading nation can invite.");
  if (!c.inviteeExists) return no("Invited nation does not exist.");
  if (c.inviteeAllianceId === c.inviterAllianceId) return no("Nation is already a member.");
  if (c.memberCount >= ALLIANCE.maxMembers) return no(`Alliances are limited to ${ALLIANCE.maxMembers} members.`);
  return ok;
}

export function validateJoin(c: {
  allianceExists: boolean;
  allianceActive: boolean;
  currentAllianceId: number | null;
  invitedAt: number | null;
  memberCount: number;
  now: number;
  atWarWithMember: boolean;
}): RuleResult {
  if (!c.allianceExists || !c.allianceActive) return no("Alliance does not exist or has dissolved.");
  if (c.currentAllianceId !== null) return no("Leave your current alliance first.");
  if (c.invitedAt === null || c.now - c.invitedAt > ALLIANCE.inviteTtlSeconds) {
    return no("No valid invitation from this alliance (invitations expire after 14 days).");
  }
  if (c.memberCount >= ALLIANCE.maxMembers) return no("Alliance is full.");
  if (c.atWarWithMember) return no("Cannot join an alliance with a nation you are at war with.");
  return ok;
}

export function validateLeave(c: { currentAllianceId: number | null; allianceId: number }): RuleResult {
  if (c.currentAllianceId !== c.allianceId) return no("Nation is not a member of this alliance.");
  return ok;
}
