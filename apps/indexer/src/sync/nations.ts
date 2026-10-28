import type { Sql } from "postgres";

/** In-memory mirror of the `nations` table row (uint256 as bigint). */
export interface NationRow {
  id: number;
  token: string;
  pair: string;
  founder: string;
  name: string;
  ticker: string;
  description: string;
  theme: number;
  emblem: string;
  metadataUri: string;
  totalSupply: bigint;
  curveSupply: bigint;
  lpReserve: bigint;
  founderAllocation: bigint;
  initialVirtualWif: bigint;
  initialVirtualTokens: bigint;
  virtualWif: bigint;
  virtualTokens: bigint;
  realWif: bigint;
  curveTokensRemaining: bigint;
  graduated: boolean;
  graduatedAt: number | null;
  graduationTx: string | null;
  graduationWif: bigint | null;
  tokenIsToken0: boolean | null;
  poolTokenReserve: bigint | null;
  poolWifReserve: bigint | null;
  /** $WIF burned on behalf of this nation (WifBurned events). */
  wifBurned: bigint;
  createdAt: number;
  createdBlock: number;
  createdTx: string;
}

const big = (v: unknown) => (v === null || v === undefined ? null : BigInt(v as string));

export function rowFromDb(r: Record<string, unknown>): NationRow {
  return {
    id: Number(r.id),
    token: String(r.token),
    pair: String(r.pair),
    founder: String(r.founder),
    name: String(r.name),
    ticker: String(r.ticker),
    description: String(r.description ?? ""),
    theme: Number(r.theme),
    emblem: String(r.emblem),
    metadataUri: String(r.metadata_uri ?? ""),
    totalSupply: BigInt(r.total_supply as string),
    curveSupply: BigInt(r.curve_supply as string),
    lpReserve: BigInt(r.lp_reserve as string),
    founderAllocation: BigInt(r.founder_allocation as string),
    initialVirtualWif: BigInt(r.initial_virtual_wif as string),
    initialVirtualTokens: BigInt(r.initial_virtual_tokens as string),
    virtualWif: BigInt(r.virtual_wif as string),
    virtualTokens: BigInt(r.virtual_tokens as string),
    realWif: BigInt(r.real_wif as string),
    curveTokensRemaining: BigInt(r.curve_tokens_remaining as string),
    graduated: Boolean(r.graduated),
    graduatedAt: r.graduated_at === null ? null : Number(r.graduated_at),
    graduationTx: (r.graduation_tx as string | null) ?? null,
    graduationWif: big(r.graduation_wif),
    tokenIsToken0: (r.token_is_token0 as boolean | null) ?? null,
    poolTokenReserve: big(r.pool_token_reserve),
    poolWifReserve: big(r.pool_wif_reserve),
    wifBurned: BigInt((r.wif_burned as string | null) ?? "0"),
    createdAt: Number(r.created_at),
    createdBlock: Number(r.created_block),
    createdTx: String(r.created_tx),
  };
}

export function rowToDb(n: NationRow): Record<string, string | number | boolean | null> {
  const s = (v: bigint | null) => (v === null ? null : v.toString());
  return {
    id: n.id,
    token: n.token,
    pair: n.pair,
    founder: n.founder,
    name: n.name,
    ticker: n.ticker,
    description: n.description,
    theme: n.theme,
    emblem: n.emblem,
    metadata_uri: n.metadataUri,
    total_supply: n.totalSupply.toString(),
    curve_supply: n.curveSupply.toString(),
    lp_reserve: n.lpReserve.toString(),
    founder_allocation: n.founderAllocation.toString(),
    initial_virtual_wif: n.initialVirtualWif.toString(),
    initial_virtual_tokens: n.initialVirtualTokens.toString(),
    virtual_wif: n.virtualWif.toString(),
    virtual_tokens: n.virtualTokens.toString(),
    real_wif: n.realWif.toString(),
    curve_tokens_remaining: n.curveTokensRemaining.toString(),
    graduated: n.graduated,
    graduated_at: n.graduatedAt,
    graduation_tx: n.graduationTx,
    graduation_wif: s(n.graduationWif),
    token_is_token0: n.tokenIsToken0,
    pool_token_reserve: s(n.poolTokenReserve),
    pool_wif_reserve: s(n.poolWifReserve),
    wif_burned: n.wifBurned.toString(),
    created_at: n.createdAt,
    created_block: n.createdBlock,
    created_tx: n.createdTx,
  };
}

export const NATION_COLUMNS = Object.keys(
  rowToDb({
    id: 0, token: "", pair: "", founder: "", name: "", ticker: "", description: "", theme: 0, emblem: "0",
    metadataUri: "", totalSupply: 0n, curveSupply: 0n, lpReserve: 0n, founderAllocation: 0n,
    initialVirtualWif: 0n, initialVirtualTokens: 0n, virtualWif: 0n, virtualTokens: 0n, realWif: 0n,
    curveTokensRemaining: 0n, graduated: false, graduatedAt: null, graduationTx: null, graduationWif: null,
    tokenIsToken0: null, poolTokenReserve: null, poolWifReserve: null, wifBurned: 0n, createdAt: 0, createdBlock: 0, createdTx: "",
  }),
);

const WAD = 1e18;

/** Spot price in $WIF per whole token. Curve: virtual reserves. Graduated: Uniswap V2 reserves. */
export function nationPrice(n: NationRow): number | null {
  if (n.graduated) {
    if (!n.poolTokenReserve || !n.poolWifReserve || n.poolTokenReserve === 0n) return null;
    return Number(n.poolWifReserve) / Number(n.poolTokenReserve);
  }
  if (n.virtualTokens === 0n) return null;
  return Number(n.virtualWif) / Number(n.virtualTokens);
}

/** ETH-side liquidity depth: curve ETH reserve, or the pool's WETH reserve after graduation. */
export function nationLiquidity(n: NationRow): number {
  if (n.graduated) return n.poolWifReserve ? Number(n.poolWifReserve) / WAD : 0;
  return Number(n.realWif) / WAD;
}

export function nationMarketCap(n: NationRow): number | null {
  const p = nationPrice(n);
  return p === null ? null : (p * Number(n.totalSupply)) / WAD;
}

export function openingPrice(n: NationRow): number {
  return Number(n.initialVirtualWif) / Number(n.initialVirtualTokens);
}

/** Holders at or above this balance count as citizens (0.0001% of supply). */
export function citizenThreshold(n: Pick<NationRow, "totalSupply">): bigint {
  return n.totalSupply / 1_000_000n;
}

export class NationCache {
  byId = new Map<number, NationRow>();
  byToken = new Map<string, number>();
  byPair = new Map<string, number>();

  async load(sql: Sql) {
    const rows = await sql`SELECT * FROM nations ORDER BY id`;
    this.byId.clear();
    this.byToken.clear();
    this.byPair.clear();
    for (const r of rows) this.put(rowFromDb(r));
  }

  put(n: NationRow) {
    this.byId.set(n.id, n);
    this.byToken.set(n.token.toLowerCase(), n.id);
    this.byPair.set(n.pair.toLowerCase(), n.id);
  }

  tokens(): string[] {
    return [...this.byId.values()].map((n) => n.token);
  }

  graduatedPairs(): string[] {
    return [...this.byId.values()].filter((n) => n.graduated).map((n) => n.pair);
  }
}
