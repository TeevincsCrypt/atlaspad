"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { isAddress } from "viem";
import { Search, Shield, User, CornerDownLeft } from "lucide-react";
import { shortAddress } from "@atlaspad/shared";
import { useSearchIndex } from "@/lib/api";
import { useUi } from "@/lib/store";
import { Flag } from "../emblem/Flag";

type Result =
  | { kind: "nation"; id: number; name: string; ticker: string; emblem: string; hint: string }
  | { kind: "alliance"; id: number; name: string }
  | { kind: "citizen"; address: string };

function score(q: string, text: string): number {
  const t = text.toLowerCase();
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;
  // subsequence match
  let i = 0;
  for (const ch of t) if (ch === q[i]) i++;
  return i === q.length ? 20 : 0;
}

export function SearchPalette() {
  const open = useUi((s) => s.searchOpen);
  const setOpen = useUi((s) => s.setSearchOpen);
  const index = useSearchIndex(open);
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setTimeout(() => input.current?.focus(), 30);
    }
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase().replace(/^\$/, "");
    const out: { r: Result; s: number }[] = [];
    if (isAddress(q.trim(), { strict: false })) {
      const addr = q.trim().toLowerCase();
      const byToken = index.data?.nations.find((n) => n.token === addr);
      if (byToken) out.push({ r: { kind: "nation", ...byToken, hint: "Token contract" }, s: 200 });
      out.push({ r: { kind: "citizen", address: addr }, s: 150 });
      for (const n of index.data?.nations ?? []) if (n.founder === addr) out.push({ r: { kind: "nation", ...n, hint: "Founded by this wallet" }, s: 120 });
    } else if (query) {
      for (const n of index.data?.nations ?? []) {
        const s = Math.max(score(query, n.name), score(query, n.ticker) + 5);
        if (s > 0) out.push({ r: { kind: "nation", ...n, hint: `$${n.ticker}` }, s });
      }
      for (const a of index.data?.alliances ?? []) {
        const s = score(query, a.name);
        if (s > 0) out.push({ r: { kind: "alliance", id: a.id, name: a.name }, s: s - 1 });
      }
    } else {
      for (const n of (index.data?.nations ?? []).slice(-8).reverse()) out.push({ r: { kind: "nation", ...n, hint: "Recently founded" }, s: 1 });
    }
    return out.sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.r);
  }, [q, index.data]);

  const go = (r: Result) => {
    setOpen(false);
    if (r.kind === "nation") router.push(`/nation/${r.id}`);
    else if (r.kind === "alliance") router.push(`/alliance/${r.id}`);
    else router.push(`/citizen/${r.address}`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-[85] flex items-start justify-center px-4 pt-[12vh]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <motion.div
            className="panel relative w-full max-w-xl overflow-hidden"
            initial={{ y: -12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: -8, opacity: 0 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
          >
            <div className="flex items-center gap-3 border-b border-line px-4">
              <Search className="size-4 text-faint" />
              <input
                ref={input}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setCursor(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setOpen(false);
                  if (e.key === "ArrowDown") setCursor((c) => Math.min(results.length - 1, c + 1));
                  if (e.key === "ArrowUp") setCursor((c) => Math.max(0, c - 1));
                  if (e.key === "Enter" && results[cursor]) go(results[cursor]!);
                }}
                placeholder="Search nations, tickers, wallets, alliances…"
                className="h-14 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-faint"
              />
              <kbd className="rounded border border-line px-1.5 font-mono text-[10px] text-faint">ESC</kbd>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {index.isError && <div className="px-3 py-6 text-center text-xs text-faint">Search index unavailable.</div>}
              {!index.isError && results.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-faint">{index.isLoading ? "Loading the atlas…" : "No matches."}</div>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.kind}-${r.kind === "citizen" ? r.address : r.id}`}
                  onMouseEnter={() => setCursor(i)}
                  onClick={() => go(r)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${i === cursor ? "bg-white/[0.06]" : ""}`}
                >
                  {r.kind === "nation" ? (
                    <Flag emblem={r.emblem} size={28} />
                  ) : r.kind === "alliance" ? (
                    <Shield className="size-5 text-gold" />
                  ) : (
                    <User className="size-5 text-info" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">
                      {r.kind === "nation" ? r.name : r.kind === "alliance" ? r.name : shortAddress(r.address, 6)}
                    </span>
                    <span className="block truncate text-[11px] text-faint">
                      {r.kind === "nation" ? r.hint : r.kind === "alliance" ? "Alliance" : "Citizen profile"}
                    </span>
                  </span>
                  {i === cursor && <CornerDownLeft className="size-3.5 text-faint" />}
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
