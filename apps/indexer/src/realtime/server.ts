import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { indexerHealth } from "@atlaspad/db/queries";
import type { Ctx } from "../context";
import { log } from "../log";

const HEARTBEAT_MS = 15_000;
const MAX_CLIENTS = 5_000;

function json(res: ServerResponse, status: number, body: unknown, cors: string) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": cors,
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, token: string | null): boolean {
  if (!token) return false;
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Public:  GET /health, GET /stream (Server-Sent Events).
 * Private: GET /admin/status (Authorization: Bearer INDEXER_ADMIN_TOKEN). Read-only; there are no admin controls.
 */
export function startServer(ctx: Ctx) {
  const cors = ctx.env.corsOrigin;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Origin": cors,
          "Access-Control-Allow-Headers": "Authorization",
          "Access-Control-Allow-Methods": "GET",
        });
        return res.end();
      }
      if (req.method !== "GET") return json(res, 405, { error: "method not allowed" }, cors);

      if (url.pathname === "/health") {
        const h = ctx.env.network.contracts ? await indexerHealth(ctx.sql) : null;
        return json(
          res,
          200,
          {
            ok: true,
            chainId: ctx.env.network.chain.id,
            deployed: Boolean(ctx.env.network.contracts),
            lastIndexedBlock: h?.lastIndexedBlock ?? null,
            chainHeadBlock: h?.chainHeadBlock ?? null,
            lagBlocks: h?.lagBlocks ?? null,
            lastSyncAt: ctx.stats.lastSyncAt,
            subscribers: ctx.bus.subscribers,
          },
          cors,
        );
      }

      if (url.pathname === "/stream") {
        if (ctx.bus.subscribers >= MAX_CLIENTS) return json(res, 503, { error: "too many clients" }, cors);
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "Access-Control-Allow-Origin": cors,
          "X-Accel-Buffering": "no",
        });
        res.write("retry: 3000\n\n");
        let seq = 0;
        const send = (data: unknown) => res.write(`id: ${++seq}\ndata: ${JSON.stringify(data)}\n\n`);
        const unsubscribe = ctx.bus.subscribe(send);
        const heartbeat = setInterval(async () => {
          const h = await indexerHealth(ctx.sql).catch(() => null);
          send({ kind: "heartbeat", block: h?.lastIndexedBlock ?? null, at: Math.floor(Date.now() / 1000) });
        }, HEARTBEAT_MS);
        req.on("close", () => {
          clearInterval(heartbeat);
          unsubscribe();
        });
        return;
      }

      if (url.pathname === "/admin/status") {
        if (!ctx.env.adminToken) return json(res, 404, { error: "not found" }, cors);
        if (!authorized(req, ctx.env.adminToken)) return json(res, 401, { error: "unauthorized" }, cors);
        return json(res, 200, await adminStatus(ctx), cors);
      }

      return json(res, 404, { error: "not found" }, cors);
    } catch (err) {
      log.error("HTTP handler failed", { path: url.pathname, err: String(err) });
      if (!res.headersSent) json(res, 500, { error: "internal error" }, cors);
    }
  });
  server.listen(ctx.env.port, () => log.info("Indexer HTTP server listening", { port: ctx.env.port }));
  return server;
}

async function adminStatus(ctx: Ctx) {
  const sql = ctx.sql;
  const started = Date.now();
  let rpc: { ok: boolean; latencyMs: number | null; head: number | null; error?: string };
  try {
    const head = Number(await ctx.client.getBlockNumber());
    rpc = { ok: true, latencyMs: Date.now() - started, head };
  } catch (err) {
    rpc = { ok: false, latencyMs: null, head: null, error: String((err as Error).message ?? err).slice(0, 300) };
  }
  const dbStart = Date.now();
  const [counts] = await sql`
    SELECT
      (SELECT count(*) FROM nations)::int AS nations,
      (SELECT count(*) FROM trades)::int AS trades,
      (SELECT count(*) FROM transfers)::int AS transfers,
      (SELECT count(*) FROM holders)::int AS holders,
      (SELECT count(*) FROM proposals)::int AS proposals,
      (SELECT count(*) FROM votes)::int AS votes,
      (SELECT count(*) FROM game_events)::int AS events,
      (SELECT count(*) FROM game_wars WHERE status = 'active')::int AS active_wars,
      (SELECT count(*) FROM game_alliances WHERE active)::int AS alliances,
      (SELECT count(*) FROM indexer_errors WHERE NOT resolved)::int AS open_errors`;
  const dbLatency = Date.now() - dbStart;
  const health = await indexerHealth(sql);
  const errors = await sql`SELECT id, at, scope, message, details FROM indexer_errors ORDER BY id DESC LIMIT 25`;
  const latestBlocks = await sql`SELECT number, hash, timestamp FROM indexed_blocks ORDER BY number DESC LIMIT 10`;
  return {
    network: {
      key: ctx.env.network.key,
      chainId: ctx.env.network.chain.id,
      rpcUrl: ctx.env.network.rpcUrl.replace(/\/\/([^/]*@)/, "//***@"),
      contracts: ctx.env.network.contracts,
      dex: ctx.env.network.dex,
      deployBlock: Number(ctx.env.network.deployBlock),
      confirmations: ctx.env.confirmations,
    },
    rpc,
    database: { ok: true, latencyMs: dbLatency, counts },
    indexer: { ...health, ...ctx.stats, subscribers: ctx.bus.subscribers },
    latestBlocks,
    errors,
    generatedAt: Math.floor(Date.now() / 1000),
  };
}
