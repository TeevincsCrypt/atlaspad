import { createPublicClient, http } from "viem";
import { indexerHealth } from "@atlaspad/db/queries";
import { isAdminAuthorized } from "@/lib/admin-auth";
import { configError, network } from "@/lib/env";
import { getSql } from "@/lib/server/db";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

async function timed<T>(fn: () => Promise<T>) {
  const t = Date.now();
  try {
    return { ok: true as const, value: await fn(), ms: Date.now() - t };
  } catch (err) {
    return { ok: false as const, error: String((err as Error)?.message ?? err).slice(0, 300), ms: Date.now() - t };
  }
}

/** Read-only operational status. Requires admin Basic auth (also enforced by proxy.ts). */
export async function GET(req: Request) {
  if (!isAdminAuthorized(req.headers.get("authorization"))) return json({ error: "unauthorized" }, { status: 401 });
  const client = createPublicClient({ chain: network.chain, transport: http(process.env.ATLAS_RPC_URL || network.rpcUrl) });
  const sql = getSql();
  const [rpcHead, rpcChain, db, indexer] = await Promise.all([
    timed(async () => Number(await client.getBlockNumber())),
    timed(() => client.getChainId()),
    timed(async () => {
      if (!sql) throw new Error("DATABASE_URL not configured");
      const [counts] = await sql`
        SELECT (SELECT count(*) FROM nations)::int AS nations,
               (SELECT count(*) FROM trades)::int AS trades,
               (SELECT count(*) FROM holders)::int AS holders,
               (SELECT count(*) FROM proposals)::int AS proposals,
               (SELECT count(*) FROM game_events)::int AS events,
               (SELECT count(*) FROM indexer_errors WHERE NOT resolved)::int AS open_errors`;
      const errors = await sql`SELECT id, at, scope, message FROM indexer_errors ORDER BY id DESC LIMIT 20`;
      const blocks = await sql`SELECT number, hash, timestamp FROM indexed_blocks ORDER BY number DESC LIMIT 8`;
      return { counts, errors, blocks, health: await indexerHealth(sql) };
    }),
    timed(async () => {
      const base = process.env.INDEXER_URL;
      if (!base) throw new Error("INDEXER_URL not configured");
      const res = await fetch(`${base.replace(/\/$/, "")}/admin/status`, {
        headers: { Authorization: `Bearer ${process.env.INDEXER_ADMIN_TOKEN ?? ""}` },
        cache: "no-store",
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`indexer responded ${res.status}`);
      return res.json();
    }),
  ]);
  return json({
    network: { key: network.key, chainId: network.chain.id, explorer: network.explorerUrl, dex: network.dex, contracts: network.contracts, configError },
    rpc: { head: rpcHead, chainId: rpcChain, chainIdMatches: rpcChain.ok ? rpcChain.value === network.chain.id : null },
    database: db,
    indexer,
    generatedAt: Math.floor(Date.now() / 1000),
  });
}
