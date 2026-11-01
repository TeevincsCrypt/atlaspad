"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { XIcon } from "../ui/XIcon";
import { LogoMark } from "./Logo";

export const X_URL = "https://x.com/atlasonwif";

/** Site footer with the official X account. Hidden on the full-screen world map and the admin pages. */
export function Footer() {
  const path = usePathname();
  if (path.startsWith("/world") || path.startsWith("/admin")) return null;
  return (
    <footer className="relative z-10 border-t border-line bg-ink/95 px-5 pb-24 pt-8 backdrop-blur sm:px-10 sm:pb-8 lg:px-16">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 sm:flex-row">
        <Link href="/" className="flex items-center gap-2.5">
          <LogoMark size={22} />
          <span className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-fg">AtlasPad</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.16em] text-faint md:inline">· Every nation runs on $WIF</span>
        </Link>
        <a
          href={X_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line-strong px-3.5 font-mono text-[11px] text-dim transition hover:border-gold/50 hover:text-fg"
          aria-label="AtlasPad on X"
        >
          <XIcon className="size-3.5" /> @atlasonwif
        </a>
      </div>
    </footer>
  );
}
