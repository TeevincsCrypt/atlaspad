import { defineChain, type Address, type Chain } from "viem";

/**
 * Robinhood Chain mainnet — an Arbitrum Orbit L2 with ETH as the gas token.
 * Sources (verified 2026-10-06): Uniswap developer docs (v2/v3/v4 deployment tables, chainId 4663,
 * "ETH as the gas token", explorer robinhoodchain.blockscout.com) and @uniswap/sdk-core (WETH9 for 4663).
 * The deploy script re-verifies chain id, router.factory() and router.WETH() on-chain before deploying.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: ["https://rpc.mainnet.chain.robinhood.com"] },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://robinhoodchain.blockscout.com",
      apiUrl: "https://robinhoodchain.blockscout.com/api",
    },
  },
});

/** Local development chain (anvil). Never used in production builds unless explicitly configured. */
export const anvilChain = defineChain({
  id: 31337,
  name: "Anvil (local dev)",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export interface DexInfrastructure {
  uniswapV2Factory: Address;
  uniswapV2Router: Address;
  weth: Address;
}

/** Canonical Uniswap V2 + WETH on Robinhood Chain (Uniswap docs v2 deployments table; sdk-core WETH9[4663]). */
export const ROBINHOOD_DEX: DexInfrastructure = {
  uniswapV2Factory: "0x8bceaa40b9acdfaedf85adf4ff01f5ad6517937f",
  uniswapV2Router: "0x89e5db8b5aa49aa85ac63f691524311aeb649eba",
  weth: "0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73",
};

export type NetworkKey = "robinhood" | "local";

export const CHAINS: Record<NetworkKey, Chain> = {
  robinhood: robinhoodChain,
  local: anvilChain,
};

/** Addresses that are never citizens: burn sinks and the zero address. */
export const BURN_ADDRESSES: readonly Address[] = [
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dEaD",
];
