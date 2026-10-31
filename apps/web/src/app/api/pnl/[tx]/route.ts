import { getSellPnl } from "@/lib/server/queries";
import { json, withDb } from "@/lib/server/http";

export const dynamic = "force-dynamic";

/** The PnL of one sale, or 404 until the indexer has picked up the transaction. */
export async function GET(_req: Request, { params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  if (!/^0x[0-9a-fA-F]{64}$/.test(tx)) return json({ error: "invalid_tx" }, { status: 400 });
  return withDb(async (sql) => {
    const pnl = await getSellPnl(sql, tx);
    return pnl ? json({ pnl }, { maxAge: 3600 }) : json({ error: "not_indexed" }, { status: 404 });
  });
}
