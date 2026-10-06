/**
 * End-to-end: real contracts on a local anvil chain → indexer → database → game engine.
 * Requires `anvil`, `forge` and a PostgreSQL server. Enabled with INTEGRATION=1:
 *   INTEGRATION=1 TEST_DATABASE_URL=postgresql://atlas:atlas@localhost:5432/atlaspad_test pnpm --filter @atlaspad/indexer test
 */
import { spawn, type ChildProcess } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { createPublicClient, http, type Abi, type Address } from "viem";
import { BUILDINGS, GOVERNANCE, LAUNCHPAD, THEMES, anvilChain } from "@atlaspad/shared";
import { atlasGovernorAbi, atlasLaunchpadAbi, nationTokenAbi, nationTreasuryAbi } from "@atlaspad/shared/abis";
import { nationSummaries, newsItems } from "@atlaspad/db/queries";
import { createCtx } from "../src/context";
import { loadEnv } from "../src/env";
import { GameEngine } from "../src/game/engine";
import { runMigrations } from "../src/migrate";
import { ChainSync } from "../src/sync/sync";
import { deployLocal, runScenario, type LocalDeployment } from "./scenario";

const enabled = process.env.INTEGRATION === "1";
const PORT = 8547;
const RPC = `http://127.0.0.1:${PORT}`;
const DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://atlas:atlas@localhost:5432/atlaspad_test";

describe.skipIf(!enabled)("indexer integration (anvil)", () => {
  let anvil: ChildProcess;
  let deployment: LocalDeployment;
  let sql: postgres.Sql;
  let ids: Awaited<ReturnType<typeof runScenario>>;

  beforeAll(async () => {
    anvil = spawn("anvil", ["--port", String(PORT), "--silent", "--timestamp", "1790000000"], { stdio: "ignore" });
    const client = createPublicClient({ chain: anvilChain, transport: http(RPC) });
    for (let i = 0; i < 50; i++) {
      try {
        await client.getBlockNumber();
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    deployment = deployLocal(RPC);
    ids = await runScenario(RPC, deployment);

    const admin = postgres(DB_URL.replace(/\/[^/]+$/, "/postgres"), { max: 1, onnotice: () => {} });
    const dbName = DB_URL.split("/").pop()!;
    await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    await admin.end();
    await runMigrations(DB_URL, false);
    sql = postgres(DB_URL, { max: 5, onnotice: () => {} });

    Object.assign(process.env, {
      ATLAS_NETWORK: "local",
      ATLAS_RPC_URL: RPC,
      ATLAS_LAUNCHPAD: deployment.launchpad,
      ATLAS_GOVERNOR: deployment.governor,
      ATLAS_TREASURY: deployment.treasury,
      ATLAS_DEPLOY_BLOCK: String(deployment.deployedAtBlock),
      ATLAS_UNISWAP_V2_FACTORY: deployment.uniswapV2Factory,
      ATLAS_UNISWAP_V2_ROUTER: deployment.uniswapV2Router,
      ATLAS_WETH: deployment.weth,
      DATABASE_URL: DB_URL,
      INDEXER_CONFIRMATIONS: "0",
      INDEXER_BATCH_BLOCKS: "40",
    });
    const ctx = createCtx(loadEnv(), sql);
    const sync = new ChainSync(ctx);
    const engine = new GameEngine(ctx, sync.cache);
    for (let i = 0; i < 500; i++) {
      const caughtUp = await sync.step();
      await engine.step();
      if (caughtUp) {
        const [s] = await sql`SELECT game_cursor, last_block_timestamp FROM indexer_state`;
        if (Number(s!.game_cursor) >= Number(s!.last_block_timestamp) - 1) break;
      }
    }
  }, 300_000);

  afterAll(async () => {
    await sql?.end();
    anvil?.kill();
  });

  it("indexes nations, curve state and graduation", async () => {
    const nations = await nationSummaries(sql);
    expect(nations.map((n) => n.name)).toEqual(["Pepeland", "Dogeland", "Wifia", "Bonkistan"]);
    const pepe = nations.find((n) => n.id === ids.pepe)!;
    expect(pepe.graduated).toBe(true);
    expect(pepe.priceEth).toBeGreaterThan(0);
    expect(pepe.liquidityEth).toBeGreaterThan(1); // ~2 ETH seeded at graduation, minus a later Uniswap sell
    expect(pepe.citizens).toBeGreaterThanOrEqual(5);
    const doge = nations.find((n) => n.id === ids.doge)!;
    expect(doge.graduated).toBe(false);
    expect(doge.curveProgress).toBeGreaterThan(0);
  });

  it("holder balances match the chain exactly", async () => {
    const client = createPublicClient({ chain: anvilChain, transport: http(RPC) });
    const rows = await sql`SELECT n.token, n.total_supply, h.address, h.balance FROM holders h JOIN nations n ON n.id = h.nation_id`;
    expect(rows.length).toBeGreaterThan(10);
    for (const r of rows) {
      const onChain = await client.readContract({ address: r.token as Address, abi: nationTokenAbi, functionName: "balanceOf", args: [r.address as Address] });
      expect(onChain.toString()).toBe(String(r.balance));
    }
    const sums = await sql`SELECT n.id, n.total_supply, sum(h.balance) AS s FROM holders h JOIN nations n ON n.id = h.nation_id GROUP BY n.id, n.total_supply`;
    for (const s of sums) expect(String(s.s)).toBe(String(s.total_supply));
  });

  it("indexes curve and uniswap trades", async () => {
    const [curve] = await sql`SELECT count(*)::int AS c FROM trades WHERE venue = 'curve'`;
    const [uni] = await sql`SELECT count(*)::int AS c FROM trades WHERE venue = 'uniswap'`;
    expect(curve!.c).toBeGreaterThan(10);
    expect(uni!.c).toBe(2);
  });

  it("indexes governance and applies game decrees", async () => {
    const props = await sql`SELECT id, executed FROM proposals ORDER BY id`;
    expect(props).toHaveLength(7);
    expect(props.every((p) => p.executed)).toBe(true);
    const actions = await sql`SELECT proposal_id, status, reason FROM game_actions ORDER BY proposal_id`;
    expect(actions.filter((a) => a.status === "applied").map((a) => Number(a.proposal_id)).sort()).toEqual(
      [ids.proposals.build, ids.proposals.alliance, ids.proposals.war, ids.proposals.invite, ids.proposals.join].sort(),
    );
    const [building] = await sql`SELECT status FROM game_buildings WHERE nation_id = ${ids.pepe}`;
    expect(building!.status).toBe("complete");
    const [war] = await sql`SELECT status, winner_id FROM game_wars`;
    expect(war!.status).toBe("ended");
    expect([ids.pepe, ids.wif]).toContain(Number(war!.winner_id));
    const members = await sql`SELECT nation_id FROM game_alliance_members WHERE alliance_id = ${ids.proposals.alliance} AND left_at IS NULL ORDER BY nation_id`;
    expect(members.map((m) => Number(m.nation_id))).toEqual([ids.doge, ids.bonk]);
    const [release] = await sql`SELECT kind, amount FROM treasury_txs WHERE direction = 'out'`;
    expect(release!.kind).toBe("release");
  });

  it("publishes world news from real events", async () => {
    const news = await newsItems(sql, { limit: 200 });
    const types = new Set(news.map((n) => n.type));
    for (const t of ["FOUNDED", "GRADUATED", "WAR_DECLARED", "WAR_ENDED", "ALLIANCE_FORMED", "ALLIANCE_JOINED", "BUILDING_COMPLETED", "TREASURY_RELEASE", "SYMBOL_CHANGED", "ACHIEVEMENT"]) {
      expect(types, t).toContain(t);
    }
    const [snap] = await sql`SELECT count(*)::int AS c FROM game_snapshots`;
    expect(snap!.c).toBeGreaterThan(100);
    const [xp] = await sql`SELECT count(*)::int AS c FROM game_citizen_xp`;
    expect(xp!.c).toBeGreaterThan(10);
  });

  it("game state replays deterministically", async () => {
    const digest = async () => {
      const r = await sql`
        SELECT
          (SELECT json_agg(x ORDER BY nation_id) FROM (SELECT nation_id, influence, culture, energy, materials, war_wins, war_losses, alliance_id FROM game_nations) x) AS nations,
          (SELECT json_agg(x ORDER BY id) FROM (SELECT id, winner_id, spoils FROM game_wars) x) AS wars,
          (SELECT json_agg(x ORDER BY nation_id, epoch) FROM (SELECT nation_id, epoch, citizens, price_eth FROM game_snapshots) x) AS snaps,
          (SELECT json_agg(x ORDER BY dedupe_key) FROM (SELECT dedupe_key, title FROM game_events WHERE dedupe_key LIKE 'g:%') x) AS events`;
      return JSON.stringify(r[0]);
    };
    const before = await digest();
    await sql`UPDATE indexer_state SET game_cursor = 0`;
    const ctx = createCtx(loadEnv(), sql);
    const sync = new ChainSync(ctx);
    await sync.init();
    const engine = new GameEngine(ctx, sync.cache);
    for (let i = 0; i < 100; i++) {
      await engine.step();
      const [s] = await sql`SELECT game_cursor, last_block_timestamp FROM indexer_state`;
      if (Number(s!.game_cursor) >= Number(s!.last_block_timestamp) - 1) break;
    }
    const after = await digest();
    if (after !== before && process.env.DIGEST_DIR) {
      const { writeFileSync } = await import("node:fs");
      writeFileSync(`${process.env.DIGEST_DIR}/before.json`, before);
      writeFileSync(`${process.env.DIGEST_DIR}/after.json`, after);
    }
    expect(after).toBe(before);
  }, 120_000);

  it("shared rule constants match the deployed contracts", async () => {
    const client = createPublicClient({ chain: anvilChain, transport: http(RPC) });
    const read = (address: Address, abi: Abi, functionName: string) => client.readContract({ address, abi, functionName }) as Promise<bigint | number>;
    const gov = (name: string) => read(deployment.governor, atlasGovernorAbi as Abi, name).then(BigInt);
    const lp = (name: string) => read(deployment.launchpad, atlasLaunchpadAbi as Abi, name).then(BigInt);
    expect(await gov("PROPOSAL_THRESHOLD_BPS")).toBe(BigInt(GOVERNANCE.proposalThresholdBps));
    expect(await gov("TREASURY_QUORUM_BPS")).toBe(BigInt(GOVERNANCE.treasuryQuorumBps));
    expect(await gov("STANDARD_QUORUM_BPS")).toBe(BigInt(GOVERNANCE.standardQuorumBps));
    expect(await gov("TREASURY_VOTING_PERIOD")).toBe(BigInt(GOVERNANCE.treasuryVotingSeconds));
    expect(await gov("STANDARD_VOTING_PERIOD")).toBe(BigInt(GOVERNANCE.standardVotingSeconds));
    expect(await gov("TREASURY_TIMELOCK")).toBe(BigInt(GOVERNANCE.treasuryTimelockSeconds));
    expect(await gov("EXECUTION_WINDOW")).toBe(BigInt(GOVERNANCE.executionWindowSeconds));
    expect(await gov("BUILDING_TYPES")).toBe(BigInt(BUILDINGS.length));
    expect(BigInt(await read(deployment.treasury, nationTreasuryAbi as Abi, "MAX_RELEASE_BPS"))).toBe(BigInt(GOVERNANCE.maxReleaseBps));
    expect(await lp("TRADE_FEE_BPS")).toBe(LAUNCHPAD.TRADE_FEE_BPS);
    expect(await lp("PROTOCOL_FEE_BPS")).toBe(LAUNCHPAD.PROTOCOL_FEE_BPS);
    expect(await lp("TREASURY_FEE_BPS")).toBe(LAUNCHPAD.TREASURY_FEE_BPS);
    expect(await lp("LP_RESERVE_BPS")).toBe(LAUNCHPAD.LP_RESERVE_BPS);
    expect(await lp("MAX_FOUNDER_BPS")).toBe(LAUNCHPAD.MAX_FOUNDER_BPS);
    expect(await lp("MAX_INITIAL_BUY_BPS")).toBe(LAUNCHPAD.MAX_INITIAL_BUY_BPS);
    expect(await lp("FOUNDER_VESTING")).toBe(LAUNCHPAD.FOUNDER_VESTING_SECONDS);
    expect(await lp("MIN_SUPPLY")).toBe(LAUNCHPAD.MIN_SUPPLY);
    expect(await lp("MAX_SUPPLY")).toBe(LAUNCHPAD.MAX_SUPPLY);
    expect(await lp("THEME_COUNT")).toBe(BigInt(THEMES.length));
  });
});
