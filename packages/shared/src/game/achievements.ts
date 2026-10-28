import { WIF_MARKET_UNIT } from "./constants";

/** Achievements and citizen progression. Earned through participation, never purchasable. */

export interface AchievementDef {
  code: string;
  scope: "nation" | "citizen";
  icon: string;
  name: string;
  description: string;
  rarity: "common" | "rare" | "epic" | "legendary";
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // Nation achievements
  { code: "NATION_FOUNDED", scope: "nation", icon: "🏳️", name: "A Nation Is Born", description: "Founded on AtlasPad.", rarity: "common" },
  { code: "CITIZENS_100", scope: "nation", icon: "👥", name: "Township", description: "Reached 100 citizens.", rarity: "common" },
  { code: "CITIZENS_1000", scope: "nation", icon: "🏙️", name: "Thriving City", description: "Reached 1,000 citizens.", rarity: "rare" },
  { code: "CITIZENS_10000", scope: "nation", icon: "🌆", name: "Great Nation", description: "Reached 10,000 citizens.", rarity: "epic" },
  { code: "GRADUATED", scope: "nation", icon: "🌐", name: "World Markets", description: "Sold out the founding curve and joined Uniswap.", rarity: "rare" },
  { code: "MCAP_100_UNITS", scope: "nation", icon: "💰", name: "Economic Power", description: `Reached a ${(100 * WIF_MARKET_UNIT).toLocaleString("en-US")} $WIF market cap.`, rarity: "epic" },
  { code: "MCAP_1M_USD", scope: "nation", icon: "💎", name: "Millionaire Economy", description: "Reached a $1M market cap.", rarity: "epic" },
  { code: "FIRST_BUILDING", scope: "nation", icon: "🏗️", name: "First Stone", description: "Completed its first building.", rarity: "common" },
  { code: "FIRST_MONUMENT", scope: "nation", icon: "🗼", name: "Wonder of the World", description: "Built its first monument.", rarity: "rare" },
  { code: "SPACEFARING", scope: "nation", icon: "🚀", name: "Spacefaring", description: "Completed a Spaceport.", rarity: "legendary" },
  { code: "FIRST_VICTORY", scope: "nation", icon: "⚔️", name: "First Victory", description: "Won its first war.", rarity: "rare" },
  { code: "JOINED_ALLIANCE", scope: "nation", icon: "🤝", name: "Diplomacy", description: "Joined or founded an alliance.", rarity: "common" },
  { code: "GOLDEN_AGE", scope: "nation", icon: "👑", name: "Golden Age", description: "Entered a Golden Age.", rarity: "epic" },
  { code: "SURVIVED_CRISIS", scope: "nation", icon: "🌦️", name: "Resilient", description: "7+ days after an economic crisis: still 10+ citizens and traded in the past week.", rarity: "rare" },
  { code: "SURVIVED_30_DAYS", scope: "nation", icon: "📅", name: "Enduring", description: "Active with 10+ citizens 30 days after founding.", rarity: "common" },
  { code: "EMPIRE", scope: "nation", icon: "🏛️", name: "Empire", description: "Reached the Empire tier.", rarity: "legendary" },
  // Citizen achievements
  { code: "FOUNDER", scope: "citizen", icon: "🏛️", name: "Founder", description: "Founded your first nation.", rarity: "rare" },
  { code: "FIRST_CITIZENSHIP", scope: "citizen", icon: "🪪", name: "Citizen", description: "Became a citizen of a nation.", rarity: "common" },
  { code: "WORLD_CITIZEN", scope: "citizen", icon: "🌎", name: "World Citizen", description: "Citizen of 5 nations at once.", rarity: "rare" },
  { code: "EARLY_SETTLER", scope: "citizen", icon: "⛺", name: "Early Settler", description: "Became a citizen within 24h of a nation's founding.", rarity: "common" },
  { code: "FIRST_VOTE", scope: "citizen", icon: "🗳️", name: "Voice of the People", description: "Cast your first governance vote.", rarity: "common" },
  { code: "FIRST_PROPOSAL", scope: "citizen", icon: "📜", name: "Statesman", description: "Created your first proposal.", rarity: "common" },
  { code: "WAR_VETERAN", scope: "citizen", icon: "⚔️", name: "War Veteran", description: "Voted for a war declaration that was enacted.", rarity: "rare" },
  { code: "DIPLOMAT", scope: "citizen", icon: "🌎", name: "Diplomat", description: "Voted for an alliance decree that was enacted.", rarity: "rare" },
  { code: "INDUSTRIALIST", scope: "citizen", icon: "💰", name: "Industrialist", description: "Voted for 3 building decrees that were enacted.", rarity: "rare" },
  { code: "SPACE_PIONEER", scope: "citizen", icon: "🚀", name: "Space Pioneer", description: "Citizen of a nation when its Spaceport was completed.", rarity: "epic" },
  { code: "EMPEROR", scope: "citizen", icon: "👑", name: "Emperor", description: "Founded a nation that reached the Empire tier.", rarity: "legendary" },
] as const;

export const ACHIEVEMENT_BY_CODE: Record<string, AchievementDef> = Object.fromEntries(
  ACHIEVEMENTS.map((a) => [a.code, a]),
);

export const XP = {
  foundNation: 500,
  newCitizenship: 50,
  vote: 25,
  proposal: 50,
  proposalEnacted: 100,
  achievement: 100,
  /** Per nation per full day of citizenship, capped at 30 days per nation. */
  citizenshipDay: 5,
  citizenshipDayCap: 30,
} as const;

export const CITIZEN_RANKS = [
  { minXp: 0, title: "Settler" },
  { minXp: 500, title: "Citizen" },
  { minXp: 2_000, title: "Statesman" },
  { minXp: 10_000, title: "Legend" },
] as const;

export function citizenRank(xp: number): string {
  let title: string = CITIZEN_RANKS[0].title;
  for (const r of CITIZEN_RANKS) if (xp >= r.minXp) title = r.title;
  return title;
}

/** Titles shown on a citizen profile, derived from achievements. */
export const TITLE_ACHIEVEMENTS: Record<string, string> = {
  FOUNDER: "🏛️ Founder",
  WAR_VETERAN: "⚔️ War Veteran",
  DIPLOMAT: "🌎 Diplomat",
  INDUSTRIALIST: "💰 Industrialist",
  SPACE_PIONEER: "🚀 Space Pioneer",
  EMPEROR: "👑 Emperor",
};
