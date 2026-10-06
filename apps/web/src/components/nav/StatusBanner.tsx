"use client";
import { useEffect, useState } from "react";
import { useAccount, useSwitchChain } from "wagmi";
import { AlertTriangle, Construction } from "lucide-react";
import { configError, isDeployed, network } from "@/lib/env";
import { useStatus } from "@/lib/api";

/** Honest system banners: wrong network, contracts not deployed, live data unavailable. */
export function StatusBanner() {
  const { isConnected, chainId } = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const status = useStatus();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  if (isConnected && chainId !== network.chain.id) {
    return (
      <Bar tone="warn" icon={<AlertTriangle className="size-3.5" />}>
        Your wallet is on another network. AtlasPad runs on {network.chain.name} (chain {network.chain.id}).
        <button
          onClick={() => switchChain({ chainId: network.chain.id })}
          disabled={isPending}
          className="ml-2 rounded-md border border-warn/50 px-2 py-0.5 font-medium hover:bg-warn/15"
        >
          {isPending ? "Switching…" : `Switch to ${network.chain.name}`}
        </button>
      </Bar>
    );
  }
  if (configError) {
    return (
      <Bar tone="warn" icon={<AlertTriangle className="size-3.5" />}>
        Configuration error: {configError} On-chain actions are disabled.
      </Bar>
    );
  }
  if (!isDeployed) {
    return (
      <Bar tone="info" icon={<Construction className="size-3.5" />}>
        AtlasPad contracts are not yet deployed on {network.chain.name}. Founding, trading and governance are disabled until
        the verified deployment is configured.
      </Bar>
    );
  }
  if (status.data && status.data.database !== "ok") {
    return (
      <Bar tone="info" icon={<AlertTriangle className="size-3.5" />}>
        Live world data is unavailable right now. On-chain actions still work through your wallet.
      </Bar>
    );
  }
  return null;
}

function Bar({ tone, icon, children }: { tone: "warn" | "info"; icon: React.ReactNode; children: React.ReactNode }) {
  const cls = tone === "warn" ? "border-warn/30 bg-warn/10 text-warn" : "border-info/25 bg-info/[0.08] text-info";
  return (
    <div className={`fixed inset-x-0 top-14 z-40 border-b px-4 py-2 text-center text-[12px] backdrop-blur ${cls}`}>
      <span className="inline-flex flex-wrap items-center justify-center gap-1.5">
        {icon}
        {children}
      </span>
    </div>
  );
}
