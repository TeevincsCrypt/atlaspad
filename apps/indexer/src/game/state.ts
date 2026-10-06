import type { Sql, TransactionSql } from "postgres";
import { WAR, type BuildingType, type NationGameState } from "@atlaspad/shared";

type Db = Sql | TransactionSql;

export interface LoadedGameState extends NationGameState {
  allianceId: number | null;
  warBonusPct: number;
  resources: { influence: number; culture: number; energy: number; materials: number };
  statuses: { type: string; until: number }[];
  lastFired: Record<string, number>;
}

/** Game state needed for stats, for each requested nation (defaults for nations without a game row). */
export async function loadGameStates(db: Db, ids: number[], now: number): Promise<Map<number, LoadedGameState>> {
  const out = new Map<number, LoadedGameState>();
  if (!ids.length) return out;
  const rows = await db`
    SELECT g.nation_id, g.influence, g.culture, g.energy, g.materials, g.war_wins, g.alliance_id,
      g.war_territory_bonus_until, g.statuses, g.last_fired,
      COALESCE((SELECT array_agg(b.type) FROM game_buildings b WHERE b.nation_id = g.nation_id AND b.status = 'complete'), '{}') AS built,
      (SELECT count(*) FROM game_alliance_members m WHERE m.alliance_id = g.alliance_id AND m.left_at IS NULL) AS members
    FROM game_nations g WHERE g.nation_id = ANY(${ids})`;
  for (const r of rows) {
    const bonusUntil = r.war_territory_bonus_until === null ? 0 : Number(r.war_territory_bonus_until);
    out.set(Number(r.nation_id), {
      buildings: new Set(((r.built as number[]) ?? []).map(Number) as BuildingType[]),
      influence: Number(r.influence),
      warWins: Number(r.war_wins),
      allies: r.alliance_id === null ? 0 : Math.max(0, Number(r.members) - 1),
      allianceId: r.alliance_id === null ? null : Number(r.alliance_id),
      warBonusPct: bonusUntil > now ? WAR.territoryBonusPct : 0,
      resources: {
        influence: Number(r.influence),
        culture: Number(r.culture),
        energy: Number(r.energy),
        materials: Number(r.materials),
      },
      statuses: (r.statuses as { type: string; until: number }[]) ?? [],
      lastFired: (r.last_fired as Record<string, number>) ?? {},
    });
  }
  for (const id of ids) {
    if (!out.has(id)) {
      out.set(id, {
        buildings: new Set(),
        influence: 0,
        warWins: 0,
        allies: 0,
        allianceId: null,
        warBonusPct: 0,
        resources: { influence: 0, culture: 0, energy: 0, materials: 0 },
        statuses: [],
        lastFired: {},
      });
    }
  }
  return out;
}

/** Make sure every nation has a game row. */
export async function ensureGameRows(db: Db, ids: number[]) {
  if (!ids.length) return;
  await db`INSERT INTO game_nations ${db(ids.map((id) => ({ nation_id: id })))} ON CONFLICT DO NOTHING`;
}

/** Recompute world ranks (civilization score, then market cap, then age). Returns nations whose rank changed. */
export async function recomputeRanks(db: Db): Promise<{ id: number; rank: number; previousRank: number | null }[]> {
  const rows = await db`
    WITH ranked AS (
      SELECT nation_id, row_number() OVER (ORDER BY civilization_score DESC, market_cap_eth DESC NULLS LAST, nation_id ASC) AS new_rank
      FROM game_nations
    )
    UPDATE game_nations g
    SET previous_rank = g.rank, rank = r.new_rank
    FROM ranked r
    WHERE g.nation_id = r.nation_id AND g.rank IS DISTINCT FROM r.new_rank
    RETURNING g.nation_id, g.rank, g.previous_rank`;
  return rows.map((r) => ({
    id: Number(r.nation_id),
    rank: Number(r.rank),
    previousRank: r.previous_rank === null ? null : Number(r.previous_rank),
  }));
}
