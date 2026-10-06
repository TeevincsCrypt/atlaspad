"use client";
import { useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { NationSummary, NewsItem, RealtimeMessage, TradeDTO, WorldResponse } from "@atlaspad/shared";
import { queryKeys, type NationDetail } from "./api";
import { effects } from "./effects";
import { publicEnv } from "./env";
import { playSound } from "./sound";
import { useUi } from "./store";

const CINEMATIC_TYPES = new Set(["GOLDEN_AGE", "ECONOMIC_CRISIS", "WAR_DECLARED", "WAR_ENDED"]);
const MAX_CINEMATIC_AGE = 15 * 60;

function applyNation(qc: QueryClient, nation: NationSummary) {
  qc.setQueryData<WorldResponse>(queryKeys.world, (w) => {
    if (!w) return w;
    const exists = w.nations.some((n) => n.id === nation.id);
    return { ...w, nations: exists ? w.nations.map((n) => (n.id === nation.id ? nation : n)) : [...w.nations, nation] };
  });
  qc.setQueryData<NationDetail>(queryKeys.nation(nation.id), (d) => (d ? { ...d, nation } : d));
}

function applyNews(qc: QueryClient, item: NewsItem) {
  for (const q of qc.getQueryCache().findAll({ queryKey: ["news"] })) {
    const [, nationId, severity] = q.queryKey as [string, number | null, string | null];
    if (nationId !== null && item.nationId !== nationId && item.targetNationId !== nationId) continue;
    if (severity === "major" && item.severity !== "major") continue;
    if (severity === "notable" && item.severity === "minor") continue;
    qc.setQueryData<NewsItem[]>(q.queryKey, (list) => (list && !list.some((n) => n.id === item.id) ? [item, ...list].slice(0, 200) : list));
  }
  // Structural changes (wars, alliances, buildings) are reflected in these views.
  if (["WAR_DECLARED", "WAR_ENDED", "ALLIANCE_FORMED", "ALLIANCE_JOINED", "ALLIANCE_LEFT", "BUILDING_COMPLETED", "BUILDING_STARTED", "FOUNDED"].includes(item.type)) {
    void qc.invalidateQueries({ queryKey: queryKeys.world });
    if (item.nationId) void qc.invalidateQueries({ queryKey: queryKeys.nation(item.nationId) });
    if (item.targetNationId) void qc.invalidateQueries({ queryKey: queryKeys.nation(item.targetNationId) });
  }
  if (item.nationId) void qc.invalidateQueries({ queryKey: queryKeys.proposals(item.nationId) });
  const fresh = Date.now() / 1000 - item.createdAt < MAX_CINEMATIC_AGE;
  if (fresh && item.nationId && CINEMATIC_TYPES.has(item.type)) {
    effects.emit({
      kind: "cinematic",
      type: item.type as "GOLDEN_AGE",
      nationId: item.nationId,
      targetId: item.targetNationId,
      title: item.title,
      body: item.body,
    });
  }
  if (fresh) {
    if (item.type === "GOLDEN_AGE") playSound("goldenAge");
    else if (item.type === "ECONOMIC_CRISIS") playSound("crisis");
    else if (item.type === "WAR_DECLARED") playSound("war");
    else if (item.type === "ECONOMIC_BOOM") playSound("boom");
    else if (item.type === "FOUNDED") playSound("founded");
  }
}

function applyTrade(qc: QueryClient, nationId: number, trade: TradeDTO) {
  qc.setQueryData<TradeDTO[]>(queryKeys.trades(nationId), (list) =>
    list && !list.some((t) => t.txHash === trade.txHash && t.logIndex === trade.logIndex) ? [trade, ...list].slice(0, 100) : list,
  );
  effects.emit({ kind: "trade", nationId, side: trade.side, magnitude: trade.ethAmount });
  void qc.invalidateQueries({ queryKey: ["candles", nationId] });
}

/** Connects to the indexer's Server-Sent Events stream and keeps React Query caches live. */
export function useRealtimeBridge() {
  const qc = useQueryClient();
  const setRealtime = useUi((s) => s.setRealtime);
  const setBlock = useUi((s) => s.setLastHeartbeatBlock);

  useEffect(() => {
    if (!publicEnv.realtimeUrl) {
      setRealtime("disabled");
      return;
    }
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let closed = false;
    const connect = () => {
      setRealtime("connecting");
      source = new EventSource(`${publicEnv.realtimeUrl}/stream`);
      source.onopen = () => {
        attempts = 0;
        setRealtime("live");
      };
      source.onmessage = (ev) => {
        let msg: RealtimeMessage;
        try {
          msg = JSON.parse(ev.data) as RealtimeMessage;
        } catch {
          return;
        }
        switch (msg.kind) {
          case "nation":
            applyNation(qc, msg.nation);
            break;
          case "ranks":
            qc.setQueryData<WorldResponse>(queryKeys.world, (w) =>
              w
                ? {
                    ...w,
                    nations: w.nations.map((n) => {
                      const r = msg.ranks.find((x) => x.id === n.id);
                      return r ? { ...n, rank: r.rank, previousRank: r.previousRank } : n;
                    }),
                  }
                : w,
            );
            break;
          case "trade":
            applyTrade(qc, msg.nationId, msg.trade);
            break;
          case "news":
            applyNews(qc, msg.item);
            break;
          case "proposal":
            void qc.invalidateQueries({ queryKey: queryKeys.proposals(msg.nationId) });
            void qc.invalidateQueries({ queryKey: queryKeys.proposal(msg.proposalId) });
            break;
          case "heartbeat":
            setBlock(msg.block);
            break;
        }
      };
      source.onerror = () => {
        source?.close();
        if (closed) return;
        setRealtime("offline");
        attempts++;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts));
      };
    };
    connect();
    return () => {
      closed = true;
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [qc, setRealtime, setBlock]);
}
