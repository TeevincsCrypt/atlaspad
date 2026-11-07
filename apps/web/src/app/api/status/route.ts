import { indexerHealth } from "@atlaspad/db/queries";
import { configError, network } from "@/lib/env";
import { dbMode, getSql } from "@/lib/server/db";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Public deployment + data-availability status used for UI banners. */
export async function GET() {
  const sql = getSql();
  let indexer = null;
  let database = sql ? "ok" : "not_configured";
  let databaseMs: number | null = null;
  if (sql) {
    const t0 = Date.now();
    try {
      indexer = await indexerHealth(sql);
      databaseMs = Date.now() - t0;
    } catch {
      database = "unavailable";
    }
  }
  return json({
    chainId: network.chain.id,
    chainName: network.chain.name,
    explorer: network.explorerUrl,
    contracts: network.contracts,
    deployed: network.contracts !== null && !configError,
    configError,
    database,
    // How long one read took from this server and which kind of database connection it uses (no host or secret).
    databaseMs,
    databaseMode: dbMode(),
    region: process.env.VERCEL_REGION ?? null,
    indexer,
  });
}
