import type { Sql, TransactionSql } from "postgres";
import { EVENT_TYPES, type EventType, type NewsItem } from "@atlaspad/shared";

type Db = Sql | TransactionSql;

export interface NewEvent {
  type: EventType;
  nationId: number | null;
  targetNationId?: number | null;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  txHash?: string | null;
  blockNumber?: number | null;
  createdAt: number;
  dedupeKey: string;
}

/** Insert a world event once (idempotent by dedupe key). Returns the stored row, or null if it existed. */
export async function createEvent(db: Db, e: NewEvent): Promise<NewsItem | null> {
  const severity = EVENT_TYPES[e.type].severity;
  const rows = await db`
    INSERT INTO game_events (type, severity, nation_id, target_nation_id, title, body, data, tx_hash, block_number, created_at, dedupe_key)
    VALUES (${e.type}, ${severity}, ${e.nationId}, ${e.targetNationId ?? null}, ${e.title}, ${e.body},
            ${db.json((e.data ?? {}) as never)}, ${e.txHash ?? null}, ${e.blockNumber ?? null}, ${e.createdAt}, ${e.dedupeKey})
    ON CONFLICT (dedupe_key) DO NOTHING
    RETURNING *`;
  const row = rows[0];
  if (!row) return null;
  return hydrateNews(db, row);
}

export async function hydrateNews(db: Db, row: Record<string, unknown>): Promise<NewsItem> {
  const ids = [row.nation_id, row.target_nation_id].filter((v) => v !== null) as number[];
  const names = new Map<number, { name: string; ticker: string }>();
  if (ids.length) {
    const rows = await db`SELECT id, name, ticker FROM nations WHERE id = ANY(${ids})`;
    for (const r of rows) names.set(Number(r.id), { name: r.name as string, ticker: r.ticker as string });
  }
  const n = row.nation_id === null ? null : names.get(Number(row.nation_id));
  const t = row.target_nation_id === null ? null : names.get(Number(row.target_nation_id));
  return {
    id: Number(row.id),
    type: row.type as string,
    severity: row.severity as NewsItem["severity"],
    nationId: row.nation_id === null ? null : Number(row.nation_id),
    nationName: n?.name ?? null,
    ticker: n?.ticker ?? null,
    targetNationId: row.target_nation_id === null ? null : Number(row.target_nation_id),
    targetNationName: t?.name ?? null,
    title: row.title as string,
    body: row.body as string,
    data: (row.data as Record<string, unknown>) ?? {},
    txHash: (row.tx_hash as string | null) ?? null,
    createdAt: Number(row.created_at),
  };
}

export const upper = (s: string) => s.toUpperCase();
