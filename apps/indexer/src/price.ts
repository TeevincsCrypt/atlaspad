import type { Ctx } from "./context";
import { log } from "./log";

/**
 * Optional ETH/USD reference price (ETH_USD_SOURCE=coinbase). Used only to display USD equivalents; all
 * on-chain values are denominated in ETH. When unavailable, the app shows ETH values and "—" for USD.
 */
export async function refreshEthUsd(ctx: Ctx): Promise<void> {
  if (ctx.env.ethUsdSource !== "coinbase") return;
  try {
    const res = await fetch("https://api.coinbase.com/v2/prices/ETH-USD/spot", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { data?: { amount?: string } };
    const price = Number(body.data?.amount);
    if (!Number.isFinite(price) || price <= 0) throw new Error("invalid price payload");
    await ctx.sql`UPDATE indexer_state SET eth_usd = ${price}, eth_usd_updated_at = ${Math.floor(Date.now() / 1000)} WHERE id = 'main'`;
  } catch (err) {
    log.warn("ETH/USD refresh failed", { err: String(err) });
  }
}
