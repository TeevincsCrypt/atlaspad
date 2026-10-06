import { parseAbiItem, parseEventLogs, type Address, type Hash, type Log } from "viem";
import { atlasGovernorAbi, atlasLaunchpadAbi, nationTreasuryAbi, uniswapV2PairAbi } from "@atlaspad/shared/abis";
import type { Ctx } from "../context";

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const ADDRESS_CHUNK = 250;
const CONCURRENCY = 8;

export interface LogMeta {
  blockNumber: number;
  logIndex: number;
  txHash: Hash;
  timestamp: number;
  address: Address;
}

export type DecodedEvent =
  | { source: "launchpad"; eventName: string; args: Record<string, unknown>; meta: LogMeta }
  | { source: "governor"; eventName: string; args: Record<string, unknown>; meta: LogMeta }
  | { source: "treasury"; eventName: string; args: Record<string, unknown>; meta: LogMeta }
  | { source: "token"; eventName: "Transfer"; args: { from: Address; to: Address; value: bigint }; meta: LogMeta }
  | { source: "pair"; eventName: "Sync" | "Swap"; args: Record<string, unknown>; meta: LogMeta & { txFrom: Address } };

export interface FetchedBatch {
  events: DecodedEvent[];
  toBlockHash: Hash;
  toBlockTimestamp: number;
  blockHashes: Map<number, { hash: Hash; timestamp: number }>;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Fetch and decode every log AtlasPad cares about in [from, to].
 * `tokens` / `pairs` are the nation tokens and graduated pairs already known; tokens founded and pairs
 * graduated inside this range are discovered from the core logs and included automatically.
 */
export async function fetchBatch(
  ctx: Ctx,
  from: bigint,
  to: bigint,
  tokens: Address[],
  graduatedPairs: Address[],
): Promise<FetchedBatch> {
  const c = ctx.env.network.contracts!;
  const core = await ctx.client.getLogs({ address: [c.launchpad, c.governor, c.treasury], fromBlock: from, toBlock: to });

  const byAddr = (a: Address) => core.filter((l) => l.address.toLowerCase() === a.toLowerCase());
  const launchpadLogs = parseEventLogs({ abi: atlasLaunchpadAbi, logs: byAddr(c.launchpad) });
  const governorLogs = parseEventLogs({ abi: atlasGovernorAbi, logs: byAddr(c.governor) });
  const treasuryLogs = parseEventLogs({ abi: nationTreasuryAbi, logs: byAddr(c.treasury) });

  const allTokens = new Set(tokens.map((t) => t.toLowerCase()));
  const allPairs = new Set(graduatedPairs.map((p) => p.toLowerCase()));
  for (const l of launchpadLogs) {
    if (l.eventName === "NationFounded") allTokens.add((l.args.token as string).toLowerCase());
    if (l.eventName === "NationGraduated") allPairs.add((l.args.pair as string).toLowerCase());
  }

  const tokenLogs = (
    await mapLimit(chunk([...allTokens], ADDRESS_CHUNK), CONCURRENCY, (addresses) =>
      ctx.client.getLogs({ address: addresses as Address[], event: transferEvent, fromBlock: from, toBlock: to }),
    )
  ).flat();

  const pairRaw = (
    await mapLimit(chunk([...allPairs], ADDRESS_CHUNK), CONCURRENCY, (addresses) =>
      ctx.client.getLogs({ address: addresses as Address[], fromBlock: from, toBlock: to }),
    )
  ).flat();
  const pairLogs = parseEventLogs({ abi: uniswapV2PairAbi, logs: pairRaw });

  // Block timestamps / hashes.
  const blockNumbers = new Set<bigint>([to]);
  for (const l of [...core, ...tokenLogs, ...pairRaw] as Log[]) if (l.blockNumber !== null) blockNumbers.add(l.blockNumber);
  const blocks = await mapLimit([...blockNumbers], CONCURRENCY, (n) => ctx.client.getBlock({ blockNumber: n }));
  const blockHashes = new Map<number, { hash: Hash; timestamp: number }>();
  for (const b of blocks) blockHashes.set(Number(b.number), { hash: b.hash, timestamp: Number(b.timestamp) });

  // Uniswap swaps are attributed to the transaction sender.
  const swapTxs = [...new Set(pairLogs.filter((l) => l.eventName === "Swap").map((l) => l.transactionHash!))];
  const senders = new Map<string, Address>();
  await mapLimit(swapTxs, CONCURRENCY, async (hash) => {
    const tx = await ctx.client.getTransaction({ hash });
    senders.set(hash, tx.from);
  });

  const meta = (l: { blockNumber: bigint | null; logIndex: number | null; transactionHash: Hash | null; address: Address }): LogMeta => {
    const bn = Number(l.blockNumber);
    return {
      blockNumber: bn,
      logIndex: l.logIndex ?? 0,
      txHash: l.transactionHash!,
      timestamp: blockHashes.get(bn)!.timestamp,
      address: l.address,
    };
  };

  const events: DecodedEvent[] = [];
  for (const l of launchpadLogs) events.push({ source: "launchpad", eventName: l.eventName, args: l.args as never, meta: meta(l) });
  for (const l of governorLogs) events.push({ source: "governor", eventName: l.eventName, args: l.args as never, meta: meta(l) });
  for (const l of treasuryLogs) events.push({ source: "treasury", eventName: l.eventName, args: l.args as never, meta: meta(l) });
  for (const l of tokenLogs) {
    events.push({
      source: "token",
      eventName: "Transfer",
      args: l.args as { from: Address; to: Address; value: bigint },
      meta: meta(l),
    });
  }
  for (const l of pairLogs) {
    events.push({
      source: "pair",
      eventName: l.eventName as "Sync" | "Swap",
      args: l.args as never,
      meta: { ...meta(l), txFrom: senders.get(l.transactionHash!) ?? ("0x0000000000000000000000000000000000000000" as Address) },
    });
  }
  events.sort((a, b) => a.meta.blockNumber - b.meta.blockNumber || a.meta.logIndex - b.meta.logIndex);

  const head = blockHashes.get(Number(to))!;
  return { events, toBlockHash: head.hash, toBlockTimestamp: head.timestamp, blockHashes };
}

/** RPC errors that mean "ask for a smaller block range". */
export function isRangeError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err).toLowerCase();
  return (
    msg.includes("block range") ||
    msg.includes("too many") ||
    msg.includes("limit exceeded") ||
    msg.includes("response size") ||
    msg.includes("query returned more than") ||
    msg.includes("range is too large")
  );
}
