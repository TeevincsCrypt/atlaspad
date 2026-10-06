"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { motion } from "motion/react";
import { Compass, Globe2, Menu, Newspaper, Plus, Search, Trophy, User, Volume2, VolumeX, X } from "lucide-react";
import { shortAddress } from "@atlaspad/shared";
import { useUi } from "@/lib/store";
import { playSound } from "@/lib/sound";
import { Wordmark } from "./Logo";
import { useHydrated } from "@/lib/hooks";

const LINKS = [
  { href: "/", label: "Atlas" },
  { href: "/world", label: "World" },
  { href: "/discover", label: "Discover" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/news", label: "News" },
  { href: "/my-nations", label: "My Nations" },
  { href: "/profile", label: "Profile" },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function LiveDot() {
  const realtime = useUi((s) => s.realtime);
  const tone =
    realtime === "live" ? "bg-up shadow-[0_0_10px_rgba(53,210,154,0.8)]" : realtime === "connecting" ? "bg-warn" : "bg-faint";
  const label = realtime === "live" ? "Live" : realtime === "connecting" ? "Connecting" : realtime === "disabled" ? "Polling" : "Offline";
  return (
    <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-faint" title={`Realtime: ${label}`}>
      <span className={`size-1.5 rounded-full ${tone} ${realtime === "live" ? "animate-pulse-soft" : ""}`} />
      <span className="hidden xl:inline">{label}</span>
    </span>
  );
}

export function WalletButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected } = useAccount();
  const setOpen = useUi((s) => s.setWalletModalOpen);
  const mounted = useHydrated();
  const connected = mounted && isConnected && address;
  return (
    <button
      onClick={() => setOpen(true)}
      className={`flex h-9 items-center gap-2 rounded-[10px] border px-3 text-[13px] font-medium transition ${
        connected ? "border-line-strong bg-white/[0.04] text-fg hover:bg-white/[0.08]" : "border-gold/50 bg-gold/10 text-gold-bright hover:bg-gold/20"
      }`}
    >
      {connected ? (
        <>
          <span className="size-2 rounded-full bg-up" />
          <span className="font-mono text-xs">{shortAddress(address)}</span>
        </>
      ) : (
        <span>{compact ? "Connect" : "Connect wallet"}</span>
      )}
    </button>
  );
}

export function TopNav() {
  const path = usePathname();
  const soundOn = useUi((s) => s.soundOn);
  const setSoundOn = useUi((s) => s.setSoundOn);
  const setSearchOpen = useUi((s) => s.setSearchOpen);
  // The mobile menu belongs to the page it was opened on, so navigating closes it.
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const menu = menuPath === path;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSearchOpen]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-50 border-b border-line bg-ink/70 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4 sm:px-6">
          <Link href="/" className="shrink-0" aria-label="AtlasPad home">
            <Wordmark />
          </Link>
          <nav className="ml-4 hidden items-center gap-0.5 lg:flex">
            {LINKS.map((l) => {
              const active = isActive(path, l.href);
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`relative rounded-lg px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.16em] transition ${active ? "text-fg" : "text-faint hover:text-dim"}`}
                >
                  {active && (
                    <motion.span layoutId="nav-active" className="absolute inset-x-2 -bottom-[13px] h-px bg-gradient-to-r from-transparent via-gold to-transparent" />
                  )}
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LiveDot />
            <button
              onClick={() => setSearchOpen(true)}
              className="hidden h-9 items-center gap-2 rounded-[10px] border border-line px-3 text-xs text-faint transition hover:border-line-strong hover:text-dim md:flex"
            >
              <Search className="size-3.5" />
              <span>Search</span>
              <kbd className="rounded border border-line px-1 font-mono text-[10px]">⌘K</kbd>
            </button>
            <button
              onClick={() => setSearchOpen(true)}
              className="grid size-9 place-items-center rounded-[10px] border border-line text-faint md:hidden"
              aria-label="Search"
            >
              <Search className="size-4" />
            </button>
            <button
              onClick={() => {
                setSoundOn(!soundOn);
                if (!soundOn) setTimeout(() => playSound("click"), 0);
              }}
              className="grid size-9 place-items-center rounded-[10px] border border-line text-faint transition hover:text-fg"
              aria-label={soundOn ? "Mute sound" : "Enable sound"}
              title={soundOn ? "Sound on" : "Sound off"}
            >
              {soundOn ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
            </button>
            <Link
              href="/found"
              className="hidden h-9 items-center gap-1.5 rounded-[10px] bg-gradient-to-b from-[#f3d58f] to-[#c79e52] px-3.5 text-[12px] font-semibold tracking-wide text-[#1a1306] shadow-[0_0_24px_-6px_rgba(214,178,110,0.7)] transition hover:brightness-110 sm:flex"
            >
              <Plus className="size-3.5" /> Found a Nation
            </Link>
            <WalletButton compact />
            <button className="grid size-9 place-items-center rounded-[10px] border border-line text-dim lg:hidden" onClick={() => setMenuPath(menu ? null : path)} aria-label="Menu">
              {menu ? <X className="size-4" /> : <Menu className="size-4" />}
            </button>
          </div>
        </div>
        {menu && (
          <div className="border-t border-line bg-ink/95 px-4 py-3 lg:hidden">
            <div className="grid grid-cols-2 gap-1">
              {LINKS.map((l) => (
                <Link key={l.href} href={l.href} className={`rounded-lg px-3 py-2.5 font-mono text-xs uppercase tracking-[0.14em] ${isActive(path, l.href) ? "bg-white/5 text-fg" : "text-dim"}`}>
                  {l.label}
                </Link>
              ))}
              <Link href="/found" className="col-span-2 mt-1 rounded-lg bg-gold/15 px-3 py-2.5 text-center font-mono text-xs uppercase tracking-[0.14em] text-gold-bright">
                Found a Nation
              </Link>
            </div>
          </div>
        )}
      </header>
      <MobileTabs path={path} />
    </>
  );
}

function MobileTabs({ path }: { path: string }) {
  const tabs = [
    { href: "/world", label: "World", icon: Globe2 },
    { href: "/discover", label: "Discover", icon: Compass },
    { href: "/found", label: "Found", icon: Plus, accent: true },
    { href: "/news", label: "News", icon: Newspaper },
    { href: "/leaderboard", label: "Ranks", icon: Trophy },
    { href: "/profile", label: "Profile", icon: User },
  ];
  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-line bg-ink/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl sm:hidden">
      <div className="grid grid-cols-6">
        {tabs.map((t) => {
          const active = isActive(path, t.href);
          const Icon = t.icon;
          return (
            <Link key={t.href} href={t.href} className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${active ? "text-gold-bright" : t.accent ? "text-gold" : "text-faint"}`}>
              <Icon className="size-[18px]" />
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
