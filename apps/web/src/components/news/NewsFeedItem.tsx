"use client";
import Link from "next/link";
import { motion } from "motion/react";
import { timeAgo, type NewsItem } from "@atlaspad/shared";
import { ExplorerLink } from "../ui/misc";

const SEVERITY_BAR: Record<NewsItem["severity"], string> = {
  major: "bg-gradient-to-b from-gold-bright to-gold-deep",
  notable: "bg-white/25",
  minor: "bg-white/10",
};

const TYPE_TONE: Record<string, string> = {
  WAR_DECLARED: "text-war",
  WAR_ENDED: "text-gold-bright",
  GOLDEN_AGE: "text-gold-bright",
  ECONOMIC_CRISIS: "text-down",
  MARKET_CRASH: "text-down",
  NATIONAL_EMERGENCY: "text-down",
  BANKING_CRISIS: "text-warn",
  ECONOMIC_BOOM: "text-up",
  POPULATION_EXPLOSION: "text-info",
  FOREIGN_INVESTMENT: "text-info",
};

export function NewsFeedItem({ item, compact = false }: { item: NewsItem; compact?: boolean }) {
  return (
    <motion.article
      layout
      initial={{ opacity: 0, y: -10, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className={`relative flex gap-3 ${compact ? "py-2.5" : "py-3.5"}`}
    >
      <span className={`mt-1 w-[2px] shrink-0 self-stretch rounded-full ${SEVERITY_BAR[item.severity]}`} />
      <div className="min-w-0 flex-1">
        <div className={`${compact ? "text-[12.5px]" : "text-sm"} leading-snug ${TYPE_TONE[item.type] ?? "text-fg"}`}>
          {item.nationId ? (
            <Link href={`/nation/${item.nationId}`} className="hover:underline decoration-white/20 underline-offset-4">
              {item.title}
            </Link>
          ) : (
            item.title
          )}
        </div>
        {!compact && item.body && <p className="mt-1 text-xs leading-relaxed text-dim">{item.body}</p>}
        <div className="mt-1 flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.14em] text-faint">
          <span>{timeAgo(item.createdAt)}</span>
          {item.txHash && (
            <ExplorerLink kind="tx" value={item.txHash} className="text-faint">
              tx
            </ExplorerLink>
          )}
          {item.type.startsWith("WAR") && typeof item.data.warId === "number" && (
            <Link href={`/war/${item.data.warId}`} className="hover:text-war">
              war room →
            </Link>
          )}
        </div>
      </div>
    </motion.article>
  );
}
