"use client";
import Link from "next/link";
import type { NewsItem } from "@atlaspad/shared";

/** Endless marquee of the latest Atlas News headlines. */
export function NewsTicker({ items }: { items: NewsItem[] }) {
  const list = items.filter((i) => i.severity !== "minor").slice(0, 16);
  if (!list.length) return null;
  const loop = [...list, ...list];
  return (
    <div className="relative overflow-hidden border-t border-line bg-black/50 backdrop-blur">
      <div className="absolute inset-y-0 left-0 z-10 flex items-center">
        <span className="flex h-full items-center bg-black pl-4 pr-3 font-mono text-[10px] uppercase tracking-[0.22em] text-gold">Atlas News</span>
        <span className="h-full w-12 bg-gradient-to-r from-black to-transparent" />
      </div>
      <div className="flex w-max animate-marquee gap-10 py-2.5 pl-40 hover:[animation-play-state:paused]">
        {loop.map((n, i) => (
          <Link key={`${n.id}-${i}`} href={n.nationId ? `/nation/${n.nationId}` : "/news"} className="whitespace-nowrap text-[12.5px] text-dim transition hover:text-fg">
            {n.title}
          </Link>
        ))}
      </div>
    </div>
  );
}
