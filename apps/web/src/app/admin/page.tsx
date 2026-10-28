"use client";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, Server, Wifi } from "lucide-react";
import { timeAgo } from "@atlaspad/shared";
import { Panel } from "@/components/ui/Panel";
import { Badge } from "@/components/ui/Badge";
import { DataUnavailable, ExplorerLink, Skeleton } from "@/components/ui/misc";

type Timed<T> = { ok: true; value: T; ms: number } | { ok: false; error: string; ms: number };
interface AdminStatus {
  network: { key: string; chainId: number; explorer: string | null; dex: Record<string, string>; contracts: Record<string, string> | null; configError: string | null };
  rpc: { head: Timed<number>; chainId: Timed<number>; chainIdMatches: boolean | null };
  database: Timed<{
    counts: Record<string, number>;
    errors: { id: number; at: string; scope: string; message: string }[];
    blocks: { number: number; hash: string; timestamp: number }[];
    health: { lastIndexedBlock: number | null; lastIndexedAt: number | null; chainHeadBlock: number | null; lagBlocks: number | null; wifUsd: number | null; gameCursor: number | null };
  }>;
  indexer: Timed<{ indexer: Record<string, unknown>; rpc: Record<string, unknown> }>;
  generatedAt: number;
}

/** Internal operations dashboard (protected by HTTP Basic auth in proxy.ts). Read-only. */
export default function AdminPage() {
  const q = useQuery({
    queryKey: ["admin-status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AdminStatus;
    },
    refetchInterval: 10_000,
  });
  if (q.isError) return <div className="mx-auto max-w-3xl px-4 pt-28"><DataUnavailable reason={(q.error as Error).message} /></div>;
  if (!q.data) return <div className="mx-auto max-w-6xl px-4 pt-28"><Skeleton className="h-96" /></div>;
  const s = q.data;
  const ok = (b: boolean) => <Badge tone={b ? "up" : "down"}>{b ? "Healthy" : "Failing"}</Badge>;
  const db = s.database.ok ? s.database.value : null;
  return (
    <div className="mx-auto max-w-7xl space-y-4 px-4 pb-24 pt-24 sm:px-6">
      <div className="flex items-end justify-between">
        <div>
          <div className="label mb-1">Internal · read-only</div>
          <h1 className="font-display text-2xl text-fg">Operations</h1>
        </div>
        <div className="font-mono text-[11px] text-faint">Updated {timeAgo(s.generatedAt)}</div>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        <Panel title="RPC" label="Chain" actions={ok(s.rpc.head.ok && s.rpc.chainIdMatches !== false)}>
          <div className="space-y-1 font-mono text-xs">
            <div className="flex items-center gap-2"><Wifi className="size-3.5 text-faint" /> Head {s.rpc.head.ok ? s.rpc.head.value : "—"}</div>
            <div>Latency {s.rpc.head.ms}ms</div>
            <div>Chain id {s.rpc.chainId.ok ? s.rpc.chainId.value : "—"} {s.rpc.chainIdMatches === false && <span className="text-down">(mismatch!)</span>}</div>
            {!s.rpc.head.ok && <div className="text-down">{s.rpc.head.error}</div>}
          </div>
        </Panel>
        <Panel title="Database" label="Postgres" actions={ok(s.database.ok)}>
          <div className="space-y-1 font-mono text-xs">
            <div className="flex items-center gap-2"><Database className="size-3.5 text-faint" /> Latency {s.database.ms}ms</div>
            {db && Object.entries(db.counts).map(([k, v]) => <div key={k}>{k.replaceAll("_", " ")}: {v}</div>)}
            {!s.database.ok && <div className="text-down">{s.database.error}</div>}
          </div>
        </Panel>
        <Panel title="Indexer" label="Sync" actions={db ? ok((db.health.lagBlocks ?? 99) < 50) : null}>
          {db ? (
            <div className="space-y-1 font-mono text-xs">
              <div className="flex items-center gap-2"><Activity className="size-3.5 text-faint" /> Block {db.health.lastIndexedBlock}</div>
              <div>Lag {db.health.lagBlocks} blocks</div>
              <div>Last block {db.health.lastIndexedAt ? timeAgo(db.health.lastIndexedAt) : "—"}</div>
              <div>Game cursor {db.health.gameCursor ? timeAgo(db.health.gameCursor) : "—"}</div>
              <div>WIF/USD {db.health.wifUsd ?? "not configured"}</div>
            </div>
          ) : (
            <p className="text-xs text-faint">Unavailable</p>
          )}
        </Panel>
        <Panel title="Indexer service" label="HTTP" actions={ok(s.indexer.ok)}>
          <div className="space-y-1 font-mono text-xs">
            <div className="flex items-center gap-2"><Server className="size-3.5 text-faint" /> {s.indexer.ok ? `${s.indexer.ms}ms` : "unreachable"}</div>
            {s.indexer.ok ? (
              Object.entries(s.indexer.value.indexer ?? {}).slice(0, 8).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)
            ) : (
              <div className="text-down">{s.indexer.error}</div>
            )}
          </div>
        </Panel>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Contracts" label={`${s.network.key} · chain ${s.network.chainId}`}>
          <div className="space-y-1.5 font-mono text-xs">
            {s.network.configError && <div className="text-down">Config error: {s.network.configError}</div>}
            {Object.entries({ ...(s.network.contracts ?? {}), ...s.network.dex }).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3">
                <span className="text-faint">{k}</span>
                <ExplorerLink kind="address" value={v} />
              </div>
            ))}
            {!s.network.contracts && <div className="text-warn">AtlasPad contracts not configured.</div>}
          </div>
        </Panel>
        <Panel title="Latest indexed blocks">
          <div className="space-y-1 font-mono text-[11px]">
            {(db?.blocks ?? []).map((b) => (
              <div key={b.number} className="flex justify-between gap-3">
                <span className="text-fg">{b.number}</span>
                <span className="truncate text-faint">{b.hash}</span>
                <span className="text-faint">{timeAgo(b.timestamp)}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
      <Panel title="Failed jobs & errors" label="indexer_errors">
        {(db?.errors ?? []).length === 0 ? (
          <p className="text-xs text-up">No errors recorded.</p>
        ) : (
          <div className="space-y-1.5 font-mono text-[11px]">
            {db!.errors.map((e) => (
              <div key={e.id} className="flex gap-3">
                <span className="text-faint">{new Date(e.at).toISOString()}</span>
                <span className="text-warn">{e.scope}</span>
                <span className="text-dim">{e.message}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
