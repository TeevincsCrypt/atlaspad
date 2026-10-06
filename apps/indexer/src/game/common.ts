import type { Sql, TransactionSql } from "postgres";
import type { NewsItem, Resources } from "@atlaspad/shared";
import type { Ctx } from "../context";
import type { NationCache, NationRow } from "../sync/nations";
import { citizenThreshold } from "../sync/nations";

type Db = Sql | TransactionSql;

export interface GameCtx {
  ctx: Ctx;
  cache: NationCache;
  news: NewsItem[];
  touched: Set<number>;
}

export function excludedFor(ctx: Ctx, n: NationRow): string[] {
  return [...ctx.excluded.keys(), n.pair.toLowerCase()];
}

export { citizenThreshold };

/**
 * Apply a resource delta exactly once (keyed by `ref`) and record it in the public ledger.
 * Negative deltas are costs. Returns false if this ref was already applied.
 */
export async function applyResources(
  db: Db,
  nationId: number,
  delta: Partial<Resources>,
  at: number,
  reason: string,
  ref: string,
): Promise<boolean> {
  const d = {
    influence: Math.trunc(delta.influence ?? 0),
    culture: Math.trunc(delta.culture ?? 0),
    energy: Math.trunc(delta.energy ?? 0),
    materials: Math.trunc(delta.materials ?? 0),
  };
  const rows = await db`
    INSERT INTO game_resource_ledger (nation_id, at, influence, culture, energy, materials, reason, ref)
    VALUES (${nationId}, ${at}, ${d.influence}, ${d.culture}, ${d.energy}, ${d.materials}, ${reason}, ${ref})
    ON CONFLICT (nation_id, ref) DO NOTHING RETURNING id`;
  if (!rows.length) return false;
  await db`
    INSERT INTO game_nations (nation_id, influence, culture, energy, materials)
    VALUES (${nationId}, GREATEST(0, ${d.influence}), GREATEST(0, ${d.culture}), GREATEST(0, ${d.energy}), GREATEST(0, ${d.materials}))
    ON CONFLICT (nation_id) DO UPDATE SET
      influence = GREATEST(0, game_nations.influence + ${d.influence}),
      culture = GREATEST(0, game_nations.culture + ${d.culture}),
      energy = GREATEST(0, game_nations.energy + ${d.energy}),
      materials = GREATEST(0, game_nations.materials + ${d.materials})`;
  return true;
}

export async function getResources(db: Db, nationId: number): Promise<Resources> {
  const [r] = await db`SELECT influence, culture, energy, materials FROM game_nations WHERE nation_id = ${nationId}`;
  return {
    influence: Number(r?.influence ?? 0),
    culture: Number(r?.culture ?? 0),
    energy: Number(r?.energy ?? 0),
    materials: Number(r?.materials ?? 0),
  };
}

export async function recordAction(db: Db, proposalId: number, nationId: number, action: number, status: "applied" | "rejected", reason: string | null, at: number) {
  await db`
    INSERT INTO game_actions (proposal_id, nation_id, action, status, reason, applied_at)
    VALUES (${proposalId}, ${nationId}, ${action}, ${status}, ${reason}, ${at})
    ON CONFLICT (proposal_id) DO NOTHING`;
}
