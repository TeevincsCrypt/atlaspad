import type { Ctx } from "./context";
import { log } from "./log";

/**
 * Optional $WIF/USD reference price (WIF_USD_SOURCE=dexscreener). Used to display USD equivalents, stored in hourly
 * snapshots, and checked by the "Millionaire Economy" achievement during metric refreshes (so that achievement
 * can't unlock with WIF_USD_SOURCE=none and depends on the price when it was checked). All on-chain values are
 * denominated in $WIF. When unavailable, the app shows $WIF values and "—" for USD.
 *
 * Dexscreener lists every pool for a token; the most liquid pool's USD price is used.
 */
export async function refreshWifUsd(ctx: Ctx): Promise<void> {
  if (ctx.env.wifUsdSource !== "dexscreener") return;
  const wif = ctx.env.network.dex.wif;
  try {
    const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${wif}`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as {
      pairs?: { baseToken?: { address?: string }; priceUsd?: string; liquidity?: { usd?: number } }[] | null;
    };
    const pools = (body.pairs ?? []).filter(
      (p) => p.baseToken?.address?.toLowerCase() === wif.toLowerCase() && Number(p.priceUsd) > 0,
    );
    pools.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const price = Number(pools[0]?.priceUsd);
    if (!Number.isFinite(price) || price <= 0) throw new Error("no priced $WIF pool");
    await ctx.sql`UPDATE indexer_state SET wif_usd = ${price}, wif_usd_updated_at = ${Math.floor(Date.now() / 1000)} WHERE id = 'main'`;
  } catch (err) {
    log.warn("WIF/USD refresh failed", { err: String(err) });
  }
}
