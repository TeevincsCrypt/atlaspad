"use client";
import { use } from "react";
import { isAddress } from "viem";
import { CitizenProfileView } from "@/components/citizen/CitizenProfileView";
import { EmptyState } from "@/components/ui/misc";

export default function CitizenPage({ params }: { params: Promise<{ address: string }> }) {
  const { address } = use(params);
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6">
      {isAddress(address, { strict: false }) ? <CitizenProfileView address={address.toLowerCase()} /> : <EmptyState title="Invalid wallet address" />}
    </div>
  );
}
