"use client";
import Link from "next/link";
import { useAccount } from "wagmi";
import { formatCompact, formatWif, formatInt, TIERS } from "@atlaspad/shared";
import { useCitizen, useWorld } from "@/lib/api";
import { useUi } from "@/lib/store";
import { Flag } from "@/components/emblem/Flag";
import { ChangePill } from "@/components/ui/ChangePill";
import { Button } from "@/components/ui/Button";
import { DataUnavailable, EmptyState, Skeleton } from "@/components/ui/misc";
import { useHydrated } from "@/lib/hooks";

export default function MyNationsPage() {
  const { address, isConnected } = useAccount();
  const setWalletOpen = useUi((s) => s.setWalletModalOpen);
  const citizen = useCitizen(address);
  const world = useWorld();
  const mounted = useHydrated();
  const byId = (id: number) => world.data?.nations.find((n) => n.id === id);

  if (!mounted) return null;
  if (!isConnected) {
    return (
      <div className="mx-auto max-w-md px-4 pt-32">
        <div className="panel p-10 text-center">
          <h1 className="font-display text-xl text-fg">My Nations</h1>
          <p className="mt-2 text-sm text-dim">Connect a wallet to see the nations you founded and the nations you&apos;re a citizen of.</p>
          <Button variant="primary" className="mt-6" onClick={() => setWalletOpen(true)}>
            Connect wallet
          </Button>
        </div>
      </div>
    );
  }
  const founded = citizen.data?.profile.foundedNationIds ?? [];
  const cits = citizen.data?.profile.citizenships ?? [];
  return (
    <div className="mx-auto max-w-6xl px-4 pb-24 pt-24 sm:px-6">
      <div className="mb-8">
        <div className="label mb-2">My nations</div>
        <h1 className="font-display text-3xl font-semibold uppercase tracking-wide text-fg">Your corner of the world</h1>
        <p className="mt-2 text-sm text-dim">What happened to your countries while you were gone?</p>
      </div>
      {citizen.isError ? (
        <DataUnavailable />
      ) : !citizen.data ? (
        <Skeleton className="h-60" />
      ) : founded.length === 0 && cits.length === 0 ? (
        <EmptyState icon="🧭" title="No nations yet" body="Found a nation or buy into one to become a citizen." action={<Link href="/discover" className="text-sm text-gold-bright">Discover nations →</Link>} />
      ) : (
        <div className="space-y-10">
          {founded.length > 0 && (
            <section>
              <h2 className="mb-3 font-display text-sm uppercase tracking-[0.18em] text-gold">Founded by you</h2>
              <div className="grid gap-3 md:grid-cols-2">
                {founded.map((id) => {
                  const n = byId(id);
                  if (!n) return null;
                  return (
                    <Link key={id} href={`/nation/${id}`} className="panel flex items-center gap-4 p-4 hover:border-line-strong">
                      <Flag emblem={n.emblem} size={56} glow />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base uppercase text-fg">{n.name}</div>
                        <div className="font-mono text-[11px] text-faint">
                          #{n.rank ?? "—"} · {TIERS[n.tier]?.name} · {formatInt(n.citizens)} citizens
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-sm text-fg">{formatWif(n.marketCapWif)}</div>
                        <ChangePill value={n.change24h} />
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}
          <section>
            <h2 className="mb-3 font-display text-sm uppercase tracking-[0.18em] text-dim">Citizenships</h2>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {cits.map((c) => {
                const n = byId(c.nationId);
                return (
                  <Link key={c.nationId} href={`/nation/${c.nationId}`} className="panel flex items-center gap-3 p-4 hover:border-line-strong">
                    <Flag emblem={c.emblem} size={40} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-fg">{c.name}</div>
                      <div className="font-mono text-[11px] text-faint">
                        {formatCompact(Number(c.balance) / 1e18)} ${c.ticker}
                      </div>
                    </div>
                    {n && <ChangePill value={n.change24h} />}
                  </Link>
                );
              })}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
