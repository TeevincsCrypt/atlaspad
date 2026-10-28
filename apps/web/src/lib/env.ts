import { ConfigError, resolveNetwork, type AtlasNetworkConfig } from "@atlaspad/shared";

/**
 * Browser-safe configuration. Every value comes from NEXT_PUBLIC_* environment variables (see ENVIRONMENT.md).
 * Next.js inlines these at build time, so each must be referenced literally.
 */
export const publicEnv = {
  network: process.env.NEXT_PUBLIC_ATLAS_NETWORK,
  rpcUrl: process.env.NEXT_PUBLIC_RPC_URL,
  launchpad: process.env.NEXT_PUBLIC_ATLAS_LAUNCHPAD,
  governor: process.env.NEXT_PUBLIC_ATLAS_GOVERNOR,
  treasury: process.env.NEXT_PUBLIC_ATLAS_TREASURY,
  deployBlock: process.env.NEXT_PUBLIC_ATLAS_DEPLOY_BLOCK,
  uniswapV2Factory: process.env.NEXT_PUBLIC_ATLAS_UNISWAP_V2_FACTORY,
  uniswapV2Router: process.env.NEXT_PUBLIC_ATLAS_UNISWAP_V2_ROUTER,
  weth: process.env.NEXT_PUBLIC_ATLAS_WETH,
  wif: process.env.NEXT_PUBLIC_ATLAS_WIF,
  /** Where "Get $WIF" sends people. Defaults to the Uniswap app with $WIF preselected as the output token. */
  getWifUrl: process.env.NEXT_PUBLIC_GET_WIF_URL || "",
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
  realtimeUrl: (process.env.NEXT_PUBLIC_REALTIME_URL || "").replace(/\/$/, ""),
  // Used for page metadata and wallet-connection metadata; set it to the public origin in production.
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, ""),
};

function load(): { network: AtlasNetworkConfig; error: string | null } {
  try {
    return { network: resolveNetwork(publicEnv), error: null };
  } catch (err) {
    const message = err instanceof ConfigError ? err.message : String(err);
    // Fall back to Robinhood Chain without contracts: the app renders, and every on-chain action is disabled.
    return { network: resolveNetwork({ network: "robinhood" }), error: message };
  }
}

const loaded = load();
export const network = loaded.network;
export const configError = loaded.error;
export const contracts = network.contracts;
export const isDeployed = contracts !== null && configError === null;
export const wifToken = network.dex.wif;
export const getWifUrl = publicEnv.getWifUrl || `https://app.uniswap.org/swap?outputCurrency=${network.dex.wif}`;
