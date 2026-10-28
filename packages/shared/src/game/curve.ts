/**
 * Exact bigint port of AtlasLaunchpad's bonding-curve math. Used to preview a nation before it exists
 * on-chain (e.g. the founder's initial buy). For existing nations always prefer the contract's
 * `quoteBuy` / `quoteSell` views, which are authoritative.
 */

export const LAUNCHPAD = {
  BPS: 10_000n,
  TRADE_FEE_BPS: 100n,
  TREASURY_FEE_BPS: 50n,
  BURN_FEE_BPS: 25n,
  PROTOCOL_FEE_BPS: 25n,
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
  virtualWif: bigint;
  virtualTokens: bigint;
  realWif: bigint;
  curveTokensRemaining: bigint;
}

const ceilDiv = (a: bigint, b: bigint) => (a === 0n ? 0n : (a - 1n) / b + 1n);

export function initialCurve(totalSupply: bigint, founderBps: bigint, graduationWif: bigint): CurveState {
  const lp = (totalSupply * LAUNCHPAD.LP_RESERVE_BPS) / LAUNCHPAD.BPS;
  const founder = (totalSupply * founderBps) / LAUNCHPAD.BPS;
  const curve = totalSupply - lp - founder;
  return {
    totalSupply,
    curveSupply: curve,
    lpReserve: lp,
    founderAllocation: founder,
    virtualTokens: (curve * curve) / (curve - lp),
    virtualWif: (graduationWif * lp) / (curve - lp),
    realWif: 0n,
    curveTokensRemaining: curve,
  };
}

export interface BuyQuote {
  tokensOut: bigint;
  fee: bigint;
  /** $WIF actually pulled from the buyer (fee included). */
  wifUsed: bigint;
  /** Part of the requested amount that is not pulled because the buy sells out the curve. */
  refund: bigint;
  graduates: boolean;
}

export function quoteBuy(s: CurveState, wifIn: bigint): BuyQuote {
  let fee = (wifIn * LAUNCHPAD.TRADE_FEE_BPS) / LAUNCHPAD.BPS;
  let netWif = wifIn - fee;
  const k = s.virtualWif * s.virtualTokens;
  let tokensOut = s.virtualTokens - ceilDiv(k, s.virtualWif + netWif);
  let wifUsed = wifIn;
  let refund = 0n;
  let graduates = false;
  if (tokensOut >= s.curveTokensRemaining) {
    tokensOut = s.curveTokensRemaining;
    netWif = ceilDiv(k, s.virtualTokens - tokensOut) - s.virtualWif;
    let gross = ceilDiv(netWif * LAUNCHPAD.BPS, LAUNCHPAD.BPS - LAUNCHPAD.TRADE_FEE_BPS);
    if (gross > wifIn) gross = wifIn;
    fee = gross - netWif;
    wifUsed = gross;
    refund = wifIn - gross;
    graduates = true;
  }
  return { tokensOut, fee, wifUsed, refund, graduates };
}

/** Spot price in $WIF base units per whole token. */
export function spotPrice(s: Pick<CurveState, "virtualWif" | "virtualTokens">): bigint {
  return (s.virtualWif * 10n ** 18n) / s.virtualTokens;
}

/** Opening and graduation market caps ($WIF base units) for a curve configuration. */
export function curveMilestones(totalSupply: bigint, founderBps: bigint, graduationWif: bigint) {
  const s = initialCurve(totalSupply, founderBps, graduationWif);
  const openingPrice = spotPrice(s);
  // At graduation the Uniswap opening price is graduationWif / lpReserve.
  const graduationPrice = (graduationWif * 10n ** 18n) / s.lpReserve;
  return {
    curve: s,
    openingPriceWei: openingPrice,
    openingMarketCapWei: (openingPrice * totalSupply) / 10n ** 18n,
    graduationPriceWei: graduationPrice,
    graduationMarketCapWei: (graduationPrice * totalSupply) / 10n ** 18n,
  };
}
