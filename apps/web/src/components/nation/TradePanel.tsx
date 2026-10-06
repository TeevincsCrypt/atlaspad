"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useBalance, useReadContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { formatEther, formatUnits, parseEther, parseSignature, type Address } from "viem";
import { ArrowDownUp, Info, Settings2 } from "lucide-react";
import { atlasLaunchpadAbi, nationTokenAbi, uniswapV2RouterAbi } from "@atlaspad/shared/abis";
import { formatCompact, formatEth, formatPct, formatSmall, type NationSummary } from "@atlaspad/shared";
import { contracts, isDeployed, network } from "@/lib/env";
import { queryKeys } from "@/lib/api";
import { useUi } from "@/lib/store";
import type { ContractCall } from "@/lib/tx";
import { Button } from "../ui/Button";
import { Tabs } from "../ui/Tabs";
import { TxDialog, type TxRow } from "../tx/TxDialog";
import { toast } from "../ui/Toaster";

function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function safeParse(v: string): bigint | null {
  try {
    if (!v || Number(v) <= 0) return null;
    return parseEther(v as `${number}`);
  } catch {
    return null;
  }
}

const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

export function TradePanel({ nation }: { nation: NationSummary }) {
  const { address, isConnected } = useAccount();
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const qc = useQueryClient();
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [amount, setAmount] = useState("");
  const [slippageBps, setSlippageBps] = useState(nation.graduated ? 200 : 100);
  const [showSettings, setShowSettings] = useState(false);
  const [review, setReview] = useState(false);
  const token = nation.token as Address;
  const id = BigInt(nation.id);
  const venue = nation.graduated ? "uniswap" : "curve";
  const router = network.dex.uniswapV2Router;
  const weth = network.dex.weth;

  const ethBal = useBalance({ address, chainId: network.chain.id, query: { enabled: Boolean(address) } });
  const tokenBal = useReadContract({ address: token, abi: nationTokenAbi, functionName: "balanceOf", args: [address!], chainId: network.chain.id, query: { enabled: Boolean(address) } });
  const spender = venue === "curve" ? contracts?.launchpad : router;
  const allowance = useReadContract({
    address: token,
    abi: nationTokenAbi,
    functionName: "allowance",
    args: [address!, spender!],
    chainId: network.chain.id,
    query: { enabled: Boolean(address && spender) },
  });

  const debounced = useDebounced(amount);
  const amountWei = safeParse(debounced);

  const curveBuy = useReadContract({
    address: contracts?.launchpad,
    abi: atlasLaunchpadAbi,
    functionName: "quoteBuy",
    args: [id, amountWei ?? 0n],
    chainId: network.chain.id,
    query: { enabled: Boolean(contracts && venue === "curve" && side === "buy" && amountWei) },
  });
  const curveSell = useReadContract({
    address: contracts?.launchpad,
    abi: atlasLaunchpadAbi,
    functionName: "quoteSell",
    args: [id, amountWei ?? 0n],
    chainId: network.chain.id,
    query: { enabled: Boolean(contracts && venue === "curve" && side === "sell" && amountWei) },
  });
  const spot = useReadContract({
    address: contracts?.launchpad,
    abi: atlasLaunchpadAbi,
    functionName: "spotPrice",
    args: [id],
    chainId: network.chain.id,
    query: { enabled: Boolean(contracts && venue === "curve") },
  });
  const uniOut = useReadContract({
    address: router,
    abi: uniswapV2RouterAbi,
    functionName: "getAmountsOut",
    args: [amountWei ?? 0n, side === "buy" ? [weth, token] : [token, weth]],
    chainId: network.chain.id,
    query: { enabled: Boolean(venue === "uniswap" && amountWei) },
  });

  const quote = useMemo(() => {
    if (!amountWei) return null;
    if (venue === "curve") {
      const spotPrice = spot.data ? Number(formatEther(spot.data)) : nation.priceEth;
      if (side === "buy" && curveBuy.data) {
        const [tokensOut, fee, ethUsed, refund] = curveBuy.data;
        if (tokensOut === 0n) return { error: "This amount can't be bought on the curve." };
        const effective = Number(formatEther(ethUsed - fee)) / Number(formatEther(tokensOut));
        return {
          out: tokensOut,
          outLabel: `${formatCompact(Number(formatEther(tokensOut)))} $${nation.ticker}`,
          fee,
          refund,
          impact: spotPrice ? effective / spotPrice - 1 : null,
          minOut: (tokensOut * BigInt(10_000 - slippageBps)) / 10_000n,
          graduates: refund > 0n,
        };
      }
      if (side === "sell" && curveSell.data) {
        const [ethOut, fee] = curveSell.data;
        if (ethOut === 0n) return { error: "The curve can't buy back this amount (only tokens sold by the curve can be sold back)." };
        const effective = Number(formatEther(ethOut + fee)) / Number(formatEther(amountWei));
        return {
          out: ethOut,
          outLabel: formatEth(Number(formatEther(ethOut))),
          fee,
          refund: 0n,
          impact: spotPrice ? 1 - effective / spotPrice : null,
          minOut: (ethOut * BigInt(10_000 - slippageBps)) / 10_000n,
          graduates: false,
        };
      }
      return null;
    }
    if (uniOut.data) {
      const out = uniOut.data[1]!;
      const price = nation.priceEth ?? 0;
      const inNum = Number(formatEther(amountWei));
      const outNum = Number(formatEther(out));
      const effective = side === "buy" ? inNum / outNum : outNum / inNum;
      return {
        out,
        outLabel: side === "buy" ? `${formatCompact(outNum)} $${nation.ticker}` : formatEth(outNum),
        fee: (amountWei * 3n) / 1000n,
        refund: 0n,
        impact: price ? (side === "buy" ? effective / price - 1 : 1 - effective / price) : null,
        minOut: (out * BigInt(10_000 - slippageBps)) / 10_000n,
        graduates: false,
      };
    }
    return null;
  }, [amountWei, venue, side, curveBuy.data, curveSell.data, uniOut.data, spot.data, nation, slippageBps]);

  const ethBalance = ethBal.data?.value ?? 0n;
  const tokenBalance = tokenBal.data ?? 0n;
  const insufficient = amountWei !== null && (side === "buy" ? amountWei > ethBalance : amountWei > tokenBalance);
  const needsApproval = side === "sell" && amountWei !== null && (allowance.data ?? 0n) < amountWei;

  // --- Calls ---------------------------------------------------------------------------------
  const call: ContractCall | null = useMemo(() => {
    if (!amountWei || !quote || "error" in quote || !contracts) return null;
    if (venue === "curve") {
      if (side === "buy") return { address: contracts.launchpad, abi: atlasLaunchpadAbi, functionName: "buy", args: [id, quote.minOut, deadline()], value: amountWei };
      if (!needsApproval) return { address: contracts.launchpad, abi: atlasLaunchpadAbi, functionName: "sell", args: [id, amountWei, quote.minOut, deadline()] };
      return null; // permit path, built after signing
    }
    if (side === "buy") return { address: router, abi: uniswapV2RouterAbi, functionName: "swapExactETHForTokens", args: [quote.minOut, [weth, token], address, deadline()], value: amountWei };
    if (!needsApproval) return { address: router, abi: uniswapV2RouterAbi, functionName: "swapExactTokensForETH", args: [amountWei, quote.minOut, [token, weth], address, deadline()] };
    return null;
  }, [amountWei, quote, venue, side, needsApproval, id, router, weth, token, address]);

  const approveCall: ContractCall | null =
    venue === "uniswap" && needsApproval && amountWei ? { address: token, abi: nationTokenAbi, functionName: "approve", args: [router, amountWei] } : null;

  const buildPermitSell = async (sign: (typed: never) => Promise<`0x${string}` | null>): Promise<ContractCall | null> => {
    if (!amountWei || !quote || "error" in quote || !contracts || !address) return null;
    const res = await fetchPermitNonce(token, address);
    if (res === null) return null;
    const dl = deadline();
    const signature = await sign({
      domain: { name: nation.name, version: "1", chainId: network.chain.id, verifyingContract: token },
      types: {
        Permit: [
          { name: "owner", type: "address" },
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
      primaryType: "Permit",
      message: { owner: address, spender: contracts.launchpad, value: amountWei, nonce: res, deadline: dl },
    } as never);
    if (!signature) return null;
    const { v, r, s, yParity } = parseSignature(signature);
    return {
      address: contracts.launchpad,
      abi: atlasLaunchpadAbi,
      functionName: "sellWithPermit",
      args: [id, amountWei, quote.minOut, dl, Number(v ?? BigInt(yParity! + 27)), r, s],
    };
  };

  const fetchPermitNonce = async (t: Address, owner: Address): Promise<bigint | null> => {
    try {
      const { readContract } = await import("wagmi/actions");
      const { wagmiConfig } = await import("@/lib/wagmi");
      return await readContract(wagmiConfig, { address: t, abi: nationTokenAbi, functionName: "nonces", args: [owner], chainId: network.chain.id });
    } catch {
      return null;
    }
  };

  const rows: TxRow[] = quote && !("error" in quote)
    ? [
        { label: "Nation", value: `${nation.name} ($${nation.ticker})` },
        { label: side === "buy" ? "You pay" : "You sell", value: side === "buy" ? formatEth(Number(debounced)) : `${formatCompact(Number(debounced))} $${nation.ticker}`, emphasis: true },
        { label: "Expected to receive", value: quote.outLabel, emphasis: true },
        {
          label: "Minimum received",
          value: side === "buy" ? `${formatCompact(Number(formatEther(quote.minOut)))} $${nation.ticker}` : formatEth(Number(formatEther(quote.minOut))),
        },
        { label: "Slippage tolerance", value: `${slippageBps / 100}%` },
        {
          label: venue === "curve" ? "Trade fee (1%)" : "Uniswap LP fee (0.3%)",
          value: venue === "curve" ? `${formatEth(Number(formatEther(quote.fee)))} · half to the ${nation.name} treasury` : "Paid to the locked liquidity pool",
        },
        { label: "Venue", value: venue === "curve" ? "AtlasPad bonding curve" : "Uniswap V2 (locked liquidity)" },
        ...(quote.refund > 0n ? [{ label: "Refund", value: `${formatEth(Number(formatEther(quote.refund)))} — this buy sells out the curve and graduates the nation` }] : []),
      ]
    : [];

  if (!isDeployed) {
    return (
      <div className="panel p-5 text-sm text-dim">
        Trading is unavailable: AtlasPad contracts are not configured for {network.chain.name}.
      </div>
    );
  }

  const maxLabel = side === "buy" ? (ethBal.data ? formatEth(Number(formatEther(ethBalance))) : "—") : `${formatCompact(Number(formatUnits(tokenBalance, 18)))} $${nation.ticker}`;

  return (
    <div className="panel p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <Tabs
          tabs={[
            { key: "buy", label: "Buy" },
            { key: "sell", label: "Sell" },
          ]}
          value={side}
          onChange={(s) => {
            setSide(s);
            setAmount("");
          }}
          size="sm"
        />
        <button onClick={() => setShowSettings(!showSettings)} className="rounded-md p-1.5 text-faint hover:bg-white/5 hover:text-fg" aria-label="Slippage settings">
          <Settings2 className="size-4" />
        </button>
      </div>
      {showSettings && (
        <div className="mb-4 rounded-lg border border-line p-3">
          <div className="label mb-2">Slippage tolerance</div>
          <div className="flex gap-1.5">
            {[50, 100, 200, 500].map((b) => (
              <button
                key={b}
                onClick={() => setSlippageBps(b)}
                className={`flex-1 rounded-md border py-1 font-mono text-xs ${slippageBps === b ? "border-gold/50 bg-gold/10 text-gold-bright" : "border-line text-dim"}`}
              >
                {b / 100}%
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-faint">If the price moves more than this before your transaction is mined, it reverts and nothing is traded.</p>
        </div>
      )}
      <div className="rounded-xl border border-line bg-black/20 p-3.5">
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-faint">
          <span>{side === "buy" ? "You pay (ETH)" : `You sell ($${nation.ticker})`}</span>
          <button
            className="font-mono hover:text-gold"
            onClick={() => {
              if (side === "sell") setAmount(formatUnits(tokenBalance, 18));
              else if (ethBalance > parseEther("0.0005")) setAmount(formatEther(ethBalance - parseEther("0.0005")));
            }}
          >
            Balance: {isConnected ? maxLabel : "—"}
          </button>
        </div>
        <input
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
          placeholder="0.0"
          className="w-full bg-transparent font-display text-2xl text-fg outline-none placeholder:text-faint"
        />
        {side === "sell" && (
          <div className="mt-2 flex gap-1.5">
            {[25, 50, 75, 100].map((p) => (
              <button key={p} onClick={() => setAmount(formatUnits((tokenBalance * BigInt(p)) / 100n, 18))} className="rounded border border-line px-2 py-0.5 font-mono text-[10px] text-faint hover:text-fg">
                {p}%
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="my-2 flex justify-center text-faint">
        <ArrowDownUp className="size-4" />
      </div>
      <div className="rounded-xl border border-line bg-black/10 p-3.5">
        <div className="mb-1 text-[11px] text-faint">You receive (estimated)</div>
        <div className="font-display text-xl text-fg">{quote && !("error" in quote) ? quote.outLabel : amountWei ? "…" : "—"}</div>
      </div>

      {quote && "error" in quote && <div className="mt-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">{quote.error}</div>}
      {quote && !("error" in quote) && (
        <div className="mt-3 space-y-1.5 text-xs">
          <Row label="Price impact" value={quote.impact === null ? "—" : formatPct(quote.impact, 2)} warn={(quote.impact ?? 0) > 0.05} />
          <Row label="Spot price" value={nation.priceEth ? `${formatSmall(nation.priceEth)} ETH` : "—"} />
          <Row label="Liquidity" value={formatEth(nation.liquidityEth)} />
          <Row label="Fee" value={venue === "curve" ? "1% (0.5% treasury · 0.5% protocol)" : "0.3% Uniswap LP"} />
        </div>
      )}

      <div className="mt-4">
        {!isConnected ? (
          <Button variant="primary" className="w-full" size="lg" onClick={() => setWalletOpen(true)}>
            Connect wallet to trade
          </Button>
        ) : insufficient ? (
          <Button className="w-full" size="lg" disabled>
            Insufficient {side === "buy" ? "ETH" : `$${nation.ticker}`}
          </Button>
        ) : (
          <Button variant="primary" className="w-full" size="lg" disabled={!quote || "error" in quote} onClick={() => setReview(true)}>
            {approveCall ? `Approve $${nation.ticker}` : side === "buy" ? `Buy $${nation.ticker}` : `Sell $${nation.ticker}`}
          </Button>
        )}
      </div>
      <p className="mt-3 flex gap-1.5 text-[11px] leading-relaxed text-faint">
        <Info className="mt-0.5 size-3 shrink-0" />
        {venue === "curve"
          ? "Bonding-curve trades settle instantly against the curve. When the curve sells out, liquidity migrates to Uniswap V2 and is locked forever."
          : "This nation has graduated. Trades route through its Uniswap V2 pool, whose liquidity is permanently locked."}{" "}
        Prices can move against you. Nothing here is financial advice.
      </p>

      <TxDialog
        open={review}
        onClose={() => setReview(false)}
        title={approveCall ? "Approve token" : `${side === "buy" ? "Buy" : "Sell"} $${nation.ticker}`}
        action={approveCall ? `Allow the Uniswap V2 Router to spend ${debounced} $${nation.ticker}` : `${side === "buy" ? "Buy" : "Sell"} $${nation.ticker} on ${venue === "curve" ? "the bonding curve" : "Uniswap V2"}`}
        rows={approveCall ? [{ label: "Token", value: `$${nation.ticker}` }, { label: "Spender", value: "Uniswap V2 Router" }, { label: "Amount", value: debounced }] : rows}
        previewCall={approveCall ?? call}
        buildCall={!approveCall && !call && venue === "curve" && side === "sell" ? (sign) => buildPermitSell(sign as never) : undefined}
        notice={
          !approveCall && !call && venue === "curve" && side === "sell"
            ? "You'll first sign a gasless permit allowing the bonding curve to take exactly this amount, then confirm the sale."
            : approveCall
              ? "After approval, review and confirm the swap."
              : undefined
        }
        onConfirmed={() => {
          void qc.invalidateQueries({ queryKey: queryKeys.nation(nation.id) });
          void qc.invalidateQueries({ queryKey: queryKeys.world });
          void tokenBal.refetch();
          void allowance.refetch();
          void ethBal.refetch();
          if (!approveCall) setAmount("");
          toast.success(approveCall ? "Approval confirmed" : "Trade confirmed", approveCall ? "You can now complete the swap." : undefined);
        }}
        successTitle={approveCall ? "Approval confirmed" : `${side === "buy" ? "Bought" : "Sold"} $${nation.ticker}`}
      />
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-faint">{label}</span>
      <span className={`font-mono ${warn ? "text-warn" : "text-dim"}`}>{value}</span>
    </div>
  );
}
