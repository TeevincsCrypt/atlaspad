/**
 * Exact bigint port of AtlasLaunchpad's bonding-curve math. Used to preview a nation before it exists
 * on-chain (e.g. the founder's initial buy). For existing nations always prefer the contract's
 * `quoteBuy` / `quoteSell` views, which are authoritative.
 */

export const LAUNCHPAD = {
  BPS: 10_000n,
  TRADE_FEE_BPS: 100n,
  PROTOCOL_FEE_BPS: 50n,
  TREASURY_FEE_BPS: 50n,
  LP_RESERVE_BPS: 2_000n,
  MAX_FOUNDER_BPS: 500n,
  MAX_INITIAL_BUY_BPS: 1_000n,
  FOUNDER_VESTING_SECONDS: 30n * 24n * 3600n,
  MIN_SUPPLY: 1_000_000n * 10n ** 18n,
  MAX_SUPPLY: 1_000_000_000_000n * 10n ** 18n,
} as const;

export interface CurveState {
  totalSupply: bigint;
  curveSupply: bigint;
  lpReserve: bigint;
  founderAllocation: bigint;
  virtualEth: bigint;
  virtualTokens: bigint;
  realEth: bigint;
  curveTokensRemaining: bigint;
}

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

export function initialCurve(totalSupply: bigint, founderBps: bigint, graduationEth: bigint): CurveState {
  const lp = (totalSupply * LAUNCHPAD.LP_RESERVE_BPS) / LAUNCHPAD.BPS;
  const founder = (totalSupply * founderBps) / LAUNCHPAD.BPS;
  const curve = totalSupply - lp - founder;
  return {
    totalSupply,
    curveSupply: curve,
    lpReserve: lp,
    founderAllocation: founder,
    virtualTokens: (curve * curve) / (curve - lp),
    virtualEth: (graduationEth * lp) / (curve - lp),
    realEth: 0n,
    curveTokensRemaining: curve,
  };
}

export interface BuyQuote {
  tokensOut: bigint;
  fee: bigint;
  ethUsed: bigint;
  refund: bigint;
  graduates: boolean;
}

export function quoteBuy(s: CurveState, ethIn: bigint): BuyQuote {
  let fee = (ethIn * LAUNCHPAD.TRADE_FEE_BPS) / LAUNCHPAD.BPS;
  let netEth = ethIn - fee;
  const k = s.virtualEth * s.virtualTokens;
  let tokensOut = s.virtualTokens - ceilDiv(k, s.virtualEth + netEth);
  let ethUsed = ethIn;
  let refund = 0n;
  let graduates = false;
  if (tokensOut >= s.curveTokensRemaining) {
    tokensOut = s.curveTokensRemaining;
    netEth = ceilDiv(k, s.virtualTokens - tokensOut) - s.virtualEth;
    let gross = ceilDiv(netEth * LAUNCHPAD.BPS, LAUNCHPAD.BPS - LAUNCHPAD.TRADE_FEE_BPS);
    if (gross > ethIn) gross = ethIn;
    fee = gross - netEth;
    ethUsed = gross;
    refund = ethIn - gross;
    graduates = true;
  }
  return { tokensOut, fee, ethUsed, refund, graduates };
}

/** Spot price in wei per whole token. */
export function spotPrice(s: Pick<CurveState, "virtualEth" | "virtualTokens">): bigint {
  return (s.virtualEth * 10n ** 18n) / s.virtualTokens;
}

/** Opening and graduation market caps (wei) for a curve configuration. */
export function curveMilestones(totalSupply: bigint, founderBps: bigint, graduationEth: bigint) {
  const s = initialCurve(totalSupply, founderBps, graduationEth);
  const openingPrice = spotPrice(s);
  // At graduation the Uniswap opening price is graduationEth / lpReserve.
  const graduationPrice = (graduationEth * 10n ** 18n) / s.lpReserve;
  return {
    curve: s,
    openingPriceWei: openingPrice,
    openingMarketCapWei: (openingPrice * totalSupply) / 10n ** 18n,
    graduationPriceWei: graduationPrice,
    graduationMarketCapWei: (graduationPrice * totalSupply) / 10n ** 18n,
  };
}
