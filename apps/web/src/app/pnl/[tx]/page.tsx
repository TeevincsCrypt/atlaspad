import type { Metadata } from "next";
import Link from "next/link";
import { getSql } from "@/lib/server/db";
import { getSellPnl } from "@/lib/server/queries";
import { formatPnlPct } from "@/lib/pnl";
import { PnlCardView } from "@/components/pnl/PnlCard";

export async function generateMetadata({ params }: { params: Promise<{ tx: string }> }): Promise<Metadata> {
  const { tx } = await params;
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx);
  let title = "PnL card";
  if (valid) {
    try {
      const sql = getSql();
      const p = sql ? await getSellPnl(sql, tx) : null;
      if (p) title = `${p.pnlPct === null ? "Sold" : formatPnlPct(p.pnlPct)} on $${p.ticker}`;
    } catch {
      /* metadata falls back to the generic title */
    }
  }
  const image = valid ? [{ url: `/api/pnl/${tx}/image`, width: 1200, height: 675 }] : undefined;
  return {
    title,
    description: "A verified on-chain trade on AtlasPad: every token is a nation, every nation runs on $WIF.",
    openGraph: { title, images: image },
    twitter: { card: "summary_large_image", title, images: image },
  };
}

export default async function PnlPage({ params }: { params: Promise<{ tx: string }> }) {
  const { tx } = await params;
  const valid = /^0x[0-9a-fA-F]{64}$/.test(tx);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-28 sm:px-6">
      <div className="label mb-2">PnL card · verified on-chain</div>
      <h1 className="mb-6 font-display text-2xl font-semibold uppercase tracking-wide text-fg">A trade on AtlasPad</h1>
      {valid ? <PnlCardView tx={tx.toLowerCase()} /> : <p className="text-sm text-faint">That is not a valid transaction hash.</p>}
      <div className="mt-8 flex flex-wrap gap-3 text-sm">
        <Link href="/discover" className="rounded-lg border border-gold/40 px-4 py-2 text-gold-bright hover:bg-gold/10">
          Find a nation to trade
        </Link>
        <Link href="/found" className="rounded-lg border border-line-strong px-4 py-2 text-dim hover:text-fg">
          Found your own
        </Link>
      </div>
    </div>
  );
}
