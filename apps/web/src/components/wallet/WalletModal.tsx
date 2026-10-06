"use client";
import { useMemo, useState } from "react";
import { useAccount, useBalance, useConnect, useDisconnect, type Connector } from "wagmi";
import { ArrowRight, Loader2, LogOut, QrCode, Smartphone, User, Wallet } from "lucide-react";
import Link from "next/link";
import { formatEth, shortAddress } from "@atlaspad/shared";
import { friendlyError } from "@/lib/errors";
import { network } from "@/lib/env";
import { useUi } from "@/lib/store";
import { Dialog } from "../ui/Dialog";
import { CopyButton, ExplorerLink } from "../ui/misc";

function connectorMeta(c: Connector): { title: string; subtitle: string; icon: React.ReactNode } {
  if (c.type === "walletConnect") {
    return { title: "WalletConnect", subtitle: "Robinhood Wallet and other mobile wallets (scan QR)", icon: <QrCode className="size-5 text-info" /> };
  }
  if (c.type === "coinbaseWallet") {
    return { title: "Coinbase Wallet", subtitle: "Extension or mobile app", icon: <Smartphone className="size-5 text-info" /> };
  }
  if (c.icon) {
    return { title: c.name, subtitle: "Detected in this browser", icon: <img src={c.icon} alt="" className="size-6 rounded-md" /> };
  }
  return { title: c.id === "injected" ? "Browser wallet" : c.name, subtitle: "Injected wallet extension", icon: <Wallet className="size-5 text-gold" /> };
}

export function WalletModal() {
  const open = useUi((s) => s.walletModalOpen);
  const setOpen = useUi((s) => s.setWalletModalOpen);
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, status } = useConnect();
  const { disconnect } = useDisconnect();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const balance = useBalance({ address, chainId: network.chain.id, query: { enabled: Boolean(address) } });

  // Prefer EIP-6963 discovered wallets; hide the generic injected entry when specific ones exist.
  const list = useMemo(() => {
    const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
    const generic = connectors.filter((c) => c.id === "injected");
    const others = connectors.filter((c) => c.type !== "injected");
    return [...discovered, ...(discovered.length ? [] : generic), ...others];
  }, [connectors]);

  const connect = async (c: Connector) => {
    setError(null);
    setPending(c.uid);
    try {
      await connectAsync({ connector: c, chainId: network.chain.id });
      setOpen(false);
    } catch (err) {
      const fe = friendlyError(err);
      setError(fe.rejected ? "Connection request was declined." : fe.message);
    } finally {
      setPending(null);
    }
  };

  return (
    <Dialog open={open} onClose={() => setOpen(false)} title={isConnected ? "Your wallet" : "Connect a wallet"} width="max-w-md">
      {isConnected && address ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-line bg-white/[0.02] p-4">
            <div className="label mb-2">Connected address</div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-sm text-fg">{shortAddress(address, 6)}</span>
              <span className="flex items-center gap-1">
                <CopyButton value={address} />
                <ExplorerLink kind="address" value={address}>
                  <span className="text-xs">Explorer</span>
                </ExplorerLink>
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-xs">
              <div>
                <div className="label mb-1">Network</div>
                <div className={chainId === network.chain.id ? "text-up" : "text-warn"}>
                  {chainId === network.chain.id ? network.chain.name : `Wrong network (${chainId})`}
                </div>
              </div>
              <div>
                <div className="label mb-1">Balance</div>
                <div className="font-mono text-fg">{balance.data ? formatEth(Number(balance.data.value) / 1e18) : "—"}</div>
              </div>
            </div>
          </div>
          <Link
            href={`/citizen/${address}`}
            onClick={() => setOpen(false)}
            className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-sm text-dim transition hover:border-line-strong hover:text-fg"
          >
            <span className="flex items-center gap-2">
              <User className="size-4" /> Citizen profile
            </span>
            <ArrowRight className="size-4" />
          </Link>
          <button
            onClick={() => {
              disconnect();
              setOpen(false);
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-down/30 px-4 py-2.5 text-sm text-down transition hover:bg-down/10"
          >
            <LogOut className="size-4" /> Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {list.map((c) => {
            const m = connectorMeta(c);
            const busy = pending === c.uid;
            return (
              <button
                key={c.uid}
                onClick={() => connect(c)}
                disabled={status === "pending"}
                className="group flex w-full items-center gap-3 rounded-xl border border-line bg-white/[0.02] px-4 py-3 text-left transition hover:border-gold/40 hover:bg-gold/[0.04] disabled:opacity-60"
              >
                <span className="grid size-10 place-items-center rounded-lg border border-line bg-black/30">{m.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{m.title}</span>
                  <span className="block truncate text-xs text-faint">{m.subtitle}</span>
                </span>
                {busy ? <Loader2 className="size-4 animate-spin text-gold" /> : <ArrowRight className="size-4 text-faint transition group-hover:translate-x-0.5 group-hover:text-gold" />}
              </button>
            );
          })}
          {error && <div className="rounded-lg border border-down/30 bg-down/10 px-3 py-2 text-xs text-down">{error}</div>}
          <p className="pt-2 text-center text-[11px] leading-relaxed text-faint">
            AtlasPad runs on {network.chain.name} (chain ID {network.chain.id}). Connecting is read-only — every transaction
            is shown for review first and requires explicit approval in your wallet.
          </p>
        </div>
      )}
    </Dialog>
  );
}
