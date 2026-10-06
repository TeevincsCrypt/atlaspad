import { indexerHealth } from "@atlaspad/db/queries";
import { configError, network } from "@/lib/env";
import { getSql } from "@/lib/server/db";
import { json } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** Public deployment + data-availability status used for UI banners. */
export async function GET() {
  const sql = getSql();
  let indexer = null;
  let database = sql ? "ok" : "not_configured";
  if (sql) {
    try {
      indexer = await indexerHealth(sql);
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
    indexer,
  });
}
