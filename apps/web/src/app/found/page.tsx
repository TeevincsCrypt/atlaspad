"use client";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ExternalLink, Flame, Loader2, ShieldCheck, X } from "lucide-react";
import { decodeEventLog, formatEther, formatUnits, parseUnits } from "viem";
import { atlasLaunchpadAbi, nationTokenAbi } from "@atlaspad/shared/abis";
import {
  LAUNCHPAD,
  THEMES,
  WIF_DECIMALS,
  curveMilestones,
  encodeEmblem,
  formatCompact,
  formatWif,
  initialCurve,
  quoteBuy,
  type Emblem,
} from "@atlaspad/shared";
import { contracts, getWifUrl, isDeployed, network, wifToken } from "@/lib/env";
import { queryKeys } from "@/lib/api";
import { useUi } from "@/lib/store";
import { useAtlasTx } from "@/lib/tx";
import { Button } from "@/components/ui/Button";
import { Flag } from "@/components/emblem/Flag";
import { EmblemEditor } from "@/components/emblem/EmblemEditor";
import { EmblemUpload } from "@/components/emblem/EmblemUpload";
import { FoundingSequence } from "@/components/found/FoundingSequence";

const STEPS = ["Name", "Ticker", "Description", "Theme", "Symbol", "Token", "Review", "Launch"] as const;
const NAME_RE = /^[A-Za-z0-9 .'-]+$/;
const SUPPLIES = [
  { label: "1M", value: 1_000_000n },
  { label: "100M", value: 100_000_000n },
  { label: "1B", value: 1_000_000_000n },
  { label: "10B", value: 10_000_000_000n },
  { label: "100B", value: 100_000_000_000n },
  { label: "1T", value: 1_000_000_000_000n },
];
const THEME_GLYPH: Record<string, Emblem["glyph"]> = {
  medieval: "crown", cyberpunk: "chip", space: "planet", ocean: "wave", jungle: "leaf", meme: "frog", ai: "eye", fantasy: "dragon",
};

function validateName(n: string): string | null {
  if (n.length < 2 || n.length > 32) return "2–32 characters.";
  if (!NAME_RE.test(n)) return "Letters, numbers, spaces, dots, dashes and apostrophes only.";
  if (n.startsWith(" ") || n.endsWith(" ")) return "No leading or trailing spaces.";
  if (n.includes("  ")) return "No double spaces.";
  return null;
}
function validateTicker(t: string): string | null {
  if (t.length < 2 || t.length > 10) return "2–10 characters.";
  if (!/^[A-Z0-9]+$/.test(t)) return "A–Z and 0–9 only.";
  return null;
}

function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function FoundPage() {
  const { address, isConnected } = useAccount();
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [ticker, setTicker] = useState("");
  const [description, setDescription] = useState("");
  const [theme, setTheme] = useState(5);
  // The theme presets the emblem until the founder customizes it.
  const [customEmblem, setCustomEmblem] = useState<bigint | null>(null);
  // Optional uploaded picture; its URL is written on-chain as the nation's metadataURI.
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [supply, setSupply] = useState(1_000_000_000n);
  const [founderBps, setFounderBps] = useState(0);
  const [initialBuy, setInitialBuy] = useState("");
  const [ack, setAck] = useState(false);
  const [sequence, setSequence] = useState(false);
  const [nationId, setNationId] = useState<number | null>(null);
  const tx = useAtlasTx();

  const dName = useDebounced(name.trim());
  const dTicker = useDebounced(ticker);
  const nameAvail = useReadContract({ address: contracts?.launchpad, abi: atlasLaunchpadAbi, functionName: "isNameAvailable", args: [dName], chainId: network.chain.id, query: { enabled: Boolean(contracts && !validateName(dName)) } });
  const tickerAvail = useReadContract({ address: contracts?.launchpad, abi: atlasLaunchpadAbi, functionName: "isSymbolAvailable", args: [dTicker], chainId: network.chain.id, query: { enabled: Boolean(contracts && !validateTicker(dTicker)) } });
  const gradWif = useReadContract({ address: contracts?.launchpad, abi: atlasLaunchpadAbi, functionName: "graduationWif", chainId: network.chain.id, query: { enabled: Boolean(contracts) } });
  const creationFee = useReadContract({ address: contracts?.launchpad, abi: atlasLaunchpadAbi, functionName: "creationFee", chainId: network.chain.id, query: { enabled: Boolean(contracts) } });
  // $WIF is a plain ERC-20: any ERC-20 ABI reads its balance and allowance.
  const wifBalance = useReadContract({ address: wifToken, abi: nationTokenAbi, functionName: "balanceOf", args: [address!], chainId: network.chain.id, query: { enabled: Boolean(address) } });
  const wifAllowance = useReadContract({
    address: wifToken,
    abi: nationTokenAbi,
    functionName: "allowance",
    args: [address!, contracts?.launchpad ?? wifToken],
    chainId: network.chain.id,
    query: { enabled: Boolean(address && contracts) },
  });

  const emblem = useMemo(() => {
    if (customEmblem !== null) return customEmblem;
    const t = THEMES[theme]!;
    return encodeEmblem({ glyph: THEME_GLYPH[t.key] ?? "star", pattern: "chevron", primary: t.palette[0], secondary: t.palette[1], accent: t.palette[2] });
  }, [customEmblem, theme]);

  const totalSupplyWei = supply * 10n ** 18n;
  const initialBuyWei = (() => {
    try {
      return initialBuy ? parseUnits(initialBuy as `${number}`, WIF_DECIMALS) : 0n;
    } catch {
      return null;
    }
  })();
  const milestones = useMemo(() => (gradWif.data ? curveMilestones(totalSupplyWei, BigInt(founderBps), gradWif.data) : null), [gradWif.data, totalSupplyWei, founderBps]);
  const buyPreview = useMemo(() => {
    if (!gradWif.data || !initialBuyWei) return null;
    const q = quoteBuy(initialCurve(totalSupplyWei, BigInt(founderBps), gradWif.data), initialBuyWei);
    const share = Number((q.tokensOut * 10_000n) / totalSupplyWei) / 100;
    return { ...q, share, tooLarge: q.tokensOut > (totalSupplyWei * LAUNCHPAD.MAX_INITIAL_BUY_BPS) / LAUNCHPAD.BPS };
  }, [gradWif.data, initialBuyWei, totalSupplyWei, founderBps]);

  const fee = creationFee.data ?? 0n;
  /** Total $WIF the founding transaction pulls: the burned creation fee plus the optional initial buy. */
  const wifTotal = fee + (initialBuyWei ?? 0n);
  const needsApproval = wifTotal > 0n && (wifAllowance.data ?? 0n) < wifTotal;
  const notEnoughWif = wifBalance.data !== undefined && wifBalance.data < wifTotal;
  const wif = (units: bigint) => formatWif(Number(formatUnits(units, WIF_DECIMALS)));
  const call = contracts
    ? {
        address: contracts.launchpad,
        abi: atlasLaunchpadAbi,
        functionName: "foundNation",
        args: [
          {
            name: name.trim(),
            symbol: ticker,
            description: description.trim(),
            metadataURI: imageUrl ?? "",
            theme,
            emblem,
            totalSupply: totalSupplyWei,
            founderBps,
            initialBuyWif: initialBuyWei ?? 0n,
            minTokensOut: buyPreview ? (buyPreview.tokensOut * 98n) / 100n : 0n,
          },
        ],
      }
    : null;
  const approveCall = contracts ? { address: wifToken, abi: nationTokenAbi, functionName: "approve", args: [contracts.launchpad, wifTotal] } : null;

  const nameErr = name ? validateName(name.trim()) : null;
  const tickerErr = ticker ? validateTicker(ticker) : null;
  const canNext = [
    !validateName(name.trim()) && nameAvail.data === true && dName === name.trim(),
    !validateTicker(ticker) && tickerAvail.data === true && dTicker === ticker,
    description.length <= 280,
    true,
    true,
    initialBuyWei !== null && !buyPreview?.tooLarge,
    true,
    true,
  ][step];

  useEffect(() => {
    // The founding call can only be simulated once the launchpad may pull the $WIF.
    if (step === 7 && call && isConnected && !needsApproval) void tx.prepare(call);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isConnected, needsApproval]);

  const approve = async () => {
    if (!approveCall) return;
    const receipt = await tx.send(approveCall);
    if (receipt) await wifAllowance.refetch();
  };

  const launch = async () => {
    if (!call) return;
    setSequence(true);
    const receipt = await tx.send(call);
    if (!receipt) return;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== contracts!.launchpad.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: atlasLaunchpadAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "NationFounded") setNationId(Number(ev.args.nationId));
      } catch {
        /* other events */
      }
    }
    void qc.invalidateQueries({ queryKey: queryKeys.world });
    // Founding spends the $WIF approval and balance; drop cached reads so other screens re-check them.
    void wifAllowance.refetch();
    void wifBalance.refetch();
  };

  if (!isDeployed) {
    return (
      <div className="mx-auto max-w-xl px-5 pt-32 text-center">
        <div className="panel p-10">
          <AlertTriangle className="mx-auto size-6 text-warn" />
          <h1 className="mt-4 font-display text-xl text-fg">Founding is not available yet</h1>
          <p className="mt-2 text-sm text-dim">AtlasPad contracts are not configured for {network.chain.name}. No transaction can be sent until the verified deployment is live.</p>
        </div>
      </div>
    );
  }

  const input = "w-full rounded-xl border border-line bg-black/30 px-4 py-3.5 text-lg text-fg outline-none transition focus:border-gold/50";
  const t = THEMES[theme]!;

  return (
    <div className="relative min-h-[100dvh] pb-24 pt-20">
      <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at 70% 10%, ${t.palette[0]}1a, transparent 55%)` }} />
      <div className="relative mx-auto grid max-w-6xl gap-8 px-5 lg:grid-cols-[1fr_340px]">
        <div>
          <div className="label mb-2">Found a nation · step {step + 1} of {STEPS.length}</div>
          <div className="mb-8 flex gap-1">
            {STEPS.map((s, i) => (
              <button
                key={s}
                onClick={() => i < step && setStep(i)}
                className={`h-1 flex-1 rounded-full transition-all ${i < step ? "bg-gold" : i === step ? "bg-gold-bright" : "bg-white/10"}`}
                aria-label={s}
              />
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.3 }}>
              {step === 0 && (
                <Step title="Name your nation" sub="The name is permanent and unique across the Atlas (case-insensitive).">
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="Pepeland" className={input} />
                  <Availability error={nameErr} loading={nameAvail.isFetching || dName !== name.trim()} available={nameAvail.data} label="name" show={Boolean(name)} />
                </Step>
              )}
              {step === 1 && (
                <Step title="Choose a ticker" sub="Your nation's currency symbol. Unique, uppercase.">
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg text-faint">$</span>
                    <input autoFocus value={ticker} onChange={(e) => setTicker(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} maxLength={10} placeholder="PEPE" className={`${input} pl-9 font-mono`} />
                  </div>
                  <Availability error={tickerErr} loading={tickerAvail.isFetching || dTicker !== ticker} available={tickerAvail.data} label="ticker" show={Boolean(ticker)} />
                </Step>
              )}
              {step === 2 && (
                <Step title="Describe your nation" sub="Stored on-chain in the founding event. Up to 280 characters.">
                  <textarea autoFocus value={description} onChange={(e) => setDescription(e.target.value.slice(0, 280))} rows={4} placeholder="A swamp republic of frogs and memes." className={`${input} text-base`} />
                  <div className="mt-2 text-right font-mono text-[11px] text-faint">{description.length}/280</div>
                </Step>
              )}
              {step === 3 && (
                <Step title="Choose a theme" sub="Sets your nation's palette and starting symbol.">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {THEMES.map((th) => (
                      <button
                        key={th.id}
                        onClick={() => setTheme(th.id)}
                        className={`relative overflow-hidden rounded-xl border p-4 text-left transition ${theme === th.id ? "border-gold/60" : "border-line hover:border-line-strong"}`}
                        style={{ background: `linear-gradient(135deg, ${th.palette[2]}, ${th.palette[0]}22)` }}
                      >
                        <div className="flex gap-1">
                          {th.palette.map((c) => (
                            <span key={c} className="size-3 rounded-full" style={{ background: c }} />
                          ))}
                        </div>
                        <div className="mt-6 font-display text-sm text-fg">{th.name}</div>
                        {theme === th.id && <Check className="absolute right-3 top-3 size-4 text-gold" />}
                      </button>
                    ))}
                  </div>
                </Step>
              )}
              {step === 4 && (
                <Step title="Design your national symbol" sub="Design a flag from a single on-chain value, or upload your own image.">
                  <div className="space-y-5">
                    <EmblemUpload value={imageUrl} onChange={setImageUrl} />
                    <EmblemEditor
                      value={emblem}
                      onChange={(v) => {
                        setCustomEmblem(v);
                      }}
                    />
                  </div>
                </Step>
              )}
              {step === 5 && (
                <Step title="Token parameters" sub="Fixed supply, minted once. No minting, no owner, no taxes.">
                  <div className="space-y-6">
                    <div>
                      <div className="label mb-2">Total supply</div>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {SUPPLIES.map((s) => (
                          <button key={s.label} onClick={() => setSupply(s.value)} className={`rounded-lg border py-2 font-mono text-sm ${supply === s.value ? "border-gold/50 bg-gold/10 text-gold-bright" : "border-line text-dim"}`}>
                            {s.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 flex justify-between">
                        <span className="label">Founder allocation</span>
                        <span className="font-mono text-sm text-fg">{founderBps / 100}%</span>
                      </div>
                      <input type="range" min={0} max={500} step={25} value={founderBps} onChange={(e) => setFounderBps(Number(e.target.value))} className="w-full accent-[#d6b26e]" />
                      <p className="mt-1 text-xs text-faint">Vests linearly over 30 days and is shown publicly on your nation page. It comes out of the curve allocation and can be claimed only after the nation graduates to Uniswap, so it can never be sold back into the bonding curve.</p>
                    </div>
                    <div>
                      <div className="label mb-2">Your initial buy (optional, $WIF)</div>
                      <input value={initialBuy} onChange={(e) => setInitialBuy(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0.0" inputMode="decimal" className={`${input} font-mono text-base`} />
                      {initialBuyWei === null && <p className="mt-1 text-xs text-warn">Enter a valid amount.</p>}
                      {buyPreview && (
                        <p className={`mt-2 text-xs ${buyPreview.tooLarge ? "text-warn" : "text-dim"}`}>
                          ≈ {formatCompact(Number(formatEther(buyPreview.tokensOut)))} ${ticker || "TICKER"} ({buyPreview.share.toFixed(2)}% of supply) at the opening price, before
                          1% fee. {buyPreview.tooLarge ? "The founding buy is capped at 10% of supply." : "Bought in the same transaction, at the same price anyone would pay."}
                        </p>
                      )}
                    </div>
                    {milestones && (
                      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
                        {[
                          ["Sold on curve", `${formatCompact(Number(formatEther(milestones.curve.curveSupply)))} (${(Number((milestones.curve.curveSupply * 1000n) / totalSupplyWei) / 10).toFixed(1)}%)`],
                          ["Reserved for LP", `${formatCompact(Number(formatEther(milestones.curve.lpReserve)))} (20%)`],
                          ["Opening market cap", wif(milestones.openingMarketCapWei)],
                          ["Graduates at", wif(milestones.graduationMarketCapWei)],
                        ].map(([k, v]) => (
                          <div key={k} className="bg-panel/90 px-4 py-3">
                            <div className="label mb-1">{k}</div>
                            <div className="font-mono text-sm text-fg">{v}</div>
                          </div>
                        ))}
                      </div>
                    )}
                    {gradWif.data !== undefined && (
                      <p className="text-xs leading-relaxed text-faint">
                        When the curve raises {wif(gradWif.data)}, the raised $WIF and the 20% LP reserve are deposited into a nation/WIF Uniswap V2 pool and the
                        LP tokens are burned — liquidity is locked forever. The curve&apos;s final price equals the pool&apos;s opening price.
                      </p>
                    )}
                  </div>
                </Step>
              )}
              {step === 6 && (
                <Step title="Review your nation" sub="Everything below is written permanently on-chain.">
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 rounded-xl border border-line p-4">
                      <Flag emblem={emblem} image={imageUrl} size={72} glow />
                      <div>
                        <div className="font-display text-2xl uppercase text-fg">{name}</div>
                        <div className="font-mono text-sm text-dim">
                          ${ticker} · {t.name} · {formatCompact(Number(supply))} supply
                        </div>
                      </div>
                    </div>
                    {description && <p className="text-sm text-dim">{description}</p>}
                    <div className="rounded-xl border border-line">
                      {[
                        ["Total supply", `${formatCompact(Number(supply))} (fixed, minted once to the launchpad)`],
                        ["Founder allocation", `${founderBps / 100}% · 30-day vesting · claimable after graduation`],
                        ["Symbol", imageUrl ? "Uploaded image (flag colors used on the map)" : "Generated flag"],
                        ["Initial buy", initialBuyWei ? wif(initialBuyWei) : "None"],
                        ["Founding fee", `${wif(fee)} · burned forever`],
                        ["Trade fee on the curve", "1% in $WIF (0.5% to your nation's treasury · 0.25% burned · 0.25% to the protocol)"],
                        ["After graduation", "Uniswap V2 · LP burned · no AtlasPad fee"],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4 border-b border-line px-4 py-2.5 text-sm last:border-0">
                          <span className="text-faint">{k}</span>
                          <span className="text-right text-dim">{v}</span>
                        </div>
                      ))}
                    </div>
                    <div className="rounded-xl border border-up/25 bg-up/[0.05] p-4">
                      <div className="mb-2 flex items-center gap-2 text-sm text-up">
                        <ShieldCheck className="size-4" /> Contract permissions
                      </div>
                      <ul className="space-y-1 text-xs leading-relaxed text-dim">
                        <li>• No mint function: supply can never increase.</li>
                        <li>• No owner, pause, blacklist, transfer tax or upgrade path — for you or for AtlasPad.</li>
                        <li>• The launchpad holds unsold tokens and can only sell them on the curve or seed the locked pool.</li>
                        <li>• Before graduation, tokens can&apos;t be sent to the Uniswap pair (prevents pool manipulation).</li>
                        <li>• Your treasury is controlled only by your citizens&apos; on-chain votes.</li>
                      </ul>
                    </div>
                  </div>
                </Step>
              )}
              {step === 7 && (
                <Step title="Launch" sub="Final check before your wallet asks for confirmation.">
                  <div className="space-y-4">
                    <div className="rounded-xl border border-line">
                      {[
                        ["Network", `${network.chain.name} · chain ${network.chain.id}`],
                        ["Action", `Found ${name} ($${ticker}) on AtlasPad`],
                        ["Founding fee (burned)", wif(fee)],
                        ["Initial buy", initialBuyWei ? wif(initialBuyWei) : "None"],
                        ["Total $WIF", wif(wifTotal)],
                        ["Your $WIF balance", wifBalance.data !== undefined ? wif(wifBalance.data) : "—"],
                        ["$WIF approval", wifTotal === 0n ? "Not needed" : needsApproval ? "Required (one transaction)" : "Done"],
                        [
                          "Estimated network fee",
                          needsApproval ? "Shown after approval" : tx.phase === "preparing" ? "Simulating…" : tx.gasWei !== null ? `${Number(formatEther(tx.gasWei)).toPrecision(3)} ETH (gas)` : "—",
                        ],
                      ].map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-4 border-b border-line px-4 py-2.5 text-sm last:border-0">
                          <span className="text-faint">{k}</span>
                          <span className="text-right text-fg">{v}</span>
                        </div>
                      ))}
                    </div>
                    {tx.phase === "failed" && tx.error && (
                      <div className="rounded-lg border border-down/30 bg-down/10 px-3 py-2.5 text-xs text-down">
                        <div className="font-medium">{tx.error.title}</div>
                        <div className="mt-1">{tx.error.message}</div>
                      </div>
                    )}
                    <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-warn/30 bg-warn/[0.06] px-4 py-3 text-xs leading-relaxed text-warn">
                      <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 accent-[#ffb547]" />
                      I understand founding is irreversible: the name, ticker, supply and allocation are permanent, fees and the initial buy are spent on-chain, and
                      tokens can lose value. The founding fee in $WIF is burned.
                    </label>
                  </div>
                </Step>
              )}
            </motion.div>
          </AnimatePresence>

          <div className="mt-10 flex items-center justify-between">
            <Button variant="ghost" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}>
              <ArrowLeft className="size-4" /> Back
            </Button>
            {step < 7 ? (
              <Button variant="primary" onClick={() => setStep(step + 1)} disabled={!canNext}>
                Continue <ArrowRight className="size-4" />
              </Button>
            ) : !isConnected ? (
              <Button variant="primary" size="lg" onClick={() => setWalletOpen(true)}>
                Connect wallet
              </Button>
            ) : notEnoughWif ? (
              <a href={getWifUrl} target="_blank" rel="noreferrer">
                <Button variant="primary" size="lg">
                  Not enough $WIF · Get $WIF <ExternalLink className="size-4" />
                </Button>
              </a>
            ) : needsApproval ? (
              <Button variant="primary" size="lg" onClick={approve} disabled={!ack || tx.busy}>
                {tx.busy ? <Loader2 className="size-4 animate-spin" /> : <Flame className="size-4" />} Approve {wif(wifTotal)}
              </Button>
            ) : (
              <Button variant="primary" size="lg" onClick={launch} disabled={!ack || tx.gasWei === null || tx.busy}>
                Found {name || "nation"}
              </Button>
            )}
          </div>
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-24 space-y-4">
            <div className="panel overflow-hidden">
              <div className="relative grid h-56 place-items-center" style={{ background: `radial-gradient(circle at 50% 60%, ${t.palette[0]}33, transparent 70%)` }}>
                <motion.div key={`${emblem}-${imageUrl ?? ""}`} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="animate-float">
                  <Flag emblem={emblem} image={imageUrl} size={150} glow />
                </motion.div>
              </div>
              <div className="border-t border-line p-4">
                <div className="truncate font-display text-lg uppercase tracking-wide text-fg">{name || "Your nation"}</div>
                <div className="font-mono text-xs text-faint">${ticker || "TICKER"} · {t.name}</div>
                {description && <p className="mt-2 line-clamp-3 text-xs text-dim">{description}</p>}
              </div>
            </div>
            <p className="text-[11px] leading-relaxed text-faint">Founding creates a real token on {network.chain.name}. Nothing is simulated. AtlasPad never promises returns; nations can fail.</p>
          </div>
        </aside>
      </div>

      <FoundingSequence
        open={sequence}
        phase={tx.phase}
        name={name}
        ticker={ticker}
        emblem={emblem}
        image={imageUrl}
        hash={tx.hash}
        nationId={nationId}
        error={tx.error?.message ?? null}
        onClose={() => {
          setSequence(false);
          if (tx.phase !== "confirmed") tx.reset();
        }}
      />
    </div>
  );
}

function Step({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div>
      <h1 className="font-display text-2xl font-medium text-fg sm:text-3xl">{title}</h1>
      <p className="mb-6 mt-2 text-sm text-dim">{sub}</p>
      {children}
    </div>
  );
}

function Availability({ error, loading, available, label, show }: { error: string | null; loading: boolean; available: boolean | undefined; label: string; show: boolean }) {
  if (!show) return null;
  return (
    <div className="mt-2 flex items-center gap-1.5 text-xs">
      {error ? (
        <span className="flex items-center gap-1.5 text-warn">
          <X className="size-3.5" /> {error}
        </span>
      ) : loading ? (
        <span className="flex items-center gap-1.5 text-faint">
          <Loader2 className="size-3.5 animate-spin" /> Checking on-chain…
        </span>
      ) : available ? (
        <span className="flex items-center gap-1.5 text-up">
          <Check className="size-3.5" /> This {label} is available
        </span>
      ) : available === false ? (
        <span className="flex items-center gap-1.5 text-down">
          <X className="size-3.5" /> This {label} is already taken
        </span>
      ) : (
        <span className="text-faint">Availability unknown</span>
      )}
    </div>
  );
}

