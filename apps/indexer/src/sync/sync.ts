import type { Address } from "viem";
import { atlasGovernorAbi, atlasLaunchpadAbi, uniswapV2PairAbi } from "@atlaspad/shared/abis";
import type { Ctx } from "../context";
import { log } from "../log";
import { applyBatch } from "./apply";
import { fetchBatch, isRangeError } from "./fetch";
import { NationCache } from "./nations";
import { postProcess } from "./post";
import type { ApplyResult } from "./apply";

const POST_PROCESS_ATTEMPTS = 5;

export interface SyncState {
  lastBlock: number;
  lastBlockHash: string | null;
  lastBlockTimestamp: number | null;
}

export class ChainSync {
  readonly cache = new NationCache();
  private batchBlocks: number;
  private loaded = false;

  constructor(private ctx: Ctx) {
    this.batchBlocks = ctx.env.batchBlocks;
  }

  async init() {
    const { sql, env } = this.ctx;
    const startBlock = Math.max(0, Number(env.network.deployBlock) - 1);
    await sql`
      INSERT INTO indexer_state (id, chain_id, last_block) VALUES ('main', ${env.network.chain.id}, ${startBlock})
      ON CONFLICT (id) DO NOTHING`;
    const [s] = await sql`SELECT chain_id FROM indexer_state WHERE id = 'main'`;
    if (Number(s!.chain_id) !== env.network.chain.id) {
      throw new Error(`Database was indexed for chain ${s!.chain_id}, but ATLAS_NETWORK is chain ${env.network.chain.id}.`);
    }
    const chainId = await this.ctx.client.getChainId();
    if (chainId !== env.network.chain.id) {
      throw new Error(`RPC reports chain id ${chainId}, expected ${env.network.chain.id}. Refusing to index.`);
    }
    await this.seedExcluded();
    await this.cache.load(sql);
    this.loaded = true;
  }

  private async seedExcluded() {
    const rows = [...this.ctx.excluded.entries()].map(([address, v]) => ({ address, label: v.label, kind: v.kind }));
    if (rows.length) {
      await this.ctx.sql`
        INSERT INTO excluded_addresses ${this.ctx.sql(rows)}
        ON CONFLICT (address) DO UPDATE SET label = excluded.label, kind = excluded.kind`;
    }
  }

  async state(): Promise<SyncState> {
    const [s] = await this.ctx.sql`SELECT last_block, last_block_hash, last_block_timestamp FROM indexer_state WHERE id = 'main'`;
    return {
      lastBlock: Number(s!.last_block),
      lastBlockHash: (s!.last_block_hash as string | null) ?? null,
      lastBlockTimestamp: s!.last_block_timestamp === null ? null : Number(s!.last_block_timestamp),
    };
  }

  /**
   * Index the next block range. Returns true when the indexer is caught up with the confirmed head.
   */
  async step(): Promise<boolean> {
    if (!this.loaded) await this.init();
    const { client, sql, env } = this.ctx;
    const started = Date.now();
    const head = Number(await client.getBlockNumber());
    await sql`UPDATE indexer_state SET chain_head = ${head} WHERE id = 'main'`;
    const target = head - env.confirmations;
    const st = await this.state();
    if (st.lastBlock >= target) return true;

    if (st.lastBlockHash) {
      const block = await client.getBlock({ blockNumber: BigInt(st.lastBlock) });
      if (block.hash !== st.lastBlockHash) {
        await this.handleReorg(st.lastBlock);
        return false;
      }
    }

    const from = st.lastBlock + 1;
    const to = Math.min(target, from + this.batchBlocks - 1);
    let batch;
    try {
      batch = await fetchBatch(
        this.ctx,
        BigInt(from),
        BigInt(to),
        this.cache.tokens() as Address[],
        this.cache.graduatedPairs() as Address[],
      );
    } catch (err) {
      if (isRangeError(err) && this.batchBlocks > 10) {
        this.batchBlocks = Math.max(10, Math.floor(this.batchBlocks / 2));
        log.warn("Reducing log batch size", { batchBlocks: this.batchBlocks });
        return false;
      }
      throw err;
    }

    const { result, updatedNations } = await applyBatch(this.ctx, sql, this.cache, batch, to);
    for (const n of updatedNations) this.cache.put(n);
    await this.postProcessWithRetry(result, batch.toBlockTimestamp, from, to);

    this.ctx.stats.lastSyncAt = Date.now();
    this.ctx.stats.lastSyncMs = Date.now() - started;
    if (batch.events.length) {
      log.info("Indexed range", { from, to, events: batch.events.length, ms: this.ctx.stats.lastSyncMs });
    }
    if (this.batchBlocks < env.batchBlocks) this.batchBlocks = Math.min(env.batchBlocks, this.batchBlocks * 2);
    return to >= target;
  }

  /**
   * News, XP, achievements and metrics for a committed range. Every write is idempotent (dedupe keys,
   * ON CONFLICT DO NOTHING), so transient failures are retried; a range that still fails is recorded in
   * indexer_errors for operators because the chain cursor has already moved past it.
   */
  private async postProcessWithRetry(result: ApplyResult, at: number, from: number, to: number) {
    for (let attempt = 1; ; attempt++) {
      try {
        await postProcess(this.ctx, this.cache, result, at);
        return;
      } catch (err) {
        if (attempt >= POST_PROCESS_ATTEMPTS) {
          log.error("Post-processing failed; news/XP for this range were skipped", { from, to, err: String(err) });
          await this.ctx.sql`
            INSERT INTO indexer_errors (scope, message, details)
            VALUES ('post-process', ${String((err as Error)?.message ?? err).slice(0, 500)}, ${this.ctx.sql.json({ from, to })})`.catch(() => {});
          return;
        }
        log.warn("Post-processing failed; retrying", { from, to, attempt, err: String(err) });
        await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 1)));
      }
    }
  }

  /**
   * A block we indexed is no longer canonical. Find the fork point using stored block hashes, delete every
   * on-chain mirror row after it, restore aggregates from chain state at the fork, and schedule a full
   * game replay (game state is a deterministic function of the mirror).
   */
  async handleReorg(lastBlock: number) {
    const { client, sql } = this.ctx;
    log.error("Chain reorganization detected", { lastBlock });
    const stored = await sql`SELECT number, hash FROM indexed_blocks WHERE number <= ${lastBlock} ORDER BY number DESC LIMIT 512`;
    let fork = Number(this.ctx.env.network.deployBlock) - 1;
    for (const b of stored) {
      const onChain = await client.getBlock({ blockNumber: BigInt(b.number as number) });
      if (onChain.hash === b.hash) {
        fork = Number(b.number);
        break;
      }
    }
    await sql.begin(async (tx) => {
      for (const table of ["trades", "transfers", "treasury_txs", "votes", "game_action_events"]) {
        await tx`DELETE FROM ${tx(table)} WHERE block_number > ${fork}`;
      }
      const [forkBlock] = await tx`SELECT timestamp FROM indexed_blocks WHERE number = ${fork}`;
      const forkTs = forkBlock ? Number(forkBlock.timestamp) : 0;
      await tx`DELETE FROM proposals WHERE created_block > ${fork}`;
      // News, achievements and XP derived after the fork are regenerated by re-sync, metric refreshes and
      // the game replay (all idempotent); rows without a block number are matched by time.
      await tx`DELETE FROM game_events WHERE block_number > ${fork} OR (block_number IS NULL AND created_at > ${forkTs})`;
      await tx`DELETE FROM game_nation_achievements WHERE unlocked_at > ${forkTs}`;
      await tx`DELETE FROM game_citizen_achievements WHERE unlocked_at > ${forkTs}`;
      await tx`DELETE FROM game_citizen_xp WHERE at > ${forkTs}`;
      await tx`DELETE FROM nations WHERE created_block > ${fork}`;
      await tx`DELETE FROM indexed_blocks WHERE number > ${fork}`;
      // Holders are rebuilt from the remaining transfer history. first_held_at is the start of the current
      // holding period (the last transfer that took the balance from zero to positive), as during normal sync.
      await tx`TRUNCATE holders`;
      await tx`
        INSERT INTO holders (nation_id, address, balance, first_held_at, updated_block)
        WITH deltas AS (
          SELECT nation_id, to_address AS address, amount AS delta, timestamp AS ts, block_number, log_index, 0 AS side FROM transfers
          UNION ALL
          SELECT nation_id, from_address, -amount, timestamp, block_number, log_index, 1 FROM transfers
        ), running AS (
          SELECT nation_id, address, delta, ts,
            sum(delta) OVER (PARTITION BY nation_id, address ORDER BY block_number, log_index, side ROWS UNBOUNDED PRECEDING) AS bal
          FROM deltas
          WHERE address <> '0x0000000000000000000000000000000000000000'
        )
        SELECT nation_id, address, sum(delta), max(ts) FILTER (WHERE bal - delta <= 0 AND bal > 0), ${fork}
        FROM running
        GROUP BY nation_id, address HAVING sum(delta) > 0`;
      await tx`
        UPDATE proposals p SET
          for_votes = COALESCE((SELECT sum(weight) FROM votes v WHERE v.proposal_id = p.id AND v.support = 1), 0),
          against_votes = COALESCE((SELECT sum(weight) FROM votes v WHERE v.proposal_id = p.id AND v.support = 0), 0),
          abstain_votes = COALESCE((SELECT sum(weight) FROM votes v WHERE v.proposal_id = p.id AND v.support = 2), 0)`;
      const [b] = await tx`SELECT hash, timestamp FROM indexed_blocks WHERE number = ${fork}`;
      await tx`
        UPDATE indexer_state SET last_block = ${fork}, last_block_hash = ${(b?.hash as string) ?? null},
          last_block_timestamp = ${(b?.timestamp as number) ?? null}, game_cursor = 0
        WHERE id = 'main'`;
    });
    // Restore curve / pool state of surviving nations from the chain at the fork block.
    await this.cache.load(sql);
    for (const n of this.cache.byId.values()) {
      const onChain = await client.readContract({
        address: this.ctx.env.network.contracts!.launchpad,
        abi: atlasLaunchpadAbi,
        functionName: "getNation",
        args: [BigInt(n.id)],
        blockNumber: BigInt(fork),
      });
      n.virtualEth = onChain.virtualEth;
      n.virtualTokens = onChain.virtualTokens;
      n.realEth = onChain.realEth;
      n.curveTokensRemaining = onChain.curveTokensRemaining;
      n.graduated = onChain.graduated;
      n.emblem = onChain.emblem.toString();
      if (!onChain.graduated) {
        n.graduatedAt = null;
        n.graduationTx = null;
        n.poolTokenReserve = null;
        n.poolWethReserve = null;
      } else {
        const [r0, r1] = await client.readContract({
          address: n.pair as Address,
          abi: uniswapV2PairAbi,
          functionName: "getReserves",
          blockNumber: BigInt(fork),
        });
        n.poolTokenReserve = n.tokenIsToken0 ? r0 : r1;
        n.poolWethReserve = n.tokenIsToken0 ? r1 : r0;
      }
      await sql`
        UPDATE nations SET virtual_eth = ${n.virtualEth.toString()}, virtual_tokens = ${n.virtualTokens.toString()},
          real_eth = ${n.realEth.toString()}, curve_tokens_remaining = ${n.curveTokensRemaining.toString()},
          graduated = ${n.graduated}, graduated_at = ${n.graduatedAt}, graduation_tx = ${n.graduationTx},
          emblem = ${n.emblem}, pool_token_reserve = ${n.poolTokenReserve?.toString() ?? null},
          pool_weth_reserve = ${n.poolWethReserve?.toString() ?? null}
        WHERE id = ${n.id}`;
    }
    // Restore proposal execution / cancellation flags at the fork.
    const props = await sql`SELECT id FROM proposals`;
    for (const p of props) {
      const onChain = await client.readContract({
        address: this.ctx.env.network.contracts!.governor,
        abi: atlasGovernorAbi,
        functionName: "getProposal",
        args: [BigInt(p.id as number)],
        blockNumber: BigInt(fork),
      });
      if (!onChain.executed) await sql`UPDATE proposals SET executed = false, executed_at = NULL, executed_tx = NULL WHERE id = ${p.id as number}`;
      if (!onChain.canceled) await sql`UPDATE proposals SET canceled = false WHERE id = ${p.id as number}`;
    }
    await sql`INSERT INTO indexer_errors (scope, message, details) VALUES ('reorg', 'Chain reorganization handled', ${sql.json({ lastBlock, fork })})`;
    log.warn("Reorg rewind complete; game state will be replayed", { fork });
  }
}
