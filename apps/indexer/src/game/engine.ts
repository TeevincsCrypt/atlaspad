import { nationSummaries } from "@atlaspad/db/queries";
import { EPOCH_SECONDS } from "@atlaspad/shared";
import type { Ctx } from "../context";
import { log } from "../log";
import { refreshNationMetrics } from "../sync/metrics";
import type { NationCache } from "../sync/nations";
import { applyAction, type ActionEvent } from "./actions";
import type { GameCtx } from "./common";
import { tickEpoch } from "./epoch";
import { recomputeRanks } from "./state";
import { nextTimed, processTimed } from "./timed";

/** Max epochs replayed per step, so catch-up never starves the chain sync loop. */
const MAX_EPOCHS_PER_STEP = 24;

/**
 * The game engine advances game time up to the timestamp of the last indexed block, processing — in strict
 * time order — building completions / war endings, executed GameAction decrees, and hourly epochs.
 * Game state is a deterministic function of the on-chain mirror; a cursor of 0 triggers a full replay.
 */
export class GameEngine {
  constructor(
    private ctx: Ctx,
    private cache: NationCache,
  ) {}

  async step(): Promise<void> {
    const sql = this.ctx.sql;
    const [st] = await sql`SELECT game_cursor, last_block_timestamp FROM indexer_state WHERE id = 'main'`;
    if (!st || st.last_block_timestamp === null) return;
    // Several blocks can share a timestamp (Arbitrum produces sub-second blocks), so only times strictly
    // before the newest indexed block's timestamp are guaranteed to be complete.
    const safe = Number(st.last_block_timestamp) - 1;
    let cursor = Number(st.game_cursor);
    if (cursor === 0) {
      await this.reset();
      const first = Math.min(...[...this.cache.byId.values()].map((n) => n.createdAt));
      if (!Number.isFinite(first)) {
        await sql`UPDATE indexer_state SET game_cursor = ${safe} WHERE id = 'main'`;
        return;
      }
      cursor = first - 1;
      log.info("Game replay starting", { from: cursor });
    }
    if (safe <= cursor) return;

    const end = Math.min(safe, (Math.floor(cursor / EPOCH_SECONDS) + MAX_EPOCHS_PER_STEP) * EPOCH_SECONDS);
    const g: GameCtx = { ctx: this.ctx, cache: this.cache, news: [], touched: new Set() };
    const actions = (
      await sql`SELECT * FROM game_action_events WHERE timestamp > ${cursor} AND timestamp <= ${end} ORDER BY timestamp, block_number, log_index`
    ).map(
      (r): ActionEvent => ({
        proposalId: Number(r.proposal_id),
        nationId: Number(r.nation_id),
        action: Number(r.action),
        arg: BigInt(r.arg as string),
        text: r.text as string,
        txHash: r.tx_hash as string,
        blockNumber: Number(r.block_number),
        timestamp: Number(r.timestamp),
      }),
    );

    let t = cursor;
    let ai = 0;
    let nextEpoch = (Math.floor(cursor / EPOCH_SECONDS) + 1) * EPOCH_SECONDS;
    for (;;) {
      const tAction = ai < actions.length ? actions[ai]!.timestamp : Infinity;
      const tEpoch = nextEpoch <= end ? nextEpoch : Infinity;
      const tTimed = (await nextTimed(g, t, end)) ?? Infinity;
      const next = Math.min(tAction, tEpoch, tTimed);
      if (!Number.isFinite(next)) break;
      // Order at equal timestamps: completions, then decrees, then the epoch tick.
      if (tTimed === next) {
        await processTimed(g, next);
        t = next;
        continue;
      }
      if (tAction === next) {
        await applyAction(g, actions[ai++]!);
        t = next;
        continue;
      }
      await tickEpoch(g, next);
      nextEpoch += EPOCH_SECONDS;
      t = next;
    }

    await sql`UPDATE indexer_state SET game_cursor = ${end} WHERE id = 'main'`;
    this.ctx.stats.lastGameAt = Date.now();

    if (g.touched.size) {
      const ids = [...g.touched];
      g.news.push(...(await refreshNationMetrics(this.ctx, this.cache, ids, safe)));
      const ranks = await recomputeRanks(sql);
      for (const nation of await nationSummaries(sql, { ids })) this.ctx.bus.publish({ kind: "nation", nation });
      if (ranks.length) this.ctx.bus.publish({ kind: "ranks", ranks });
    }
    for (const item of g.news.sort((a, b) => a.id - b.id)) this.ctx.bus.publish({ kind: "news", item });
  }

  /** Wipe all game-derived state (on-chain mirror untouched) so it can be replayed deterministically. */
  async reset(): Promise<void> {
    const sql = this.ctx.sql;
    await sql.begin(async (tx) => {
      await tx`TRUNCATE game_snapshots, game_resource_ledger, game_actions, game_buildings, game_wars,
        game_alliances, game_alliance_members, game_alliance_invites RESTART IDENTITY`;
      await tx`DELETE FROM game_events WHERE dedupe_key LIKE 'g:%'`;
      await tx`
        UPDATE game_nations SET influence = 0, culture = 0, energy = 0, materials = 0, war_wins = 0, war_losses = 0,
          alliance_id = NULL, war_territory_bonus_until = NULL, statuses = '[]'::jsonb, last_fired = '{}'::jsonb`;
    });
    log.warn("Game state reset for replay");
  }
}
