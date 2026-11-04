"use client";
import { Check } from "lucide-react";
import { useUi } from "@/lib/store";
import { LogoMark } from "../nav/Logo";
import { Button } from "../ui/Button";

/** Shown in place of wallet-only pages: what the page offers, and one clear way in. */
export function ConnectGate({ title, body, perks }: { title: string; body: string; perks: string[] }) {
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  return (
    <div className="mx-auto max-w-md px-4 pt-28">
      <div className="panel relative overflow-hidden p-10 text-center">
        <div className="pointer-events-none absolute -top-24 left-1/2 size-64 -translate-x-1/2 rounded-full bg-gold/15 blur-3xl" />
        <div className="relative mx-auto grid size-16 place-items-center rounded-2xl border border-gold/30 bg-gold/[0.07] shadow-[0_0_40px_-8px_rgba(243,213,143,0.5)]">
          <LogoMark size={34} />
        </div>
        <h1 className="relative mt-5 font-display text-2xl text-fg">{title}</h1>
        <p className="relative mt-2 text-sm leading-relaxed text-dim">{body}</p>
        <ul className="relative mx-auto mt-5 max-w-xs space-y-2 text-left text-[13px] text-dim">
          {perks.map((p) => (
            <li key={p} className="flex items-start gap-2.5">
              <Check className="mt-0.5 size-4 shrink-0 text-gold" /> {p}
            </li>
          ))}
        </ul>
        <Button variant="primary" size="lg" className="relative mt-7 w-full" onClick={() => setWalletOpen(true)}>
          Connect wallet
        </Button>
        <p className="relative mt-3 text-[11px] text-faint">Read-only until you confirm a transaction in your wallet.</p>
      </div>
    </div>
  );
}
