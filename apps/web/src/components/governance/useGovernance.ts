"use client";
import { useAccount, useReadContract } from "wagmi";
import type { Address } from "viem";
import { atlasGovernorAbi, nationTokenAbi } from "@atlaspad/shared/abis";
import { contracts, network } from "@/lib/env";

/** Connected wallet's governance standing in a nation (live from the chain). */
export function useVotingPower(token: string, nationId: number) {
  const { address } = useAccount();
  const enabled = Boolean(address);
  const votes = useReadContract({ address: token as Address, abi: nationTokenAbi, functionName: "getVotes", args: [address!], chainId: network.chain.id, query: { enabled } });
  const balance = useReadContract({ address: token as Address, abi: nationTokenAbi, functionName: "balanceOf", args: [address!], chainId: network.chain.id, query: { enabled } });
  const delegate = useReadContract({ address: token as Address, abi: nationTokenAbi, functionName: "delegates", args: [address!], chainId: network.chain.id, query: { enabled } });
  const threshold = useReadContract({
    address: contracts?.governor,
    abi: atlasGovernorAbi,
    functionName: "proposalThreshold",
    args: [BigInt(nationId)],
    chainId: network.chain.id,
    query: { enabled: Boolean(contracts) },
  });
  return {
    address,
    votes: votes.data ?? 0n,
    balance: balance.data ?? 0n,
    delegate: delegate.data,
    threshold: threshold.data ?? null,
    canPropose: threshold.data !== undefined && (votes.data ?? 0n) >= threshold.data,
    refetch: () => {
      void votes.refetch();
      void balance.refetch();
      void delegate.refetch();
    },
  };
}

export function useProposalVoter(proposalId: number, token: string, snapshot: number) {
  const { address } = useAccount();
  const hasVoted = useReadContract({
    address: contracts?.governor,
    abi: atlasGovernorAbi,
    functionName: "hasVoted",
    args: [BigInt(proposalId), address!],
    chainId: network.chain.id,
    query: { enabled: Boolean(address && contracts) },
  });
  const weight = useReadContract({
    address: token as Address,
    abi: nationTokenAbi,
    functionName: "getPastVotes",
    args: [address!, BigInt(snapshot)],
    chainId: network.chain.id,
    query: { enabled: Boolean(address) },
  });
  return { hasVoted: hasVoted.data ?? false, weight: weight.data ?? 0n, refetch: () => void hasVoted.refetch() };
}
