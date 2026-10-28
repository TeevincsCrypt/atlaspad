import { nationSummaries } from "@atlaspad/db/queries";
import {
  EVENT_RULES,
  ProposalKind,
  XP,
  formatWif,
  formatCompact,
  isWhaleBuy,
  shortAddress,
  unitsToWif,
  type NewsItem,
} from "@atlaspad/shared";
import type { Ctx } from "../context";
import { createEvent, upper } from "../game/news";
import { awardXp, unlockCitizenAchievement, unlockNationAchievement } from "../game/progress";
import { recomputeRanks } from "../game/state";
import type { ApplyResult } from "./apply";
import { refreshNationMetrics } from "./metrics";
import type { NationCache } from "./nations";

/** Everything that happens after a block range is committed: news, progression, metrics, realtime. */
export async function postProcess(ctx: Ctx, cache: NationCache, r: ApplyResult, now: number): Promise<void> {
  const sql = ctx.sql;
  const news: NewsItem[] = [];
  const push = (item: NewsItem | null) => {
    if (item) news.push(item);
  };
  const name = (id: number) => cache.byId.get(id)?.name ?? `Nation #${id}`;
  const ticker = (id: number) => cache.byId.get(id)?.ticker ?? "";

  for (const f of r.founded) {
    const n = cache.byId.get(f.nationId);
    if (!n) continue;
    push(
      await createEvent(sql, {
        type: "FOUNDED",
        nationId: n.id,
        title: `🏳️ ${upper(n.name)} has been founded.`,
        body: `$${n.ticker} · founded by ${shortAddress(n.founder)}. Supply ${formatCompact(Number(n.totalSupply) / 1e18)} tokens.`,
        data: { founder: n.founder },
        txHash: f.txHash,
        blockNumber: f.blockNumber,
        createdAt: f.timestamp,
        dedupeKey: `found:${n.id}`,
      }),
    );
    push(await unlockNationAchievement(sql, n.id, n.name, "NATION_FOUNDED", f.timestamp, f));
    await awardXp(sql, n.founder, `found:${n.id}`, XP.foundNation, `Founded ${n.name}`, f.timestamp);
    await unlockCitizenAchievement(sql, n.founder, "FOUNDER", n.id, f.timestamp);
  }

  for (const g of r.graduated) {
    push(
      await createEvent(sql, {
        type: "GRADUATED",
        nationId: g.nationId,
        title: `🌐 ${upper(name(g.nationId))} joined the world markets.`,
        body: `The founding curve sold out. ${formatWif(unitsToWif(g.wifLiquidity))} of liquidity is now permanently locked in a Uniswap V2 pool for $${ticker(g.nationId)}.`,
        data: { wifLiquidity: unitsToWif(g.wifLiquidity) },
        txHash: g.txHash,
        blockNumber: g.blockNumber,
        createdAt: g.timestamp,
        dedupeKey: `graduated:${g.nationId}`,
      }),
    );
    push(await unlockNationAchievement(sql, g.nationId, name(g.nationId), "GRADUATED", g.timestamp, g));
  }

  // Foreign investment (whales) — evaluated per buy with a per-nation cooldown.
  for (const t of r.trades) {
    if (!t.isBuy) continue;
    const eth = unitsToWif(t.wifAmount);
    if (!isWhaleBuy(eth, t.marketCapBeforeWif ?? t.marketCapWif)) continue;
    const [g] = await sql`SELECT last_fired FROM game_nations WHERE nation_id = ${t.nationId}`;
    const last = ((g?.last_fired as Record<string, number>) ?? {}).FOREIGN_INVESTMENT;
    if (last !== undefined && t.timestamp - last < (EVENT_RULES.cooldowns.FOREIGN_INVESTMENT ?? 3600)) continue;
    const item = await createEvent(sql, {
      type: "FOREIGN_INVESTMENT",
      nationId: t.nationId,
      title: `🐋 A whale invested heavily in ${upper(name(t.nationId))}.`,
      body: `${shortAddress(t.trader)} bought ${formatWif(eth)} of $${ticker(t.nationId)}.`,
      data: { trader: t.trader, wifAmount: eth, venue: t.venue },
      txHash: t.txHash,
      blockNumber: t.blockNumber,
      createdAt: t.timestamp,
      dedupeKey: `whale:${t.txHash}:${t.logIndex}`,
    });
    if (item) {
      news.push(item);
      await sql`
        INSERT INTO game_nations (nation_id, last_fired) VALUES (${t.nationId}, ${sql.json({ FOREIGN_INVESTMENT: t.timestamp })})
        ON CONFLICT (nation_id) DO UPDATE SET last_fired = game_nations.last_fired || excluded.last_fired`;
    }
  }

  for (const p of r.proposalsCreated) {
    const [row] = await sql`SELECT description FROM proposals WHERE id = ${p.id}`;
    const headline = String(row?.description ?? "").split("\n")[0]!.slice(0, 120) || `Proposal #${p.id}`;
    push(
      await createEvent(sql, {
        type: "PROPOSAL_CREATED",
        nationId: p.nationId,
        title: `🗳️ ${upper(name(p.nationId))} citizens are voting: “${headline}”`,
        body: `Proposed by ${shortAddress(p.proposer)}.`,
        data: { proposalId: p.id, kind: p.kind },
        txHash: p.txHash,
        blockNumber: p.blockNumber,
        createdAt: p.timestamp,
        dedupeKey: `proposal:${p.id}`,
      }),
    );
    await awardXp(sql, p.proposer, `proposal:${p.id}`, XP.proposal, `Proposal #${p.id}`, p.timestamp);
    await unlockCitizenAchievement(sql, p.proposer, "FIRST_PROPOSAL", p.nationId, p.timestamp);
  }

  for (const v of r.votes) {
    await awardXp(sql, v.voter, `vote:${v.proposalId}`, XP.vote, `Voted on proposal #${v.proposalId}`, v.timestamp);
    await unlockCitizenAchievement(sql, v.voter, "FIRST_VOTE", v.nationId, v.timestamp);
  }

  for (const e of r.proposalsExecuted) {
    const [p] = await sql`SELECT proposer, payload FROM proposals WHERE id = ${e.id}`;
    if (p) await awardXp(sql, p.proposer as string, `enacted:${e.id}`, XP.proposalEnacted, `Proposal #${e.id} enacted`, e.timestamp);
    if (e.kind === ProposalKind.Symbol) {
      push(
        await createEvent(sql, {
          type: "SYMBOL_CHANGED",
          nationId: e.nationId,
          title: `🎌 ${upper(name(e.nationId))} adopted a new national symbol.`,
          body: `Enacted by proposal #${e.id}.`,
          data: { proposalId: e.id },
          txHash: e.txHash,
          blockNumber: e.blockNumber,
          createdAt: e.timestamp,
          dedupeKey: `symbol:${e.id}`,
        }),
      );
    }
  }

  for (const rel of r.releases) {
    push(
      await createEvent(sql, {
        type: "TREASURY_RELEASE",
        nationId: rel.nationId,
        title: `🏦 ${upper(name(rel.nationId))} spent ${formatWif(unitsToWif(rel.amount))} from its treasury.`,
        body: `Sent to ${shortAddress(rel.to)} by proposal #${rel.proposalId}.`,
        data: { proposalId: rel.proposalId, to: rel.to, amountWif: unitsToWif(rel.amount) },
        txHash: rel.txHash,
        blockNumber: rel.blockNumber,
        createdAt: rel.timestamp,
        dedupeKey: `release:${rel.txHash}:${rel.logIndex}`,
      }),
    );
  }

  for (const c of r.newCitizens) {
    const n = cache.byId.get(c.nationId);
    if (!n) continue;
    await awardXp(sql, c.address, `cit:${c.nationId}`, XP.newCitizenship, `Citizenship of ${n.name}`, c.timestamp);
    await unlockCitizenAchievement(sql, c.address, "FIRST_CITIZENSHIP", c.nationId, c.timestamp);
    if (c.timestamp - n.createdAt <= 86400) await unlockCitizenAchievement(sql, c.address, "EARLY_SETTLER", c.nationId, c.timestamp);
    const [{ count }] = (await sql`
      SELECT count(*)::int AS count FROM holders h JOIN nations n ON n.id = h.nation_id
      WHERE h.address = ${c.address} AND h.balance >= n.total_supply / 1000000`) as unknown as [{ count: number }];
    if (count >= 5) await unlockCitizenAchievement(sql, c.address, "WORLD_CITIZEN", null, c.timestamp);
  }

  const affected = [...r.affectedNations];
  news.push(...(await refreshNationMetrics(ctx, cache, affected, now)));
  const rankChanges = await recomputeRanks(sql);

  // Realtime fan-out (after all writes are visible).
  for (const t of r.trades) {
    ctx.bus.publish({
      kind: "trade",
      nationId: t.nationId,
      priceWif: t.priceWif,
      marketCapWif: t.marketCapWif,
      trade: {
        txHash: t.txHash,
        logIndex: t.logIndex,
        trader: t.trader,
        side: t.isBuy ? "buy" : "sell",
        wifAmount: unitsToWif(t.wifAmount),
        tokenAmount: unitsToWif(t.tokenAmount),
        priceWif: t.priceWif,
        venue: t.venue,
        timestamp: t.timestamp,
      },
    });
  }
  if (affected.length) {
    for (const nation of await nationSummaries(sql, { ids: affected })) ctx.bus.publish({ kind: "nation", nation });
  }
  if (rankChanges.length) ctx.bus.publish({ kind: "ranks", ranks: rankChanges });
  for (const item of news.sort((a, b) => a.id - b.id)) ctx.bus.publish({ kind: "news", item });
  if (r.proposalsTouched.size) {
    const rows = await sql`SELECT id, nation_id FROM proposals WHERE id IN ${sql([...r.proposalsTouched])}`;
    for (const p of rows) ctx.bus.publish({ kind: "proposal", proposalId: Number(p.id), nationId: Number(p.nation_id) });
  }
}
