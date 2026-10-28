import type { Sql, TransactionSql } from "postgres";
import type { Address } from "viem";
import type { Ctx } from "../context";
import type { DecodedEvent, FetchedBatch } from "./fetch";
import {
  NATION_COLUMNS,
  citizenThreshold,
  nationLiquidity,
  nationMarketCap,
  nationPrice,
  rowToDb,
  type NationCache,
  type NationRow,
} from "./nations";

const ZERO = "0x0000000000000000000000000000000000000000";

export interface TradeRecord {
  nationId: number;
  txHash: string;
  logIndex: number;
  trader: string;
  isBuy: boolean;
  wifAmount: bigint;
  tokenAmount: bigint;
  priceWif: number;
  marketCapWif: number;
  marketCapBeforeWif: number | null;
  liquidityWif: number;
  venue: "curve" | "uniswap";
  blockNumber: number;
  timestamp: number;
}

export interface ApplyResult {
  affectedNations: Set<number>;
  trades: TradeRecord[];
  founded: { nationId: number; txHash: string; timestamp: number; blockNumber: number }[];
  graduated: { nationId: number; txHash: string; timestamp: number; blockNumber: number; wifLiquidity: bigint }[];
  burns: { nationId: number; amount: bigint; creationFee: boolean; timestamp: number }[];
  proposalsCreated: { id: number; nationId: number; proposer: string; kind: number; timestamp: number; txHash: string; blockNumber: number }[];
  proposalsExecuted: { id: number; nationId: number; kind: number; timestamp: number; txHash: string; blockNumber: number }[];
  proposalsTouched: Set<number>;
  votes: { proposalId: number; nationId: number; voter: string; support: number; timestamp: number }[];
  symbolUpdates: { nationId: number; txHash: string; logIndex: number; timestamp: number; blockNumber: number }[];
  releases: { nationId: number; to: string; amount: bigint; proposalId: number; txHash: string; logIndex: number; timestamp: number; blockNumber: number }[];
  newCitizens: { nationId: number; address: string; timestamp: number }[];
  gameActions: number;
}

interface HolderState {
  nationId: number;
  address: string;
  balance: bigint;
  firstHeldAt: number;
  startBalance: bigint;
  becameCitizenAt: number | null;
}

const num = (v: unknown) => Number(v as bigint);
const str = (v: unknown) => (v as bigint).toString();

/**
 * Apply one fetched block range inside a single database transaction.
 * Returns what changed so the caller can refresh metrics and publish realtime updates after commit.
 */
export async function applyBatch(
  ctx: Ctx,
  sql: Sql,
  cache: NationCache,
  batch: FetchedBatch,
  toBlock: number,
): Promise<{ result: ApplyResult; updatedNations: NationRow[] }> {
  const result: ApplyResult = {
    affectedNations: new Set(),
    trades: [],
    founded: [],
    graduated: [],
    burns: [],
    proposalsCreated: [],
    proposalsExecuted: [],
    proposalsTouched: new Set(),
    votes: [],
    symbolUpdates: [],
    releases: [],
    newCitizens: [],
    gameActions: 0,
  };
  const wif = ctx.env.network.dex.wif.toLowerCase();
  const working = new Map<number, NationRow>();
  const nation = (id: number): NationRow | undefined => {
    if (working.has(id)) return working.get(id);
    const cached = cache.byId.get(id);
    if (!cached) return undefined;
    const copy = { ...cached };
    working.set(id, copy);
    return copy;
  };
  const tokenToId = new Map(cache.byToken);
  const pairToId = new Map(cache.byPair);

  const tradeRows: Record<string, unknown>[] = [];
  const transferRows: Record<string, unknown>[] = [];
  const treasuryRows: Record<string, unknown>[] = [];
  const proposalRows: Record<string, unknown>[] = [];
  const voteRows: Record<string, unknown>[] = [];
  const actionRows: Record<string, unknown>[] = [];
  const canceled: number[] = [];
  const executed: { id: number; at: number; tx: string }[] = [];

  // Holder balances touched by this batch.
  const transfersByNation = new Map<number, Set<string>>();
  for (const e of batch.events) {
    if (e.source !== "token") continue;
    let id = tokenToId.get(e.meta.address.toLowerCase());
    if (id === undefined) {
      // token founded in this batch — resolved below once NationFounded is applied; collect lazily
      id = -1;
    }
    if (id < 0) continue;
    const set = transfersByNation.get(id) ?? new Set<string>();
    set.add(e.args.from.toLowerCase());
    set.add(e.args.to.toLowerCase());
    transfersByNation.set(id, set);
  }
  const holders = new Map<string, HolderState>();
  const hkey = (nationId: number, address: string) => `${nationId}:${address}`;
  for (const [nationId, addrs] of transfersByNation) {
    const list = [...addrs].filter((a) => a !== ZERO);
    if (!list.length) continue;
    const rows = await sql`SELECT address, balance, first_held_at FROM holders WHERE nation_id = ${nationId} AND address = ANY(${list})`;
    for (const r of rows) {
      const bal = BigInt(r.balance as string);
      holders.set(hkey(nationId, r.address as string), {
        nationId,
        address: r.address as string,
        balance: bal,
        firstHeldAt: Number(r.first_held_at),
        startBalance: bal,
        becameCitizenAt: null,
      });
    }
  }
  const holder = (nationId: number, address: string): HolderState => {
    const k = hkey(nationId, address);
    let h = holders.get(k);
    if (!h) {
      h = { nationId, address, balance: 0n, firstHeldAt: 0, startBalance: 0n, becameCitizenAt: null };
      holders.set(k, h);
    }
    return h;
  };

  // Pass 1: register nations founded in this batch. A token's mint Transfer is emitted (inside the token
  // constructor) before the launchpad's NationFounded/CurveInitialized logs, so these must be known first.
  for (const e of batch.events) {
    if (e.source !== "launchpad" || (e.eventName !== "NationFounded" && e.eventName !== "CurveInitialized")) continue;
    applyFounding(e, working, tokenToId, pairToId, wif, result);
  }

  for (const e of batch.events) {
    const m = e.meta;
    if (e.source === "launchpad") {
      const a = e.args;
      const id = num(a.nationId);
      switch (e.eventName) {
        case "NationFounded":
        case "CurveInitialized":
          break; // handled in pass 1
        case "Trade": {
          const n = nation(id);
          if (!n) break;
          const mcapBefore = nationMarketCap(n);
          n.virtualWif = a.virtualWif as bigint;
          n.virtualTokens = a.virtualTokens as bigint;
          n.realWif = a.realWif as bigint;
          n.curveTokensRemaining = a.curveTokensRemaining as bigint;
          const price = nationPrice(n) ?? 0;
          const rec: TradeRecord = {
            nationId: id,
            txHash: m.txHash,
            logIndex: m.logIndex,
            trader: (a.trader as string).toLowerCase(),
            isBuy: Boolean(a.isBuy),
            wifAmount: a.wifAmount as bigint,
            tokenAmount: a.tokenAmount as bigint,
            priceWif: price,
            marketCapWif: nationMarketCap(n) ?? 0,
            marketCapBeforeWif: mcapBefore,
            liquidityWif: nationLiquidity(n),
            venue: "curve",
            blockNumber: m.blockNumber,
            timestamp: m.timestamp,
          };
          result.trades.push(rec);
          tradeRows.push(tradeRow(rec, a.fee as bigint));
          break;
        }
        case "WifBurned": {
          const n = nation(id);
          if (!n) break;
          n.wifBurned += a.amount as bigint;
          result.burns.push({ nationId: id, amount: a.amount as bigint, creationFee: Boolean(a.creationFee), timestamp: m.timestamp });
          break;
        }
        case "NationGraduated": {
          const n = nation(id);
          if (!n) break;
          n.graduated = true;
          n.graduatedAt = m.timestamp;
          n.graduationTx = m.txHash;
          n.graduationWif = a.wifLiquidity as bigint;
          n.realWif = 0n;
          n.curveTokensRemaining = 0n;
          n.poolWifReserve = a.wifLiquidity as bigint;
          n.poolTokenReserve = a.tokenLiquidity as bigint;
          n.lpReserve = 0n;
          result.graduated.push({
            nationId: id,
            txHash: m.txHash,
            timestamp: m.timestamp,
            blockNumber: m.blockNumber,
            wifLiquidity: a.wifLiquidity as bigint,
          });
          break;
        }
        case "NationSymbolUpdated": {
          const n = nation(id);
          if (!n) break;
          n.emblem = str(a.emblem);
          n.metadataUri = a.metadataURI as string;
          result.symbolUpdates.push({ nationId: id, txHash: m.txHash, logIndex: m.logIndex, timestamp: m.timestamp, blockNumber: m.blockNumber });
          break;
        }
        default:
          break; // FounderTokensClaimed / ProtocolFeesWithdrawn are covered by Transfer logs / admin views
      }
      result.affectedNations.add(id);
      continue;
    }

    if (e.source === "treasury") {
      const a = e.args;
      const id = num(a.nationId);
      if (e.eventName === "Deposited") {
        treasuryRows.push({
          tx_hash: m.txHash,
          log_index: m.logIndex,
          nation_id: id,
          direction: "in",
          amount: str(a.amount),
          counterparty: (a.from as string).toLowerCase(),
          kind: a.fromTradeFees ? "trade_fee" : "donation",
          proposal_id: null,
          block_number: m.blockNumber,
          timestamp: m.timestamp,
        });
      } else if (e.eventName === "Released") {
        treasuryRows.push({
          tx_hash: m.txHash,
          log_index: m.logIndex,
          nation_id: id,
          direction: "out",
          amount: str(a.amount),
          counterparty: (a.to as string).toLowerCase(),
          kind: "release",
          proposal_id: num(a.proposalId),
          block_number: m.blockNumber,
          timestamp: m.timestamp,
        });
        result.releases.push({
          nationId: id,
          to: (a.to as string).toLowerCase(),
          amount: a.amount as bigint,
          proposalId: num(a.proposalId),
          txHash: m.txHash,
          logIndex: m.logIndex,
          timestamp: m.timestamp,
          blockNumber: m.blockNumber,
        });
      }
      result.affectedNations.add(id);
      continue;
    }

    if (e.source === "governor") {
      const a = e.args;
      const pid = num(a.proposalId);
      const nid = num(a.nationId);
      switch (e.eventName) {
        case "ProposalCreated":
          proposalRows.push({
            id: pid,
            nation_id: nid,
            proposer: (a.proposer as string).toLowerCase(),
            kind: Number(a.kind),
            payload: a.payload as string,
            description: a.description as string,
            snapshot: Number(a.snapshot),
            vote_end: Number(a.voteEnd),
            eta: Number(a.eta),
            quorum: str(a.quorum),
            created_at: m.timestamp,
            created_block: m.blockNumber,
            tx_hash: m.txHash,
          });
          result.proposalsCreated.push({
            id: pid,
            nationId: nid,
            proposer: (a.proposer as string).toLowerCase(),
            kind: Number(a.kind),
            timestamp: m.timestamp,
            txHash: m.txHash,
            blockNumber: m.blockNumber,
          });
          break;
        case "VoteCast":
          voteRows.push({
            proposal_id: pid,
            voter: (a.voter as string).toLowerCase(),
            nation_id: nid,
            support: Number(a.support),
            weight: str(a.weight),
            reason: a.reason as string,
            tx_hash: m.txHash,
            block_number: m.blockNumber,
            timestamp: m.timestamp,
          });
          result.votes.push({ proposalId: pid, nationId: nid, voter: (a.voter as string).toLowerCase(), support: Number(a.support), timestamp: m.timestamp });
          break;
        case "ProposalCanceled":
          canceled.push(pid);
          break;
        case "ProposalExecuted":
          executed.push({ id: pid, at: m.timestamp, tx: m.txHash });
          result.proposalsExecuted.push({ id: pid, nationId: nid, kind: Number(a.kind), timestamp: m.timestamp, txHash: m.txHash, blockNumber: m.blockNumber });
          break;
        case "GameActionExecuted":
          actionRows.push({
            proposal_id: pid,
            nation_id: nid,
            action: Number(a.action),
            arg: str(a.arg),
            text: a.text as string,
            tx_hash: m.txHash,
            log_index: m.logIndex,
            block_number: m.blockNumber,
            timestamp: m.timestamp,
          });
          result.gameActions++;
          break;
        default:
          break;
      }
      result.proposalsTouched.add(pid);
      result.affectedNations.add(nid);
      continue;
    }

    if (e.source === "token") {
      const id = tokenToId.get(m.address.toLowerCase());
      if (id === undefined) continue;
      const n = nation(id)!;
      const from = e.args.from.toLowerCase();
      const to = e.args.to.toLowerCase();
      const value = e.args.value;
      transferRows.push({
        tx_hash: m.txHash,
        log_index: m.logIndex,
        nation_id: id,
        from_address: from,
        to_address: to,
        amount: value.toString(),
        block_number: m.blockNumber,
        timestamp: m.timestamp,
      });
      const threshold = citizenThreshold(n);
      if (from !== ZERO) {
        const h = holder(id, from);
        h.balance -= value;
        if (h.balance < 0n) h.balance = 0n; // defensive; cannot happen for a valid ERC-20 log stream
      }
      if (to !== ZERO) {
        const h = holder(id, to);
        if (h.balance === 0n) h.firstHeldAt = m.timestamp;
        const before = h.balance;
        h.balance += value;
        const excluded = ctx.excluded.has(to) || to === n.pair;
        if (!excluded && before < threshold && h.balance >= threshold && h.becameCitizenAt === null) {
          h.becameCitizenAt = m.timestamp;
        }
      }
      result.affectedNations.add(id);
      continue;
    }

    if (e.source === "pair") {
      const id = pairToId.get(m.address.toLowerCase());
      if (id === undefined) continue;
      const n = nation(id)!;
      if (!n.graduated) continue; // pre-graduation donations/syncs do not represent a live market
      const a = e.args;
      if (e.eventName === "Sync") {
        const r0 = a.reserve0 as bigint;
        const r1 = a.reserve1 as bigint;
        n.poolTokenReserve = n.tokenIsToken0 ? r0 : r1;
        n.poolWifReserve = n.tokenIsToken0 ? r1 : r0;
      } else {
        const t0 = Boolean(n.tokenIsToken0);
        const tokenIn = (t0 ? a.amount0In : a.amount1In) as bigint;
        const tokenOut = (t0 ? a.amount0Out : a.amount1Out) as bigint;
        const wifIn = (t0 ? a.amount1In : a.amount0In) as bigint;
        const wifOut = (t0 ? a.amount1Out : a.amount0Out) as bigint;
        const isBuy = tokenOut > 0n;
        const price = nationPrice(n) ?? 0;
        const rec: TradeRecord = {
          nationId: id,
          txHash: m.txHash,
          logIndex: m.logIndex,
          trader: (e.meta as { txFrom: Address }).txFrom.toLowerCase(),
          isBuy,
          wifAmount: isBuy ? wifIn : wifOut,
          tokenAmount: isBuy ? tokenOut : tokenIn,
          priceWif: price,
          marketCapWif: nationMarketCap(n) ?? 0,
          marketCapBeforeWif: null,
          liquidityWif: nationLiquidity(n),
          venue: "uniswap",
          blockNumber: m.blockNumber,
          timestamp: m.timestamp,
        };
        // market cap before = price implied by reserves before this swap
        const tokBefore = (n.poolTokenReserve ?? 0n) + (isBuy ? tokenOut : -tokenIn);
        const wifBefore = (n.poolWifReserve ?? 0n) - (isBuy ? wifIn : -wifOut);
        if (tokBefore > 0n) rec.marketCapBeforeWif = ((Number(wifBefore) / Number(tokBefore)) * Number(n.totalSupply)) / 1e18;
        result.trades.push(rec);
        tradeRows.push(tradeRow(rec, 0n));
      }
      result.affectedNations.add(id);
    }
  }

  // Holders founded inside this batch were not pre-loaded; they start from zero, which is correct
  // because a token's first Transfer is its mint inside the founding transaction.

  const updatedNations = [...working.values()];
  const newCitizens: ApplyResult["newCitizens"] = [];
  for (const h of holders.values()) {
    if (h.becameCitizenAt !== null) {
      const n = working.get(h.nationId) ?? cache.byId.get(h.nationId);
      if (n && h.balance >= citizenThreshold(n)) newCitizens.push({ nationId: h.nationId, address: h.address, timestamp: h.becameCitizenAt });
    }
  }
  result.newCitizens = newCitizens;

  await sql.begin(async (tx) => {
    await writeNations(tx, updatedNations);
    if (tradeRows.length) await tx`INSERT INTO trades ${tx(tradeRows as never[])} ON CONFLICT DO NOTHING`;
    for (const part of chunks(transferRows, 2000)) await tx`INSERT INTO transfers ${tx(part as never[])} ON CONFLICT DO NOTHING`;
    if (treasuryRows.length) await tx`INSERT INTO treasury_txs ${tx(treasuryRows as never[])} ON CONFLICT DO NOTHING`;
    if (proposalRows.length) await tx`INSERT INTO proposals ${tx(proposalRows as never[])} ON CONFLICT DO NOTHING`;
    if (voteRows.length) await tx`INSERT INTO votes ${tx(voteRows as never[])} ON CONFLICT DO NOTHING`;
    if (actionRows.length) await tx`INSERT INTO game_action_events ${tx(actionRows as never[])} ON CONFLICT DO NOTHING`;
    if (canceled.length) await tx`UPDATE proposals SET canceled = true WHERE id = ANY(${canceled})`;
    for (const ex of executed) {
      await tx`UPDATE proposals SET executed = true, executed_at = ${ex.at}, executed_tx = ${ex.tx} WHERE id = ${ex.id}`;
    }
    if (voteRows.length) {
      const ids = [...new Set(voteRows.map((v) => v.proposal_id as number))];
      await tx`
        UPDATE proposals p SET
          for_votes = COALESCE((SELECT sum(weight) FROM votes v WHERE v.proposal_id = p.id AND v.support = 1), 0),
          against_votes = COALESCE((SELECT sum(weight) FROM votes v WHERE v.proposal_id = p.id AND v.support = 0), 0),
          abstain_votes = COALESCE((SELECT sum(weight) FROM votes v WHERE v.proposal_id = p.id AND v.support = 2), 0)
        WHERE p.id = ANY(${ids})`;
    }
    await writeHolders(tx, [...holders.values()], toBlock);
    const blocks = [...batch.blockHashes.entries()].map(([number, b]) => ({ number, hash: b.hash, timestamp: b.timestamp }));
    if (blocks.length) {
      await tx`INSERT INTO indexed_blocks ${tx(blocks)} ON CONFLICT (number) DO UPDATE SET hash = excluded.hash, timestamp = excluded.timestamp`;
    }
    await tx`DELETE FROM indexed_blocks WHERE number < ${toBlock - 512}`;
    await tx`
      UPDATE indexer_state SET last_block = ${toBlock}, last_block_hash = ${batch.toBlockHash},
        last_block_timestamp = ${batch.toBlockTimestamp}, updated_at = now()
      WHERE id = 'main'`;
  });

  return { result, updatedNations };
}

function applyFounding(
  e: DecodedEvent,
  working: Map<number, NationRow>,
  tokenToId: Map<string, number>,
  pairToId: Map<string, number>,
  wif: string,
  result: ApplyResult,
) {
  const a = e.args as Record<string, unknown>;
  const m = e.meta;
  const id = num(a.nationId);
  if (e.eventName === "NationFounded") {
    const token = (a.token as string).toLowerCase();
    working.set(id, {
      id,
      token,
      pair: "",
      founder: (a.founder as string).toLowerCase(),
      name: a.name as string,
      ticker: a.symbol as string,
      description: a.description as string,
      theme: Number(a.theme),
      emblem: str(a.emblem),
      metadataUri: a.metadataURI as string,
      totalSupply: 0n,
      curveSupply: 0n,
      lpReserve: 0n,
      founderAllocation: 0n,
      initialVirtualWif: 0n,
      initialVirtualTokens: 1n,
      virtualWif: 0n,
      virtualTokens: 1n,
      realWif: 0n,
      curveTokensRemaining: 0n,
      graduated: false,
      graduatedAt: null,
      graduationTx: null,
      graduationWif: null,
      tokenIsToken0: token < wif,
      poolTokenReserve: null,
      poolWifReserve: null,
      wifBurned: 0n,
      createdAt: m.timestamp,
      createdBlock: m.blockNumber,
      createdTx: m.txHash,
    });
    tokenToId.set(token, id);
    result.founded.push({ nationId: id, txHash: m.txHash, timestamp: m.timestamp, blockNumber: m.blockNumber });
  } else {
    const n = working.get(id);
    if (!n) return;
    n.pair = (a.pair as string).toLowerCase();
    n.totalSupply = a.totalSupply as bigint;
    n.curveSupply = a.curveSupply as bigint;
    n.lpReserve = a.lpReserve as bigint;
    n.founderAllocation = a.founderAllocation as bigint;
    n.initialVirtualWif = a.virtualWif as bigint;
    n.initialVirtualTokens = a.virtualTokens as bigint;
    n.virtualWif = a.virtualWif as bigint;
    n.virtualTokens = a.virtualTokens as bigint;
    n.curveTokensRemaining = a.curveSupply as bigint;
    pairToId.set(n.pair, id);
  }
  result.affectedNations.add(id);
}

function tradeRow(r: TradeRecord, fee: bigint): Record<string, unknown> {
  return {
    tx_hash: r.txHash,
    log_index: r.logIndex,
    nation_id: r.nationId,
    trader: r.trader,
    is_buy: r.isBuy,
    wif_amount: r.wifAmount.toString(),
    token_amount: r.tokenAmount.toString(),
    fee: fee.toString(),
    price_wif: r.priceWif,
    market_cap_wif: r.marketCapWif,
    liquidity_wif: r.liquidityWif,
    venue: r.venue,
    block_number: r.blockNumber,
    timestamp: r.timestamp,
  };
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function writeNations(tx: TransactionSql, rows: NationRow[]) {
  if (!rows.length) return;
  const data = rows.map(rowToDb);
  const updates = NATION_COLUMNS.filter((c) => c !== "id")
    .map((c) => `${c} = excluded.${c}`)
    .join(", ");
  await tx`INSERT INTO nations ${tx(data as never[])} ON CONFLICT (id) DO UPDATE SET ${tx.unsafe(updates)}`;
}

async function writeHolders(tx: TransactionSql, states: HolderState[], block: number) {
  const positive = states.filter((h) => h.balance > 0n);
  const zero = states.filter((h) => h.balance === 0n && h.startBalance > 0n);
  for (const part of chunks(positive, 2000)) {
    await tx`
      INSERT INTO holders ${tx(
        part.map((h) => ({
          nation_id: h.nationId,
          address: h.address,
          balance: h.balance.toString(),
          first_held_at: h.firstHeldAt,
          updated_block: block,
        })),
      )}
      ON CONFLICT (nation_id, address) DO UPDATE SET
        balance = excluded.balance, first_held_at = excluded.first_held_at, updated_block = excluded.updated_block`;
  }
  for (const h of zero) {
    await tx`DELETE FROM holders WHERE nation_id = ${h.nationId} AND address = ${h.address}`;
  }
}

export type { DecodedEvent };
