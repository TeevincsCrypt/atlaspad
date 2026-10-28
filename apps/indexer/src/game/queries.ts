import type { Sql, TransactionSql } from "postgres";

type Db = Sql | TransactionSql;
const WAD = 1e18;

/** Citizen addresses of a nation as of time `t` (inclusive), derived from the transfer history. */
export async function citizensAsOf(db: Db, nationId: number, t: number, threshold: bigint, excluded: string[]): Promise<string[]> {
  const rows = await db`
    SELECT address FROM (
      SELECT to_address AS address, amount AS delta FROM transfers WHERE nation_id = ${nationId} AND timestamp <= ${t}
      UNION ALL
      SELECT from_address AS address, -amount AS delta FROM transfers WHERE nation_id = ${nationId} AND timestamp <= ${t}
    ) d
    WHERE address <> ALL(${excluded})
    GROUP BY address HAVING sum(delta) >= ${threshold.toString()}`;
  return rows.map((r) => r.address as string);
}

export async function citizenCountAsOf(db: Db, nationId: number, t: number, threshold: bigint, excluded: string[]): Promise<number> {
  const [r] = await db`
    SELECT count(*)::int AS c FROM (
      SELECT address FROM (
        SELECT to_address AS address, amount AS delta FROM transfers WHERE nation_id = ${nationId} AND timestamp <= ${t}
        UNION ALL
        SELECT from_address AS address, -amount AS delta FROM transfers WHERE nation_id = ${nationId} AND timestamp <= ${t}
      ) d
      WHERE address <> ALL(${excluded})
      GROUP BY address HAVING sum(delta) >= ${threshold.toString()}
    ) x`;
  return Number(r?.c ?? 0);
}

/** Last trade at or before `t`: price, market cap and liquidity after that trade. */
export async function lastTradeAsOf(db: Db, nationId: number, t: number) {
  const [r] = await db`
    SELECT price_wif, market_cap_wif, liquidity_wif FROM trades
    WHERE nation_id = ${nationId} AND timestamp <= ${t}
    ORDER BY timestamp DESC, log_index DESC LIMIT 1`;
  if (!r) return null;
  return { priceWif: Number(r.price_wif), marketCapWif: Number(r.market_cap_wif), liquidityWif: Number(r.liquidity_wif) };
}

export async function volumeBetween(db: Db, nationId: number, from: number, to: number): Promise<{ eth: number; trades: number }> {
  const [r] = await db`
    SELECT COALESCE(sum(wif_amount), 0) AS v, count(*)::int AS c FROM trades
    WHERE nation_id = ${nationId} AND timestamp >= ${from} AND timestamp < ${to}`;
  return { eth: Number(r?.v ?? 0) / WAD, trades: Number(r?.c ?? 0) };
}

export async function forVoters(db: Db, proposalId: number): Promise<string[]> {
  const rows = await db`SELECT voter FROM votes WHERE proposal_id = ${proposalId} AND support = 1`;
  return rows.map((r) => r.voter as string);
}
