import { getAddress, isAddress, type Address } from "viem";
import { resolveNetwork, type AtlasNetworkConfig } from "@atlaspad/shared";

export interface IndexerEnv {
  network: AtlasNetworkConfig;
  databaseUrl: string;
  databaseSsl: boolean;
  port: number;
  confirmations: number;
  batchBlocks: number;
  pollMs: number;
  adminToken: string | null;
  corsOrigin: string;
  ethUsdSource: "coinbase" | "none";
  extraExcluded: { address: Address; label: string }[];
  runMigrations: boolean;
}

function int(name: string, fallback: number, min = 0): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer >= ${min}`);
  return n;
}

export function loadEnv(): IndexerEnv {
  const network = resolveNetwork({
    network: process.env.ATLAS_NETWORK,
    rpcUrl: process.env.ATLAS_RPC_URL,
    launchpad: process.env.ATLAS_LAUNCHPAD,
    governor: process.env.ATLAS_GOVERNOR,
    treasury: process.env.ATLAS_TREASURY,
    deployBlock: process.env.ATLAS_DEPLOY_BLOCK,
    uniswapV2Factory: process.env.ATLAS_UNISWAP_V2_FACTORY,
    uniswapV2Router: process.env.ATLAS_UNISWAP_V2_ROUTER,
    weth: process.env.ATLAS_WETH,
  });
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");

  const extraExcluded = (process.env.EXCLUDED_ADDRESSES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((entry) => {
      const [address, ...label] = entry.split(":");
      if (!address || !isAddress(address, { strict: false })) throw new Error(`Invalid EXCLUDED_ADDRESSES entry: ${entry}`);
      return { address: getAddress(address), label: label.join(":") || "Excluded" };
    });

  const source = process.env.ETH_USD_SOURCE || "none";
  if (source !== "coinbase" && source !== "none") throw new Error('ETH_USD_SOURCE must be "coinbase" or "none"');

  return {
    network,
    databaseUrl,
    databaseSsl: process.env.DATABASE_SSL === "true",
    port: int("PORT", int("INDEXER_PORT", 4100)),
    confirmations: int("INDEXER_CONFIRMATIONS", 2),
    batchBlocks: int("INDEXER_BATCH_BLOCKS", 2000, 1),
    pollMs: int("INDEXER_POLL_MS", 2000, 250),
    adminToken: process.env.INDEXER_ADMIN_TOKEN || null,
    corsOrigin: process.env.INDEXER_CORS_ORIGIN || "*",
    ethUsdSource: source,
    extraExcluded,
    runMigrations: process.env.INDEXER_RUN_MIGRATIONS !== "false",
  };
}
