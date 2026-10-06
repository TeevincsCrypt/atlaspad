import {
  CITIZEN_MILESTONES,
  MCAP_MILESTONES_ETH,
  computeStats,
  crossedMilestones,
  formatEth,
  formatInt,
  type NewsItem,
} from "@atlaspad/shared";
import type { Ctx } from "../context";
import { createEvent, upper } from "../game/news";
import { unlockNationAchievement } from "../game/progress";
import { ensureGameRows, loadGameStates } from "../game/state";
import { citizenThreshold, nationLiquidity, nationMarketCap, nationPrice, openingPrice, type NationCache } from "./nations";

const WAD = 1e18;

/**
 * Recompute live market metrics, citizens, treasury and stats for the given nations from the on-chain mirror.
 * `now` is the timestamp of the latest indexed block (never wall-clock), so results are reproducible.
 */
export async function refreshNationMetrics(ctx: Ctx, cache: NationCache, ids: number[], now: number): Promise<NewsItem[]> {
  if (!ids.length) return [];
  const sql = ctx.sql;
  await ensureGameRows(sql, ids);
  const news: NewsItem[] = [];

  const [prevRows, volRows, treasuryRows, ref1h, ref24h, citizens24h, maxRows, stateRow] = await Promise.all([
    sql`SELECT nation_id, citizens, market_cap_eth, ath_market_cap_eth, ath_liquidity_eth FROM game_nations WHERE nation_id = ANY(${ids})`,
    sql`SELECT nation_id, COALESCE(sum(eth_amount), 0) AS vol, count(*) AS cnt FROM trades
        WHERE nation_id = ANY(${ids}) AND timestamp > ${now - 86400} GROUP BY nation_id`,
    sql`SELECT nation_id, COALESCE(sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS bal
        FROM treasury_txs WHERE nation_id = ANY(${ids}) GROUP BY nation_id`,
    sql`SELECT i AS nation_id, (SELECT price_eth FROM trades t WHERE t.nation_id = i AND t.timestamp <= ${now - 3600}
          ORDER BY t.timestamp DESC, t.log_index DESC LIMIT 1) AS price FROM unnest(${ids}::int[]) AS i`,
    sql`SELECT i AS nation_id, (SELECT price_eth FROM trades t WHERE t.nation_id = i AND t.timestamp <= ${now - 86400}
          ORDER BY t.timestamp DESC, t.log_index DESC LIMIT 1) AS price FROM unnest(${ids}::int[]) AS i`,
    sql`SELECT i AS nation_id, (SELECT citizens FROM game_snapshots s WHERE s.nation_id = i AND s.epoch <= ${now - 86400}
          ORDER BY s.epoch DESC LIMIT 1) AS citizens FROM unnest(${ids}::int[]) AS i`,
    sql`SELECT nation_id, max(market_cap_eth) AS mcap, max(liquidity_eth) AS liq FROM trades WHERE nation_id = ANY(${ids}) GROUP BY nation_id`,
    sql`SELECT eth_usd FROM indexer_state WHERE id = 'main'`,
  ]);
  const ethUsd = stateRow[0]?.eth_usd === null || stateRow[0] === undefined ? null : Number(stateRow[0].eth_usd);
  const map = <T>(rows: readonly Record<string, unknown>[], f: (r: Record<string, unknown>) => T) =>
    new Map(rows.map((r) => [Number(r.nation_id), f(r)]));
  const prev = map(prevRows, (r) => r);
  const vol = map(volRows, (r) => ({ vol: Number(r.vol) / WAD, cnt: Number(r.cnt) }));
  const treasury = map(treasuryRows, (r) => Number(r.bal) / WAD);
  const p1h = map(ref1h, (r) => (r.price === null ? null : Number(r.price)));
  const p24h = map(ref24h, (r) => (r.price === null ? null : Number(r.price)));
  const c24 = map(citizens24h, (r) => (r.citizens === null ? null : Number(r.citizens)));
  const maxes = map(maxRows, (r) => ({ mcap: Number(r.mcap), liq: Number(r.liq) }));
  const states = await loadGameStates(sql, ids, now);

  for (const id of ids) {
    const n = cache.byId.get(id);
    if (!n || n.virtualTokens === 0n) continue;
    const threshold = citizenThreshold(n);
    const excluded = [...ctx.excluded.keys(), n.pair.toLowerCase()];
    const [{ count }] = (await sql`
      SELECT count(*)::int AS count FROM holders
      WHERE nation_id = ${id} AND balance >= ${threshold.toString()} AND address <> ALL(${excluded})`) as unknown as [{ count: number }];

    const price = nationPrice(n);
    const mcap = nationMarketCap(n);
    const liquidity = nationLiquidity(n);
    const opening = openingPrice(n);
    // With no trade before the window start, the reference is the curve's opening price (change since founding).
    const change1h = price === null ? null : price / (p1h.get(id) ?? opening) - 1;
    const change24h = price === null ? null : price / (p24h.get(id) ?? opening) - 1;
    const v = vol.get(id) ?? { vol: 0, cnt: 0 };
    const pr = prev.get(id) as Record<string, unknown> | undefined;
    const athM = Math.max(Number(pr?.ath_market_cap_eth ?? 0), maxes.get(id)?.mcap ?? 0, mcap ?? 0);
    const athL = Math.max(Number(pr?.ath_liquidity_eth ?? 0), maxes.get(id)?.liq ?? 0, liquidity);
    const state = states.get(id)!;
    const stats = computeStats(
      { marketCapEth: mcap ?? 0, liquidityEth: liquidity, volume24hEth: v.vol, citizens: count },
      state,
      state.warBonusPct,
    );

    await sql`
      UPDATE game_nations SET
        price_eth = ${price}, market_cap_eth = ${mcap}, liquidity_eth = ${liquidity},
        volume_24h_eth = ${v.vol}, trades_24h = ${v.cnt}, change_1h = ${change1h}, change_24h = ${change24h},
        ath_market_cap_eth = ${athM}, ath_liquidity_eth = ${athL}, treasury_eth = ${treasury.get(id) ?? 0},
        citizens = ${count}, citizens_24h_ago = ${c24.get(id) ?? null},
        economic_power = ${stats.economicPower}, military_power = ${stats.militaryPower},
        defensive_power = ${stats.defensivePower}, influence_score = ${stats.influenceScore},
        population_score = ${stats.populationScore}, development_score = ${stats.developmentScore},
        civilization_score = ${stats.civilizationScore}, tier = ${stats.tier}, territory_cells = ${stats.territoryCells},
        updated_at = ${now}
      WHERE nation_id = ${id}`;

    // Milestones — each fires once per nation, ever.
    const prevCitizens = Number(pr?.citizens ?? 0);
    for (const m of crossedMilestones(prevCitizens, count, CITIZEN_MILESTONES)) {
      const item = await createEvent(sql, {
        type: "CITIZEN_MILESTONE",
        nationId: id,
        title: `👥 ${upper(n.name)} reached ${formatInt(m)} citizens.`,
        body: `${formatInt(count)} wallets now hold $${n.ticker} above the citizenship threshold.`,
        data: { milestone: m, citizens: count },
        createdAt: now,
        dedupeKey: `citizens:${id}:${m}`,
      });
      if (item) news.push(item);
      const code = m === 100 ? "CITIZENS_100" : m === 1000 ? "CITIZENS_1000" : m === 10000 ? "CITIZENS_10000" : null;
      if (code) {
        const a = await unlockNationAchievement(sql, id, n.name, code, now);
        if (a) news.push(a);
      }
    }
    const prevMcap = Number(pr?.ath_market_cap_eth ?? 0);
    if (mcap !== null) {
      for (const m of crossedMilestones(prevMcap, mcap, MCAP_MILESTONES_ETH)) {
        const item = await createEvent(sql, {
          type: "MCAP_MILESTONE",
          nationId: id,
          title: `💰 ${upper(n.name)} reached a ${formatEth(m)} economy.`,
          body: `Market cap of $${n.ticker} crossed ${formatEth(m)} for the first time.`,
          data: { milestoneEth: m, marketCapEth: mcap },
          createdAt: now,
          dedupeKey: `mcap:${id}:${m}`,
        });
        if (item) news.push(item);
        if (m === 100) {
          const a = await unlockNationAchievement(sql, id, n.name, "MCAP_100_ETH", now);
          if (a) news.push(a);
        }
      }
      if (ethUsd !== null && mcap * ethUsd >= 1_000_000) {
        const a = await unlockNationAchievement(sql, id, n.name, "MCAP_1M_USD", now);
        if (a) news.push(a);
      }
    }
  }
  return news;
}
