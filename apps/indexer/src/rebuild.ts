/**
 * Rebuild all game-derived state from the on-chain mirror (deterministic replay).
 *   pnpm --filter @atlaspad/indexer rebuild-game
 */
import postgres from "postgres";
import { createCtx } from "./context";
import { loadEnv } from "./env";
import { GameEngine } from "./game/engine";
import { log } from "./log";
import { NationCache } from "./sync/nations";

const env = loadEnv();
const sql = postgres(env.databaseUrl, { max: 4, ssl: env.databaseSsl ? "require" : undefined, onnotice: () => {} });
const ctx = createCtx(env, sql);
const cache = new NationCache();
await cache.load(sql);
await sql`UPDATE indexer_state SET game_cursor = 0 WHERE id = 'main'`;
const engine = new GameEngine(ctx, cache);
let last = -1;
for (;;) {
  await engine.step();
  const [s] = await sql`SELECT game_cursor, last_block_timestamp FROM indexer_state WHERE id = 'main'`;
  const cursor = Number(s!.game_cursor);
  if (cursor >= Number(s!.last_block_timestamp) - 1 || cursor === last) break;
  last = cursor;
}
log.info("Game state rebuilt");
await sql.end();
