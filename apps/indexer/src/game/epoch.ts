import {
  EPOCH_SECONDS,
  EVENT_TYPES,
  computeStats,
  detectMarketEvents,
  epochProduction,
  formatPct,
  formatWif,
  formatInt,
  type DetectedEvent,
  type MarketSnapshot,
} from "@atlaspad/shared";
import { applyResources, citizenThreshold, excludedFor, type GameCtx } from "./common";
import { createEvent, upper } from "./news";
import { unlockCitizenAchievement, unlockNationAchievement } from "./progress";
import { citizenCountAsOf, lastTradeAsOf } from "./queries";
import { loadGameStates } from "./state";

const WAD = 1e18;

function headline(type: string, name: string, d: DetectedEvent["data"]): { title: string; body: string } {
  const N = upper(name);
  switch (type) {
    case "ECONOMIC_BOOM":
      return { title: `🚀 ${N} is in an Economic Boom.`, body: `Price up ${formatPct(Number(d.change1h))} in the last hour.` };
    case "MARKET_CRASH":
      return { title: `📉 ${N}'s market crashed.`, body: `Price down ${formatPct(Number(d.change1h))} in the last hour.` };
    case "GOLDEN_AGE":
      return { title: `👑 ${N} has entered a Golden Age.`, body: `A new all-time high economy of ${formatWif(Number(d.marketCapWif))}, up ${formatPct(Number(d.change24h))} in 24 hours.` };
    case "ECONOMIC_CRISIS":
      return { title: `🌩️ ${N} entered an Economic Crisis.`, body: `Price down ${formatPct(Number(d.change24h))} in 24 hours.` };
    case "RECORD_HIGH":
      return { title: `📈 ${N}'s economy hit a record high.`, body: `Market cap reached ${formatWif(Number(d.marketCapWif))}.` };
    case "POPULATION_EXPLOSION":
      return { title: `👥 ${N} gained ${formatInt(Number(d.gained))} citizens.`, body: `Population explosion: ${formatInt(Number(d.citizens))} citizens now.` };
    case "TRADE_FESTIVAL":
      return { title: `🔥 A Trade Festival broke out in ${N}.`, body: `${formatWif(Number(d.volume1hWif))} traded in a single hour.` };
    case "BANKING_CRISIS":
      return { title: `⚠️ ${N} is in a Banking Crisis.`, body: `Liquidity fell to ${formatWif(Number(d.liquidityWif))} from ${formatWif(Number(d.liquidity24hAgoWif))} a day ago.` };
    case "NATIONAL_EMERGENCY":
      return { title: `☠️ ${N} declared a National Emergency.`, body: `Liquidity collapsed to ${formatWif(Number(d.liquidityWif))} (peak ${formatWif(Number(d.athLiquidityWif))}).` };
    default:
      return { title: `${EVENT_TYPES[type as keyof typeof EVENT_TYPES]?.icon ?? "📰"} ${N}`, body: "" };
  }
}

/**
 * One hourly epoch at boundary `E`: snapshot every nation's state as of E (from the on-chain mirror), detect
 * market events, accrue resources and update time-based achievements.
 */
export async function tickEpoch(g: GameCtx, E: number): Promise<void> {
  const sql = g.ctx.sql;
  const nations = [...g.cache.byId.values()].filter((n) => n.createdAt < E);
  if (!nations.length) return;
  const ids = nations.map((n) => n.id);
  const states = await loadGameStates(sql, ids, E);
  const [wifUsdRow] = await sql`SELECT wif_usd FROM indexer_state WHERE id = 'main'`;
  const wifUsd = wifUsdRow?.wif_usd === null || wifUsdRow?.wif_usd === undefined ? null : Number(wifUsdRow.wif_usd);
  const hourStart = E - EPOCH_SECONDS;

  const snaps = await sql`
    SELECT * FROM game_snapshots WHERE nation_id = ANY(${ids}) AND epoch IN (${hourStart}, ${E - 86400})`;
  const snapOf = (id: number, epoch: number) => snaps.find((s) => Number(s.nation_id) === id && Number(s.epoch) === epoch);
  const windowTrades = await sql`
    SELECT nation_id, COALESCE(sum(wif_amount), 0) AS vol, count(*)::int AS cnt FROM trades
    WHERE nation_id = ANY(${ids}) AND timestamp >= ${hourStart} AND timestamp < ${E} GROUP BY nation_id`;
  const windowTransfers = await sql`
    SELECT DISTINCT nation_id FROM transfers WHERE nation_id = ANY(${ids}) AND timestamp >= ${hourStart} AND timestamp < ${E}`;
  const votes = await sql`
    SELECT nation_id, count(*)::int AS c FROM votes WHERE nation_id = ANY(${ids}) AND timestamp >= ${hourStart} AND timestamp < ${E} GROUP BY nation_id`;
  const treasury = await sql`
    SELECT nation_id, COALESCE(sum(CASE WHEN direction = 'in' THEN amount ELSE -amount END), 0) AS bal
    FROM treasury_txs WHERE nation_id = ANY(${ids}) AND timestamp < ${E} GROUP BY nation_id`;
  const vol24 = await sql`
    SELECT nation_id, COALESCE(sum(volume_1h_wif), 0) AS v FROM game_snapshots
    WHERE nation_id = ANY(${ids}) AND epoch > ${E - 86400} AND epoch < ${E} GROUP BY nation_id`;
  const aths = await sql`
    SELECT nation_id, max(market_cap_wif) AS mcap, max(liquidity_wif) AS liq FROM game_snapshots
    WHERE nation_id = ANY(${ids}) AND epoch < ${E} GROUP BY nation_id`;
  const by = <T>(rows: readonly Record<string, unknown>[], f: (r: Record<string, unknown>) => T) =>
    new Map(rows.map((r) => [Number(r.nation_id), f(r)]));
  const wTrades = by(windowTrades, (r) => ({ vol: Number(r.vol) / WAD, cnt: Number(r.cnt) }));
  const wTransfers = new Set(windowTransfers.map((r) => Number(r.nation_id)));
  const wVotes = by(votes, (r) => Number(r.c));
  const tBal = by(treasury, (r) => Number(r.bal) / WAD);
  const v24 = by(vol24, (r) => Number(r.v));
  const ath = by(aths, (r) => ({ mcap: Number(r.mcap ?? 0), liq: Number(r.liq ?? 0) }));

  for (const n of nations) {
    const id = n.id;
    const prev = snapOf(id, hourStart);
    const day = snapOf(id, E - 86400);
    const trades = wTrades.get(id) ?? { vol: 0, cnt: 0 };
    const opening = Number(n.initialVirtualWif) / Number(n.initialVirtualTokens);
    let priceWif: number;
    let marketCapWif: number;
    let liquidityWif: number;
    if (trades.cnt > 0 || !prev) {
      const last = await lastTradeAsOf(sql, id, E - 1);
      priceWif = last?.priceWif ?? opening;
      marketCapWif = last?.marketCapWif ?? (opening * Number(n.totalSupply)) / WAD;
      liquidityWif = last?.liquidityWif ?? 0;
    } else {
      priceWif = Number(prev.price_wif);
      marketCapWif = Number(prev.market_cap_wif);
      liquidityWif = Number(prev.liquidity_wif);
    }
    const citizens =
      wTransfers.has(id) || !prev
        ? await citizenCountAsOf(sql, id, E - 1, citizenThreshold(n), excludedFor(g.ctx, n))
        : Number(prev.citizens);
    const volume24hWif = (v24.get(id) ?? 0) + trades.vol;
    const state = states.get(id)!;
    const goldenAge = state.statuses.some((s) => s.type === "GOLDEN_AGE" && s.until > E);
    const stats = computeStats({ marketCapWif, liquidityWif, volume24hWif, citizens }, state, state.warBonusPct);

    await sql`
      INSERT INTO game_snapshots (nation_id, epoch, price_wif, market_cap_wif, liquidity_wif, volume_1h_wif, volume_24h_wif,
        trades_1h, citizens, treasury_wif, civilization_score, economic_power, wif_usd)
      VALUES (${id}, ${E}, ${priceWif}, ${marketCapWif}, ${liquidityWif}, ${trades.vol}, ${volume24hWif}, ${trades.cnt},
        ${citizens}, ${tBal.get(id) ?? 0}, ${stats.civilizationScore}, ${stats.economicPower}, ${wifUsd})
      ON CONFLICT (nation_id, epoch) DO NOTHING`;

    // Market events
    const toSnap = (r: Record<string, unknown> | undefined, at: number): MarketSnapshot | null =>
      r
        ? {
            at,
            priceWif: Number(r.price_wif),
            marketCapWif: Number(r.market_cap_wif),
            liquidityWif: Number(r.liquidity_wif),
            citizens: Number(r.citizens),
            volume1hWif: Number(r.volume_1h_wif),
            volume24hWif: Number(r.volume_24h_wif),
            trades1h: Number(r.trades_1h),
          }
        : null;
    const athRow = ath.get(id);
    const detected = detectMarketEvents({
      now: { at: E, priceWif, marketCapWif, liquidityWif, citizens, volume1hWif: trades.vol, volume24hWif, trades1h: trades.cnt },
      hourAgo: toSnap(prev, hourStart),
      dayAgo: toSnap(day, E - 86400),
      previousAthMarketCapWif: athRow?.mcap ?? 0,
      athLiquidityWif: athRow?.liq ?? 0,
      graduated: n.graduatedAt !== null && n.graduatedAt < E,
      lastFired: state.lastFired,
    });
    const lastFired = { ...state.lastFired };
    let statuses = state.statuses.filter((s) => s.until > E);
    for (const ev of detected) {
      lastFired[ev.type] = E;
      if (ev.statusSeconds) {
        statuses = statuses.filter((s) => s.type !== ev.type);
        statuses.push({ type: ev.type, until: E + ev.statusSeconds });
      }
      const { title, body } = headline(ev.type, n.name, ev.data);
      const item = await createEvent(sql, {
        type: ev.type,
        nationId: id,
        title,
        body,
        data: { ...ev.data, epoch: E },
        createdAt: E,
        dedupeKey: `g:mkt:${ev.type}:${id}:${E}`,
      });
      if (item) g.news.push(item);
      if (ev.type === "GOLDEN_AGE") {
        const a = await unlockNationAchievement(sql, id, n.name, "GOLDEN_AGE", E);
        if (a) g.news.push(a);
      }
    }
    await sql`
      UPDATE game_nations SET statuses = ${sql.json(statuses)}, last_fired = ${sql.json(lastFired)}
      WHERE nation_id = ${id}`;

    // Resources
    const production = epochProduction(
      {
        citizens,
        volume1hWif: trades.vol,
        liquidityWif,
        votesCast: wVotes.get(id) ?? 0,
        economicPower: stats.economicPower,
        allies: state.allies,
        goldenAge,
      },
      state.buildings,
    );
    await applyResources(sql, id, production, E, "Hourly production", `epoch:${E}`);

    // Time-based achievements
    const unlock = async (code: string) => {
      const a = await unlockNationAchievement(sql, id, n.name, code, E);
      if (a) g.news.push(a);
    };
    if (E - n.createdAt >= 30 * 86400 && citizens >= 10) await unlock("SURVIVED_30_DAYS");
    const crisisAt = lastFired.ECONOMIC_CRISIS;
    if (crisisAt !== undefined && E - crisisAt >= 7 * 86400 && citizens >= 10) {
      const [{ c }] = (await sql`SELECT count(*)::int AS c FROM trades WHERE nation_id = ${id} AND timestamp >= ${E - 7 * 86400} AND timestamp < ${E}`) as unknown as [{ c: number }];
      if (c > 0) await unlock("SURVIVED_CRISIS");
    }
    if (stats.tier >= 4) {
      await unlock("EMPIRE");
      await unlockCitizenAchievement(sql, n.founder, "EMPEROR", id, E);
    }
    g.touched.add(id);
  }
}
