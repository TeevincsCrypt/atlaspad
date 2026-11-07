import postgres from "postgres";
import { createCtx } from "./context";
import { loadEnv } from "./env";
import { GameEngine } from "./game/engine";
import { log } from "./log";
import { runMigrations } from "./migrate";
import { refreshWifUsd } from "./price";
import { startServer } from "./realtime/server";
import { ChainSync } from "./sync/sync";
import { TelegramBot } from "./telegram/bot";

const env = loadEnv();
if (env.runMigrations) await runMigrations(env.databaseUrl, env.databaseSsl);
const sql = postgres(env.databaseUrl, {
  // Supabase's session pooler has few slots; leave room for other clients. Override with INDEXER_DB_POOL_MAX.
  max: Math.max(1, Number(process.env.INDEXER_DB_POOL_MAX) || 6),
  ssl: env.databaseSsl ? "require" : undefined,
  types: { bigint: postgres.BigInt },
  onnotice: () => {},
});
const ctx = createCtx(env, sql);
const server = startServer(ctx);
const telegram = env.telegram ? new TelegramBot(sql, env.telegram) : null;
telegram?.start();

let running = true;
const shutdown = async (signal: string) => {
  log.info("Shutting down", { signal });
  running = false;
  telegram?.stop();
  server.close();
  await sql.end({ timeout: 5 });
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

if (!env.network.contracts) {
  log.warn("AtlasPad contracts are not configured (ATLAS_LAUNCHPAD / ATLAS_GOVERNOR / ATLAS_TREASURY). Not indexing; /health, /stream and /admin/status stay up.");
} else {
  log.info("Indexer starting", {
    network: env.network.key,
    chainId: env.network.chain.id,
    launchpad: env.network.contracts.launchpad,
    deployBlock: Number(env.network.deployBlock),
  });
  const sync = new ChainSync(ctx);
  const engine = new GameEngine(ctx, sync.cache);
  await refreshWifUsd(ctx);
  setInterval(() => void refreshWifUsd(ctx), 60_000);

  let backoff = env.pollMs;
  while (running) {
    let caughtUp = false;
    try {
      caughtUp = await sync.step();
      await engine.step();
      backoff = env.pollMs;
    } catch (err) {
      ctx.stats.errors++;
      log.error("Indexer iteration failed", { err: String((err as Error)?.stack ?? err) });
      await sql`INSERT INTO indexer_errors (scope, message, details) VALUES ('loop', ${String((err as Error)?.message ?? err).slice(0, 500)}, ${sql.json({ stack: String((err as Error)?.stack ?? "").slice(0, 4000) })})`.catch(() => {});
      backoff = Math.min(backoff * 2, 60_000);
      caughtUp = true;
    }
    if (caughtUp) await new Promise((r) => setTimeout(r, backoff));
  }
}
