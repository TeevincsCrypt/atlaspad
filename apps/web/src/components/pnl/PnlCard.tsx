"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Link2, Loader2, Share2 } from "lucide-react";
import { publicEnv } from "@/lib/env";
import { formatPnlPct, pnlTagline } from "@/lib/pnl";
import { Dialog } from "../ui/Dialog";
import { copyText } from "../ui/misc";

interface PnlResponse {
  pnl: { ticker: string; name: string; pnlPct: number | null; pnlWif: number | null; wifReceived: number };
}

/** Polls until the indexer has the sale, then shows its card image. Sales are usually indexed within seconds. */
export function usePnl(tx: string | null) {
  return useQuery({
    queryKey: ["pnl", tx],
    enabled: Boolean(tx),
    queryFn: async () => {
      const r = await fetch(`/api/pnl/${tx}`);
      if (r.status === 404) throw new Error("pending");
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return (await r.json()) as PnlResponse;
    },
    retry: (n, err) => (err as Error).message === "pending" && n < 40,
    retryDelay: 2500,
    staleTime: Infinity,
  });
}

const btn = "inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border px-3 text-sm transition";

/** The PnL card with share, download and copy-link actions. */
export function PnlCardView({ tx }: { tx: string }) {
  const q = usePnl(tx);
  const [loaded, setLoaded] = useState(false);
  const [copied, setCopied] = useState(false);
  const pageUrl = `${publicEnv.siteUrl}/pnl/${tx}`;
  const imgUrl = `/api/pnl/${tx}/image`;
  const p = q.data?.pnl;
  const text = p
    ? `${p.pnlPct === null ? "Sold" : formatPnlPct(p.pnlPct)} on $${p.ticker} ${p.name ? `(${p.name}) ` : ""}on @AtlasPad. ${pnlTagline(p.pnlPct)}`
    : "";
  const intent = `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}`;

  return (
    <div>
      <div className="relative aspect-[1200/675] w-full overflow-hidden rounded-xl border border-line-strong bg-black">
        {q.data && (
          <img src={imgUrl} alt={text} onLoad={() => setLoaded(true)} className={`size-full object-cover transition-opacity duration-500 ${loaded ? "opacity-100" : "opacity-0"}`} />
        )}
        {(!q.data || !loaded) && (
          <div className="absolute inset-0 grid place-items-center text-center">
            {q.isError && (q.error as Error).message !== "pending" ? (
              <span className="text-sm text-faint">This sale could not be found in the index.</span>
            ) : (
              <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.16em] text-dim">
                <Loader2 className="size-4 animate-spin" /> Reading your sale from the chain…
              </span>
            )}
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <a href={intent} target="_blank" rel="noopener noreferrer" className={`${btn} border-gold/40 bg-gold/10 text-gold-bright hover:bg-gold/20 ${p ? "" : "pointer-events-none opacity-40"}`}>
          <Share2 className="size-4" /> Share on X
        </a>
        <a href={`${imgUrl}?download`} download className={`${btn} border-line-strong text-dim hover:text-fg ${p ? "" : "pointer-events-none opacity-40"}`}>
          <Download className="size-4" /> Download
        </a>
        <button
          className={`${btn} border-line-strong text-dim hover:text-fg`}
          onClick={() =>
            void copyText(pageUrl).then((ok) => {
              if (!ok) return;
              setCopied(true);
              setTimeout(() => setCopied(false), 1400);
            })
          }
        >
          <Link2 className="size-4" /> {copied ? "Copied" : "Copy link"}
        </button>
      </div>
    </div>
  );
}

export function PnlCardDialog({ tx, onClose }: { tx: string | null; onClose: () => void }) {
  return (
    <Dialog open={Boolean(tx)} onClose={onClose} title="Your PnL card" width="max-w-2xl">
      {tx && <PnlCardView tx={tx} />}
      <p className="mt-3 text-[11px] text-faint">Built from this sale&apos;s on-chain trades: entry is your average buy price before the sale.</p>
    </Dialog>
  );
}
