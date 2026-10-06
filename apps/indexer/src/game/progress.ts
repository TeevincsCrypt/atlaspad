import type { Sql, TransactionSql } from "postgres";
import { ACHIEVEMENT_BY_CODE, XP, type NewsItem } from "@atlaspad/shared";
import { createEvent, upper } from "./news";

type Db = Sql | TransactionSql;

/** Award XP once per (address, ref). */
export async function awardXp(db: Db, address: string, ref: string, amount: number, reason: string, at: number) {
  await db`
    INSERT INTO game_citizen_xp (address, ref, amount, reason, at)
    VALUES (${address.toLowerCase()}, ${ref}, ${amount}, ${reason}, ${at})
    ON CONFLICT DO NOTHING`;
}

/** Unlock a citizen achievement once; awards achievement XP. Returns true if newly unlocked. */
export async function unlockCitizenAchievement(
  db: Db,
  address: string,
  code: string,
  nationId: number | null,
  at: number,
): Promise<boolean> {
  const rows = await db`
    INSERT INTO game_citizen_achievements (address, code, nation_id, unlocked_at)
    VALUES (${address.toLowerCase()}, ${code}, ${nationId}, ${at})
    ON CONFLICT DO NOTHING RETURNING code`;
  if (!rows.length) return false;
  await awardXp(db, address, `ach:${code}`, XP.achievement, `Achievement: ${ACHIEVEMENT_BY_CODE[code]?.name ?? code}`, at);
  return true;
}

/** Unlock a nation achievement once and publish it to ATLAS NEWS. */
export async function unlockNationAchievement(
  db: Db,
  nationId: number,
  nationName: string,
  code: string,
  at: number,
  extra: { txHash?: string | null; blockNumber?: number | null } = {},
): Promise<NewsItem | null> {
  const rows = await db`
    INSERT INTO game_nation_achievements (nation_id, code, unlocked_at)
    VALUES (${nationId}, ${code}, ${at})
    ON CONFLICT DO NOTHING RETURNING code`;
  if (!rows.length) return null;
  const def = ACHIEVEMENT_BY_CODE[code];
  return createEvent(db, {
    type: "ACHIEVEMENT",
    nationId,
    title: `${def?.icon ?? "🏅"} ${upper(nationName)} unlocked “${def?.name ?? code}”.`,
    body: def?.description ?? "",
    data: { code },
    txHash: extra.txHash ?? null,
    blockNumber: extra.blockNumber ?? null,
    createdAt: at,
    dedupeKey: `nation-ach:${nationId}:${code}`,
  });
}
