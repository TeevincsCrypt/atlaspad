"use client";
import { useState } from "react";
import { AnimatePresence } from "motion/react";
import { useNews } from "@/lib/api";
import { useUi } from "@/lib/store";
import { NewsFeedItem } from "@/components/news/NewsFeedItem";
import { DataUnavailable, EmptyState, Skeleton } from "@/components/ui/misc";
import { LiveDot } from "@/components/nav/TopNav";

const FILTERS = [
  { key: undefined, label: "Everything" },
  { key: "notable" as const, label: "Notable" },
  { key: "major" as const, label: "Major only" },
];

export default function NewsPage() {
  const [severity, setSeverity] = useState<"notable" | "major" | undefined>(undefined);
  const news = useNews({ severity, limit: 120 });
  const cinematicsOn = useUi((s) => s.cinematicsOn);
  const setCinematicsOn = useUi((s) => s.setCinematicsOn);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-24 pt-24 sm:px-6">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-3">
            <span className="label">Atlas News</span>
            <LiveDot />
          </div>
          <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-fg">What&apos;s happening in the world</h1>
          <p className="mt-2 text-sm text-dim">Every headline is generated from real on-chain activity: trades, holders, liquidity, votes and decrees.</p>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1.5">
          {FILTERS.map((f) => (
            <button key={f.label} onClick={() => setSeverity(f.key)} className={`rounded-lg border px-3 py-1.5 text-xs ${severity === f.key ? "border-gold/50 bg-gold/10 text-gold-bright" : "border-line text-faint"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs text-faint">
          <input type="checkbox" checked={cinematicsOn} onChange={(e) => setCinematicsOn(e.target.checked)} className="accent-[#d6b26e]" />
          Cinematic alerts for major events
        </label>
      </div>
      <div className="panel px-5">
        {news.isError ? (
          <div className="py-6">
            <DataUnavailable />
          </div>
        ) : !news.data ? (
          <div className="space-y-3 py-5">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : news.data.length === 0 ? (
          <div className="py-6">
            <EmptyState icon="📰" title="No news yet" body="The first nation's founding will be the first headline." />
          </div>
        ) : (
          <div className="divide-y divide-line">
            <AnimatePresence initial={false}>
              {news.data.map((n) => (
                <NewsFeedItem key={n.id} item={n} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
