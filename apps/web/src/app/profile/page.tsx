"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useUi } from "@/lib/store";
import { CitizenProfileView } from "@/components/citizen/CitizenProfileView";
import { Button } from "@/components/ui/Button";

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6">
      {mounted && isConnected && address ? (
        <CitizenProfileView address={address.toLowerCase()} />
      ) : (
        <div className="panel mx-auto max-w-md p-10 text-center">
          <div className="text-3xl">🪪</div>
          <h1 className="mt-3 font-display text-xl text-fg">Your citizen profile</h1>
          <p className="mt-2 text-sm text-dim">Connect a wallet to see your citizenships, achievements, XP and governance record.</p>
          <Button variant="primary" className="mt-6" onClick={() => setWalletOpen(true)}>
            Connect wallet
          </Button>
        </div>
      )}
    </div>
  );
}
