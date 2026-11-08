"use client";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type {
  AllianceSummary,
  CandleDTO,
  CitizenProfile,
  HolderDTO,
  NationSummary,
  NationSocials,
  NewsItem,
  PositionDTO,
  ProposalDTO,
  TradeDTO,
  TreasuryTxDTO,
  WarSummary,
  WorldResponse,
  BuildingDTO,
  AchievementDTO,
} from "@atlaspad/shared";
import { useUi } from "./store";

export class ApiError extends Error {
  constructor(
    public status: number,
    public reason: string,
  ) {
    super(reason);
  }
}

export async function api<T>(path: string): Promise<T> {
  let res: Response;
  try {
    // Never wait forever: a stuck request becomes an error the page can show (and retry) instead of an endless skeleton.
    res = await fetch(path, { cache: "no-store", signal: AbortSignal.timeout(20_000) });
  } catch (err) {
    throw new ApiError(0, (err as Error)?.name === "TimeoutError" ? "The server took too long to answer." : "Network error.");
  }
  if (!res.ok) {
    let reason = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { reason?: string; error?: string };
      const detail = (body as { detail?: string | null }).detail;
      reason = `${body.reason ?? body.error ?? reason}${detail ? ` (${detail})` : ""}`;
    } catch {
      /* ignore */
    }
    throw new ApiError(res.status, reason);
  }
  return (await res.json()) as T;
}

/** Fallback polling only when the realtime stream is not available. */
function usePoll(ms: number): number | false {
  const realtime = useUi((s) => s.realtime);
  return realtime === "live" ? false : ms;
}

export const queryKeys = {
  world: ["world"] as const,
  news: (nation?: number, severity?: string) => ["news", nation ?? null, severity ?? null] as const,
  nation: (id: number) => ["nation", id] as const,
  candles: (id: number, interval: number) => ["candles", id, interval] as const,
  series: (id: number, days: number) => ["series", id, days] as const,
  trades: (id: number) => ["trades", id] as const,
  holders: (id: number) => ["holders", id] as const,
  proposals: (id: number) => ["proposals", id] as const,
  proposal: (id: number) => ["proposal", id] as const,
  treasury: (id: number) => ["treasury", id] as const,
  war: (id: number) => ["war", id] as const,
  alliance: (id: number) => ["alliance", id] as const,
  citizen: (address: string) => ["citizen", address.toLowerCase()] as const,
  status: ["status"] as const,
  searchIndex: ["search-index"] as const,
  topCitizens: ["top-citizens"] as const,
};

export function useWorld() {
  const poll = usePoll(30_000);
  return useQuery({ queryKey: queryKeys.world, queryFn: () => api<WorldResponse>("/api/world"), refetchInterval: poll, staleTime: 5_000 });
}

export function useNews(opts: { nationId?: number; severity?: "minor" | "notable" | "major"; limit?: number } = {}) {
  const poll = usePoll(30_000);
  const qs = new URLSearchParams();
  if (opts.nationId) qs.set("nation", String(opts.nationId));
  if (opts.severity) qs.set("severity", opts.severity);
  qs.set("limit", String(opts.limit ?? 60));
  return useQuery({
    queryKey: queryKeys.news(opts.nationId, opts.severity),
    queryFn: () => api<NewsItem[]>(`/api/news?${qs}`),
    refetchInterval: poll,
  });
}

export interface NationDetail {
  nation: NationSummary;
  buildings: BuildingDTO[];
  achievements: AchievementDTO[];
  wars: WarSummary[];
  alliance: { id: number; name: string; leaderId: number; memberIds: number[] } | null;
  invites: { allianceId: number; allianceName: string; invitedAt: number }[];
  resourceLedger: { at: number; influence: number; culture: number; energy: number; materials: number; reason: string }[];
  holders: number;
  founderAllocation: string;
  curve: {
    curveSupply: string;
    curveTokensRemaining: string;
    realWif: number;
    virtualWif: string;
    virtualTokens: string;
    lpReserve: string;
    graduationWif: number | null;
  };
  wifUsd: number | null;
  socials?: NationSocials | null;
}

export function useNation(id: number) {
  const poll = usePoll(20_000);
  return useQuery({
    queryKey: queryKeys.nation(id),
    queryFn: () => api<NationDetail>(`/api/nations/${id}`),
    refetchInterval: poll,
    enabled: id > 0,
    // Show a problem quickly (with its reason) instead of retrying silently behind the skeleton.
    retry: (n, err) => n < 1 && !(err instanceof ApiError && err.status === 404),
    retryDelay: 1500,
  });
}

export function useCandles(id: number, interval: number) {
  return useQuery({
    queryKey: queryKeys.candles(id, interval),
    queryFn: () => api<CandleDTO[]>(`/api/nations/${id}/candles?interval=${interval}`),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });
}

export interface SeriesPoint {
  time: number;
  priceWif: number | null;
  marketCapWif: number | null;
  liquidityWif: number | null;
  volumeWif: number;
  citizens: number;
  treasuryWif: number;
  civilizationScore: number;
  economicPower: number;
}

export function useSeries(id: number, days = 30) {
  return useQuery({ queryKey: queryKeys.series(id, days), queryFn: () => api<SeriesPoint[]>(`/api/nations/${id}/series?days=${days}`), staleTime: 60_000 });
}

export function useTrades(id: number) {
  const poll = usePoll(20_000);
  return useQuery({ queryKey: queryKeys.trades(id), queryFn: () => api<TradeDTO[]>(`/api/nations/${id}/trades?limit=50`), refetchInterval: poll });
}

export function useHolders(id: number) {
  return useQuery({
    queryKey: queryKeys.holders(id),
    queryFn: () => api<{ holders: HolderDTO[]; total: number; citizens: number; top10Share: number }>(`/api/nations/${id}/holders`),
    staleTime: 15_000,
  });
}

export function useProposals(nationId: number) {
  const poll = usePoll(20_000);
  return useQuery({ queryKey: queryKeys.proposals(nationId), queryFn: () => api<ProposalDTO[]>(`/api/nations/${nationId}/proposals`), refetchInterval: poll });
}

export function useProposal(id: number) {
  return useQuery({
    queryKey: queryKeys.proposal(id),
    queryFn: () =>
      api<{ proposal: ProposalDTO; votes: { voter: string; support: number; weight: string; reason: string; txHash: string; timestamp: number }[] }>(
        `/api/proposals/${id}`,
      ),
    enabled: id > 0,
  });
}

export function useTreasury(id: number) {
  return useQuery({
    queryKey: queryKeys.treasury(id),
    queryFn: () => api<{ balanceWif: number; receivedWif: number; releasedWif: number; txs: TreasuryTxDTO[] }>(`/api/nations/${id}/treasury`),
    staleTime: 10_000,
  });
}

export interface WarDetailResponse {
  war: {
    id: number;
    attackerId: number;
    defenderId: number;
    declaredAt: number;
    endsAt: number;
    status: string;
    winnerId: number | null;
    attackerStart: { citizens: number; marketCapWif: number };
    defenderStart: { citizens: number; marketCapWif: number };
    attackerScore: Record<string, number> | null;
    defenderScore: Record<string, number> | null;
    spoils: number | null;
    txHash: string;
    reason: string | null;
  };
  attacker: NationSummary;
  defender: NationSummary;
  projection: { attacker: Record<string, number>; defender: Record<string, number>; leader: number } | null;
  news: NewsItem[];
}

export function useWar(id: number) {
  const poll = usePoll(30_000);
  return useQuery({ queryKey: queryKeys.war(id), queryFn: () => api<WarDetailResponse>(`/api/wars/${id}`), refetchInterval: poll });
}

export interface AllianceDetailResponse {
  alliance: { id: number; name: string; leaderId: number; createdAt: number; active: boolean; dissolvedAt: number | null };
  members: { nationId: number; joinedAt: number; leftAt: number | null }[];
  invites: { nationId: number; invitedAt: number }[];
  nations: NationSummary[];
}

export function useAlliance(id: number) {
  return useQuery({ queryKey: queryKeys.alliance(id), queryFn: () => api<AllianceDetailResponse>(`/api/alliances/${id}`) });
}

export function useCitizen(address: string | undefined) {
  return useQuery({
    queryKey: queryKeys.citizen(address ?? ""),
    queryFn: () => api<{ profile: CitizenProfile; trades: (TradeDTO & { nationId: number })[]; proposals: ProposalDTO[]; positions?: PositionDTO[] }>(`/api/citizens/${address}`),
    enabled: Boolean(address),
    staleTime: 10_000,
  });
}

export function useTopCitizens() {
  return useQuery({
    queryKey: queryKeys.topCitizens,
    queryFn: () => api<{ address: string; xp: number; rank: number; title: string }[]>("/api/leaderboard/citizens"),
    staleTime: 30_000,
  });
}

export interface StatusResponse {
  chainId: number;
  chainName: string;
  explorer: string | null;
  contracts: { launchpad: string; governor: string; treasury: string } | null;
  deployed: boolean;
  configError: string | null;
  database: "ok" | "not_configured" | "unavailable";
  indexer: { lastIndexedBlock: number | null; lastIndexedAt: number | null; chainHeadBlock: number | null; lagBlocks: number | null } | null;
}

export function useStatus() {
  return useQuery({ queryKey: queryKeys.status, queryFn: () => api<StatusResponse>("/api/status"), refetchInterval: 60_000 });
}

export interface SearchIndex {
  nations: { id: number; name: string; ticker: string; token: string; founder: string; emblem: string; metadataUri: string }[];
  alliances: { id: number; name: string }[];
}

export function useSearchIndex(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.searchIndex, queryFn: () => api<SearchIndex>("/api/search-index"), enabled, staleTime: 30_000 });
}

export type { AllianceSummary };
