"use client";
import { useCallback, useRef, useState } from "react";
import { useAccount, useConfig } from "wagmi";
import {
  estimateGas,
  getGasPrice,
  signTypedData,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
} from "wagmi/actions";
import {
  WaitForTransactionReceiptTimeoutError,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hash,
  type TransactionReceipt,
  type TypedDataDefinition,
} from "viem";
import { friendlyError, type FriendlyError } from "./errors";
import { network } from "./env";
import { playSound } from "./sound";

export type TxPhase =
  | "idle"
  | "preparing"
  | "awaiting_wallet"
  | "awaiting_signature"
  | "submitted"
  | "confirming"
  | "confirmed"
  | "failed"
  | "rejected"
  | "timeout";

export const PHASE_LABEL: Record<TxPhase, string> = {
  idle: "Ready",
  preparing: "Preparing transaction",
  awaiting_wallet: "Confirm in your wallet",
  awaiting_signature: "Sign in your wallet",
  submitted: "Submitted to the network",
  confirming: "Waiting for confirmation",
  confirmed: "Transaction confirmed",
  failed: "Transaction failed",
  rejected: "Rejected in wallet",
  timeout: "Still pending",
};

export interface ContractCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
}

export interface TxState {
  phase: TxPhase;
  hash: Hash | null;
  receipt: TransactionReceipt | null;
  error: FriendlyError | null;
  gasWei: bigint | null;
}

const INITIAL: TxState = { phase: "idle", hash: null, receipt: null, error: null, gasWei: null };
const CONFIRM_TIMEOUT_MS = 180_000;

/**
 * Wallet transaction lifecycle with explicit, honest states. A transaction is only reported as confirmed once a
 * successful receipt is observed on-chain.
 */
export function useAtlasTx() {
  const config = useConfig();
  const { address, chainId } = useAccount();
  const [state, setState] = useState<TxState>(INITIAL);
  const running = useRef(false);

  const reset = useCallback(() => {
    running.current = false;
    setState(INITIAL);
  }, []);

  const ensureNetwork = useCallback(async () => {
    if (chainId !== network.chain.id) await switchChain(config, { chainId: network.chain.id });
  }, [chainId, config]);

  /** Simulate + estimate gas. Returns the estimated network fee in wei, or null (with a friendly error) on failure. */
  const prepare = useCallback(
    async (call: ContractCall): Promise<bigint | null> => {
      if (!address) return null;
      setState({ ...INITIAL, phase: "preparing" });
      try {
        await simulateContract(config, { ...call, account: address, chainId: network.chain.id } as never);
        const data = encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args } as never);
        const [gas, price] = await Promise.all([
          estimateGas(config, { to: call.address, data, value: call.value, account: address, chainId: network.chain.id }),
          getGasPrice(config, { chainId: network.chain.id }),
        ]);
        const gasWei: bigint = gas * price;
        setState({ ...INITIAL, gasWei });
        return gasWei;
      } catch (err) {
        setState({ ...INITIAL, phase: "failed", error: friendlyError(err) });
        return null;
      }
    },
    [address, config],
  );

  const send = useCallback(
    async (call: ContractCall): Promise<TransactionReceipt | null> => {
      if (running.current || !address) return null;
      running.current = true;
      try {
        await ensureNetwork();
        setState((s) => ({ ...s, phase: "awaiting_wallet", error: null }));
        const hash = await writeContract(config, { ...call, chainId: network.chain.id } as never);
        setState((s) => ({ ...s, phase: "submitted", hash }));
        setState((s) => ({ ...s, phase: "confirming" }));
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: network.chain.id, timeout: CONFIRM_TIMEOUT_MS });
        if (receipt.status === "success") {
          setState((s) => ({ ...s, phase: "confirmed", receipt }));
          playSound("confirm");
          return receipt;
        }
        setState((s) => ({
          ...s,
          phase: "failed",
          receipt,
          error: { title: "Transaction reverted", message: "The transaction was mined but reverted. No state changed except gas spent.", rejected: false, technical: "status: reverted" },
        }));
        playSound("error");
        return null;
      } catch (err) {
        if (err instanceof WaitForTransactionReceiptTimeoutError) {
          setState((s) => ({
            ...s,
            phase: "timeout",
            error: { title: "Still pending", message: "The network hasn't confirmed this transaction yet. It may still confirm — check the explorer.", rejected: false, technical: "timeout" },
          }));
          return null;
        }
        const fe = friendlyError(err);
        setState((s) => ({ ...s, phase: fe.rejected ? "rejected" : "failed", error: fe }));
        if (!fe.rejected) playSound("error");
        return null;
      } finally {
        running.current = false;
      }
    },
    [address, config, ensureNetwork],
  );

  const sign = useCallback(
    async (typed: TypedDataDefinition): Promise<Hash | null> => {
      try {
        await ensureNetwork();
        setState((s) => ({ ...s, phase: "awaiting_signature", error: null }));
        const sig = await signTypedData(config, typed as never);
        setState((s) => ({ ...s, phase: "idle" }));
        return sig;
      } catch (err) {
        const fe = friendlyError(err);
        setState((s) => ({ ...s, phase: fe.rejected ? "rejected" : "failed", error: fe }));
        return null;
      }
    },
    [config, ensureNetwork],
  );

  const busy = ["preparing", "awaiting_wallet", "awaiting_signature", "submitted", "confirming"].includes(state.phase);
  return { ...state, busy, prepare, send, sign, reset, wrongNetwork: Boolean(address) && chainId !== network.chain.id };
}
