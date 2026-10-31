"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { PnlCardDialog } from "../pnl/PnlCard";
import { useQueryClient } from "@tanstack/react-query";
import { formatUnits, parseSignature, parseUnits, type Address } from "viem";
import { ArrowDownUp, ExternalLink, Info, Settings2 } from "lucide-react";
import { atlasLaunchpadAbi, nationTokenAbi, uniswapV2RouterAbi } from "@atlaspad/shared/abis";
import { WIF_DECIMALS, formatCompact, formatWif, formatPct, formatSmall, type NationSummary } from "@atlaspad/shared";
import { contracts, getWifUrl, isDeployed, network, wifToken } from "@/lib/env";
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

function safeParse(v: string, decimals: number): bigint | null {
  try {
    if (!v || Number(v) <= 0) return null;
    return parseUnits(v as `${number}`, decimals);
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
  const [pnlTx, setPnlTx] = useState<string | null>(null);
  const token = nation.token as Address;
  const id = BigInt(nation.id);
  const venue = nation.graduated ? "uniswap" : "curve";
  const router = network.dex.uniswapV2Router;
  const wif = wifToken;
  /** Buys spend $WIF; sells spend the nation token. Both use 18 decimals except $WIF, which uses WIF_DECIMALS. */
  const inputToken = side === "buy" ? wif : token;
  const fmtWif = (units: bigint) => Number(formatUnits(units, WIF_DECIMALS));
  const fmtTok = (units: bigint) => Number(formatUnits(units, 18));

  // $WIF is a plain ERC-20, so any ERC-20 ABI reads its balance and allowance.
  const wifBal = useReadContract({ address: wif, abi: nationTokenAbi, functionName: "balanceOf", args: [address!], chainId: network.chain.id, query: { enabled: Boolean(address) } });
  const tokenBal = useReadContract({ address: token, abi: nationTokenAbi, functionName: "balanceOf", args: [address!], chainId: network.chain.id, query: { enabled: Boolean(address) } });
  const spender = venue === "curve" ? contracts?.launchpad : router;
  const allowance = useReadContract({
    address: inputToken,
    abi: nationTokenAbi,
    functionName: "allowance",
    args: [address!, spender!],
    chainId: network.chain.id,
    query: { enabled: Boolean(address && spender) },
  });

  const debounced = useDebounced(amount);
  const amountWei = safeParse(debounced, side === "buy" ? WIF_DECIMALS : 18);

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
    args: [amountWei ?? 0n, side === "buy" ? [wif, token] : [token, wif]],
    chainId: network.chain.id,
    query: { enabled: Boolean(venue === "uniswap" && amountWei) },
  });

  const quote = useMemo(() => {
    if (!amountWei) return null;
    if (venue === "curve") {
      const spotPrice = spot.data ? fmtWif(spot.data) : nation.priceWif;
      if (side === "buy" && curveBuy.data) {
        const [tokensOut, fee, wifUsed, graduates] = curveBuy.data;
        if (tokensOut === 0n) return { error: "This amount can't be bought on the curve." };
        const effective = fmtWif(wifUsed - fee) / fmtTok(tokensOut);
        return {
          out: tokensOut,
          outLabel: `${formatCompact(fmtTok(tokensOut))} $${nation.ticker}`,
          fee,
          // A buy that sells out the curve only pulls the $WIF it needs.
          refund: graduates ? amountWei - wifUsed : 0n,
          impact: spotPrice ? effective / spotPrice - 1 : null,
          minOut: (tokensOut * BigInt(10_000 - slippageBps)) / 10_000n,
          graduates,
        };
      }
      if (side === "sell" && curveSell.data) {
        const [wifOut, fee] = curveSell.data;
        if (wifOut === 0n) return { error: "The curve can't buy back this amount (only tokens sold by the curve can be sold back)." };
        const effective = fmtWif(wifOut + fee) / fmtTok(amountWei);
        return {
          out: wifOut,
          outLabel: formatWif(fmtWif(wifOut)),
          fee,
          refund: 0n,
          impact: spotPrice ? 1 - effective / spotPrice : null,
          minOut: (wifOut * BigInt(10_000 - slippageBps)) / 10_000n,
          graduates: false,
        };
      }
      return null;
    }
    if (uniOut.data) {
      const out = uniOut.data[1]!;
      const price = nation.priceWif ?? 0;
      const inNum = side === "buy" ? fmtWif(amountWei) : fmtTok(amountWei);
      const outNum = side === "buy" ? fmtTok(out) : fmtWif(out);
      const effective = side === "buy" ? inNum / outNum : outNum / inNum;
      return {
        out,
        outLabel: side === "buy" ? `${formatCompact(outNum)} $${nation.ticker}` : formatWif(outNum),
        fee: (amountWei * 3n) / 1000n,
        refund: 0n,
        impact: price ? (side === "buy" ? effective / price - 1 : 1 - effective / price) : null,
        minOut: (out * BigInt(10_000 - slippageBps)) / 10_000n,
        graduates: false,
      };
    }
    return null;
  }, [amountWei, venue, side, curveBuy.data, curveSell.data, uniOut.data, spot.data, nation, slippageBps]);

  const wifBalance = wifBal.data ?? 0n;
  const tokenBalance = tokenBal.data ?? 0n;
  const insufficient = amountWei !== null && (side === "buy" ? amountWei > wifBalance : amountWei > tokenBalance);
  const needsApproval = amountWei !== null && (allowance.data ?? 0n) < amountWei;
  // Curve sells skip the approval transaction: the nation token supports EIP-2612 permits.
  const usePermit = venue === "curve" && side === "sell" && needsApproval;

  // --- Calls ---------------------------------------------------------------------------------
  const call: ContractCall | null = useMemo(() => {
    if (!amountWei || !quote || "error" in quote || !contracts) return null;
    if (venue === "curve") {
      if (needsApproval) return null; // approval first (buy) or permit path, built after signing (sell)
      if (side === "buy") return { address: contracts.launchpad, abi: atlasLaunchpadAbi, functionName: "buy", args: [id, amountWei, quote.minOut, deadline()] };
      return { address: contracts.launchpad, abi: atlasLaunchpadAbi, functionName: "sell", args: [id, amountWei, quote.minOut, deadline()] };
    }
    if (needsApproval) return null;
    const path = side === "buy" ? [wif, token] : [token, wif];
    return { address: router, abi: uniswapV2RouterAbi, functionName: "swapExactTokensForTokens", args: [amountWei, quote.minOut, path, address, deadline()] };
  }, [amountWei, quote, venue, side, needsApproval, id, router, wif, token, address]);

  const approveCall: ContractCall | null =
    needsApproval && !usePermit && amountWei && spender
      ? { address: inputToken, abi: nationTokenAbi, functionName: "approve", args: [spender, amountWei] }
      : null;
  const inputSymbol = side === "buy" ? "$WIF" : `$${nation.ticker}`;
  const spenderName = venue === "curve" ? "the AtlasPad launchpad" : "the Uniswap V2 Router";

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
        { label: side === "buy" ? "You pay" : "You sell", value: side === "buy" ? formatWif(Number(debounced)) : `${formatCompact(Number(debounced))} $${nation.ticker}`, emphasis: true },
        { label: "Expected to receive", value: quote.outLabel, emphasis: true },
        {
          label: "Minimum received",
          value: side === "buy" ? `${formatCompact(fmtTok(quote.minOut))} $${nation.ticker}` : formatWif(fmtWif(quote.minOut)),
        },
        { label: "Slippage tolerance", value: `${slippageBps / 100}%` },
        {
          label: venue === "curve" ? "Trade fee (1%)" : "Uniswap LP fee (0.3%)",
          value:
            venue === "curve"
              ? `${formatWif(fmtWif(quote.fee))} · 0.5% to the ${nation.name} treasury · 0.25% burned · 0.25% protocol`
              : "Paid to the locked liquidity pool",
        },
        ...(venue === "curve" ? [{ label: "$WIF burned by this trade", value: formatWif(fmtWif(quote.fee / 4n)) }] : []),
        { label: "Venue", value: venue === "curve" ? "AtlasPad bonding curve" : "Uniswap V2 (locked liquidity)" },
        ...(quote.graduates
          ? [{ label: "Graduation", value: `This buy sells out the curve and graduates the nation. Only ${formatWif(fmtWif(amountWei! - quote.refund))} is taken.` }]
          : []),
      ]
    : [];

  if (!isDeployed) {
    return (
      <div className="panel p-5 text-sm text-dim">
        Trading is unavailable: AtlasPad contracts are not configured for {network.chain.name}.
      </div>
    );
  }

  const maxLabel = side === "buy" ? (wifBal.data !== undefined ? formatWif(fmtWif(wifBalance)) : "—") : `${formatCompact(fmtTok(tokenBalance))} $${nation.ticker}`;

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
          <span>{side === "buy" ? "You pay ($WIF)" : `You sell ($${nation.ticker})`}</span>
          <button
            className="font-mono hover:text-gold"
            onClick={() => {
              if (side === "sell") setAmount(formatUnits(tokenBalance, 18));
              else if (wifBalance > 0n) setAmount(formatUnits(wifBalance, WIF_DECIMALS));
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
          <Row label="Spot price" value={nation.priceWif ? `${formatSmall(nation.priceWif)} WIF` : "—"} />
          <Row label="Liquidity" value={formatWif(nation.liquidityWif)} />
          <Row label="Fee" value={venue === "curve" ? "1% (0.5% treasury · 0.25% burned · 0.25% protocol)" : "0.3% Uniswap LP"} />
        </div>
      )}

      <div className="mt-4">
        {!isConnected ? (
          <Button variant="primary" className="w-full" size="lg" onClick={() => setWalletOpen(true)}>
            Connect wallet to trade
          </Button>
        ) : insufficient ? (
          side === "buy" ? (
            <a href={getWifUrl} target="_blank" rel="noreferrer" className="block">
              <Button variant="primary" className="w-full" size="lg">
                Not enough $WIF · Get $WIF <ExternalLink className="ml-1.5 size-4" />
              </Button>
            </a>
          ) : (
            <Button className="w-full" size="lg" disabled>
              Insufficient $${nation.ticker}
            </Button>
          )
        ) : (
          <Button
            variant="primary"
            className="w-full"
            size="lg"
            disabled={!quote || "error" in quote}
            onClick={async () => {
              // Re-read the allowance first: another flow (e.g. founding) may have spent a cached approval.
              await allowance.refetch();
              setReview(true);
            }}
          >
            {approveCall ? `Approve ${inputSymbol}` : side === "buy" ? `Buy $${nation.ticker} with $WIF` : `Sell $${nation.ticker} for $WIF`}
          </Button>
        )}
      </div>
      <p className="mt-3 flex gap-1.5 text-[11px] leading-relaxed text-faint">
        <Info className="mt-0.5 size-3 shrink-0" />
        {venue === "curve"
          ? "Bonding-curve trades settle in $WIF instantly. Every trade burns 0.25% in $WIF and funds the nation treasury. When the curve sells out, its $WIF migrates to a nation/WIF Uniswap V2 pool and is locked forever."
          : "This nation has graduated. Trades route through its nation/WIF Uniswap V2 pool, whose liquidity is permanently locked."}{" "}
        Prices can move against you. Nothing here is financial advice.
      </p>

      <TxDialog
        open={review}
        onClose={() => setReview(false)}
        title={approveCall ? `Approve ${inputSymbol}` : `${side === "buy" ? "Buy" : "Sell"} $${nation.ticker}`}
        action={approveCall ? `Allow ${spenderName} to spend ${debounced} ${inputSymbol}` : `${side === "buy" ? "Buy" : "Sell"} $${nation.ticker} on ${venue === "curve" ? "the bonding curve" : "Uniswap V2"}`}
        rows={approveCall ? [{ label: "Token", value: inputSymbol }, { label: "Spender", value: spenderName }, { label: "Amount", value: debounced }] : rows}
        previewCall={approveCall ?? call}
        buildCall={usePermit ? (sign) => buildPermitSell(sign as never) : undefined}
        notice={
          usePermit
            ? "You'll first sign a gasless permit allowing the bonding curve to take exactly this amount, then confirm the sale."
            : approveCall
              ? "After approval, review and confirm the trade."
              : undefined
        }
        onConfirmed={(receipt) => {
          if (!approveCall && side === "sell") {
            // Show the sale's PnL card once the review dialog closes.
            setReview(false);
            setPnlTx(receipt.transactionHash);
          }
          void qc.invalidateQueries({ queryKey: queryKeys.nation(nation.id) });
          void qc.invalidateQueries({ queryKey: queryKeys.world });
          void tokenBal.refetch();
          void allowance.refetch();
          void wifBal.refetch();
          if (!approveCall) setAmount("");
          toast.success(approveCall ? "Approval confirmed" : "Trade confirmed", approveCall ? "You can now complete the trade." : undefined);
        }}
        successTitle={approveCall ? "Approval confirmed" : `${side === "buy" ? "Bought" : "Sold"} $${nation.ticker}`}
      />
      <PnlCardDialog tx={pnlTx} onClose={() => setPnlTx(null)} />
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
