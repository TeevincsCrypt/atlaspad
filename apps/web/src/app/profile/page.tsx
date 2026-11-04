"use client";
import { ConnectGate } from "@/components/wallet/ConnectGate";
import { useAccount } from "wagmi";
import { useUi } from "@/lib/store";
import { CitizenProfileView } from "@/components/citizen/CitizenProfileView";
import { Button } from "@/components/ui/Button";
import { useHydrated } from "@/lib/hooks";

export default function ProfilePage() {
  const { address, isConnected } = useAccount();
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const mounted = useHydrated();
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6">
      {mounted && isConnected && address ? (
        <CitizenProfileView address={address.toLowerCase()} />
      ) : (
        <ConnectGate
          title="Your citizen profile"
          body="Connect a wallet to see your citizenships, achievements, XP and governance record."
          perks={["Profit & loss on every nation you trade", "PnL cards for every sale", "XP, ranks and achievements"]}
        />
      )}
    </div>
  );
}
