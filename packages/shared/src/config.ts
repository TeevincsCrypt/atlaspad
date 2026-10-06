import { getAddress, isAddress, type Address, type Chain } from "viem";
import { CHAINS, ROBINHOOD_DEX, type DexInfrastructure, type NetworkKey } from "./chains";

export interface AtlasContracts {
  launchpad: Address;
  governor: Address;
  treasury: Address;
}

export interface AtlasNetworkConfig {
  key: NetworkKey;
  chain: Chain;
  rpcUrl: string;
  explorerUrl: string | null;
  dex: DexInfrastructure;
  /** null until AtlasPad contracts are deployed and configured — the app then disables on-chain actions. */
  contracts: AtlasContracts | null;
  deployBlock: bigint;
  isLocal: boolean;
}

/** Raw configuration values (server: ATLAS_*, browser: NEXT_PUBLIC_ATLAS_*). */
export interface RawNetworkEnv {
  network?: string;
  rpcUrl?: string;
  launchpad?: string;
  governor?: string;
  treasury?: string;
  deployBlock?: string;
  /** Local dev only: DEX addresses come from contracts/deployments/31337.json. */
  uniswapV2Factory?: string;
  uniswapV2Router?: string;
  weth?: string;
}

export class ConfigError extends Error {}

function addr(value: string | undefined, name: string): Address | undefined {
  if (!value) return undefined;
  if (!isAddress(value, { strict: false })) throw new ConfigError(`${name} is not a valid address: ${value}`);
  return getAddress(value);
}

export function resolveNetwork(env: RawNetworkEnv): AtlasNetworkConfig {
  // Empty strings count as unset, so a blank line in an .env file falls back to the default.
  const key = (env.network || "robinhood") as NetworkKey;
  if (!(key in CHAINS)) throw new ConfigError(`Unknown ATLAS network "${env.network}". Use "robinhood" or "local".`);
  const chain = CHAINS[key];
  const isLocal = key === "local";

  let dex: DexInfrastructure = ROBINHOOD_DEX;
  if (isLocal) {
    const f = addr(env.uniswapV2Factory, "uniswapV2Factory");
    const r = addr(env.uniswapV2Router, "uniswapV2Router");
    const w = addr(env.weth, "weth");
    if (!f || !r || !w) throw new ConfigError("Local network requires uniswapV2Factory, uniswapV2Router and weth.");
    dex = { uniswapV2Factory: f, uniswapV2Router: r, weth: w };
  }

  const launchpad = addr(env.launchpad, "launchpad");
  const governor = addr(env.governor, "governor");
  const treasury = addr(env.treasury, "treasury");
  const given = [launchpad, governor, treasury].filter(Boolean).length;
  if (given !== 0 && given !== 3) throw new ConfigError("Set all three contract addresses (launchpad, governor, treasury) or none.");
  const contracts = launchpad && governor && treasury ? { launchpad, governor, treasury } : null;
  if (env.deployBlock && !/^\d+$/.test(env.deployBlock)) throw new ConfigError(`deployBlock must be a block number: ${env.deployBlock}`);

  return {
    key,
    chain,
    rpcUrl: env.rpcUrl || chain.rpcUrls.default.http[0]!,
    explorerUrl: chain.blockExplorers?.default.url ?? null,
    dex,
    contracts,
    deployBlock: env.deployBlock ? BigInt(env.deployBlock) : 0n,
    isLocal,
  };
}

export function explorerTx(cfg: Pick<AtlasNetworkConfig, "explorerUrl">, hash: string): string | null {
  return cfg.explorerUrl ? `${cfg.explorerUrl}/tx/${hash}` : null;
}

export function explorerAddress(cfg: Pick<AtlasNetworkConfig, "explorerUrl">, address: string): string | null {
  return cfg.explorerUrl ? `${cfg.explorerUrl}/address/${address}` : null;
}

export function explorerToken(cfg: Pick<AtlasNetworkConfig, "explorerUrl">, address: string): string | null {
  return cfg.explorerUrl ? `${cfg.explorerUrl}/token/${address}` : null;
}
