import { describe, expect, it } from "vitest";
import { curveMilestones, initialCurve, quoteBuy, spotPrice } from "../src/game/curve";

const E18 = 10n ** 18n;
const SUPPLY = 1_000_000_000n * E18;
const GRAD = 2n * E18;

describe("bonding curve port", () => {
  it("initial curve matches the contract derivation", () => {
    const c = initialCurve(SUPPLY, 0n, GRAD);
    expect(c.lpReserve).toBe(SUPPLY / 5n);
    expect(c.curveSupply).toBe((SUPPLY * 4n) / 5n);
    expect(c.virtualTokens).toBe((c.curveSupply * c.curveSupply) / (c.curveSupply - c.lpReserve));
    expect(c.virtualEth).toBe((GRAD * c.lpReserve) / (c.curveSupply - c.lpReserve));
  });

  it("opening market cap is 31.25% of the graduation target with no founder allocation", () => {
    const m = curveMilestones(SUPPLY, 0n, GRAD);
    const ratio = Number(m.openingMarketCapWei) / Number(GRAD);
    expect(ratio).toBeCloseTo(0.3125, 6);
    // graduation market cap = 5x the graduation target
    expect(Number(m.graduationMarketCapWei) / Number(GRAD)).toBeCloseTo(5, 6);
  });

  it("a buy that sells out the curve is capped and refunds the rest", () => {
    const c = initialCurve(SUPPLY, 0n, GRAD);
    const q = quoteBuy(c, 50n * E18);
    expect(q.graduates).toBe(true);
    expect(q.tokensOut).toBe(c.curveSupply);
    expect(q.ethUsed + q.refund).toBe(50n * E18);
    const expectedGross = Number(GRAD) / 0.99;
    expect(Number(q.ethUsed) / expectedGross).toBeCloseTo(1, 4);
  });

  it("charges a 1% fee on regular buys", () => {
    const c = initialCurve(SUPPLY, 0n, GRAD);
    const q = quoteBuy(c, E18 / 10n);
    expect(q.fee).toBe(E18 / 1000n);
    expect(q.graduates).toBe(false);
    expect(q.tokensOut > 0n).toBe(true);
    expect(spotPrice(c) > 0n).toBe(true);
  });
});
