import { createPublicClient, fallback, http, type Address, type PublicClient } from "viem";
import type { Sql } from "postgres";
import { BURN_ADDRESSES } from "@atlaspad/shared";
import type { IndexerEnv } from "./env";
import { RealtimeBus } from "./realtime/bus";

export interface Ctx {
  env: IndexerEnv;
  client: PublicClient;
  sql: Sql;
  bus: RealtimeBus;
  /** Lower-cased addresses that are never citizens (burn, protocol, DEX). Nation pairs are added per nation. */
  excluded: Map<string, { label: string; kind: string }>;
  stats: { lastSyncAt: number | null; lastSyncMs: number | null; lastGameAt: number | null; errors: number };
}

/** Known Uniswap infrastructure on Robinhood Chain that may transiently hold tokens (Uniswap docs). */
const ROBINHOOD_PROTOCOL_CONTRACTS: Record<string, string> = {
  "0x8876789976decbfcbbbe364623c63652db8c0904": "Uniswap Universal Router",
  "0x204faca1764b154221e35c0d20abb3c525710498": "Uniswap Universal Router 2.1.2",
  "0x06afba43fd06227fa663b0daecf536f6eaa6bf99": "Uniswap Universal Router",
  "0xcaf681a66d020601342297493863e78c959e5cb2": "Uniswap SwapRouter02",
  "0x000000000022d473030f116ddee9f6b43ac78ba3": "Uniswap Permit2",
  "0x000000007a1c8e570011eedf86a2a35593013cba": "UniswapX V3 Dutch Order Reactor",
};

export function createCtx(env: IndexerEnv, sql: Sql): Ctx {
  const client = createPublicClient({
    chain: env.network.chain,
    transport: fallback([http(env.network.rpcUrl, { retryCount: 3, retryDelay: 400, timeout: 20_000, batch: { batchSize: 50 } })]),
  }) as PublicClient;

  const excluded = new Map<string, { label: string; kind: string }>();
  for (const a of BURN_ADDRESSES) excluded.set(a.toLowerCase(), { label: "Burn address", kind: "burn" });
  const dex = env.network.dex;
  excluded.set(dex.uniswapV2Router.toLowerCase(), { label: "Uniswap V2 Router", kind: "dex" });
  excluded.set(dex.uniswapV2Factory.toLowerCase(), { label: "Uniswap V2 Factory", kind: "dex" });
  excluded.set(dex.weth.toLowerCase(), { label: "WETH", kind: "protocol" });
  excluded.set(dex.wif.toLowerCase(), { label: "$WIF token", kind: "protocol" });
  if (env.network.key === "robinhood") {
    for (const [a, label] of Object.entries(ROBINHOOD_PROTOCOL_CONTRACTS)) excluded.set(a, { label, kind: "dex" });
  }
  const c = env.network.contracts;
  if (c) {
    excluded.set(c.launchpad.toLowerCase(), { label: "AtlasPad Launchpad (bonding curve)", kind: "system" });
    excluded.set(c.treasury.toLowerCase(), { label: "AtlasPad Treasury", kind: "system" });
    excluded.set(c.governor.toLowerCase(), { label: "AtlasPad Governor", kind: "system" });
  }
  for (const e of env.extraExcluded) excluded.set(e.address.toLowerCase(), { label: e.label, kind: "protocol" });

  return {
    env,
    client,
    sql,
    bus: new RealtimeBus(),
    excluded,
    stats: { lastSyncAt: null, lastSyncMs: null, lastGameAt: null, errors: 0 },
  };
}

export const lower = (a: string) => a.toLowerCase() as Address;
