/**
 * Read queries shared by the web API and the indexer's realtime stream. Raw SQL (postgres.js) so that
 * both runtimes produce byte-identical DTOs.
 */
import type { Sql, TransactionSql } from "postgres";
import type {
  AllianceSummary,
  IndexerHealth,
  NationSummary,
  NewsItem,
  WarSummary,
} from "@atlaspad/shared";

type Db = Sql | TransactionSql;
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function nationSummaries(sql: Db, opts: { ids?: number[] } = {}): Promise<NationSummary[]> {
  const filter = opts.ids ? sql`WHERE n.id = ANY(${opts.ids})` : sql``;
  const rows = await sql`
    SELECT n.*, g.*,
      COALESCE((SELECT array_agg(b.type ORDER BY b.type) FROM game_buildings b WHERE b.nation_id = n.id AND b.status = 'complete'), '{}') AS built,
      (SELECT count(*) FROM game_wars w WHERE w.status = 'active' AND (w.attacker_id = n.id OR w.defender_id = n.id)) AS active_wars
    FROM nations n
    LEFT JOIN game_nations g ON g.nation_id = n.id
    ${filter}
    ORDER BY n.id`;
  return rows.map((r) => toSummary(r));
}

export function toSummary(r: Record<string, unknown>): NationSummary {
  const curveSupply = BigInt((r.curve_supply as string) ?? "0");
  const remaining = BigInt((r.curve_tokens_remaining as string) ?? "0");
  const graduated = Boolean(r.graduated);
  const progress = graduated ? 1 : curveSupply > 0n ? Number(curveSupply - remaining) / Number(curveSupply) : null;
  return {
    id: Number(r.id),
    name: r.name as string,
    ticker: r.ticker as string,
    token: r.token as string,
    pair: r.pair as string,
    founder: r.founder as string,
    theme: Number(r.theme),
    emblem: String(r.emblem),
    metadataUri: (r.metadata_uri as string) ?? "",
    description: (r.description as string) ?? "",
    createdAt: Number(r.created_at),
    graduated,
    graduatedAt: n(r.graduated_at),
    totalSupply: String(r.total_supply),
    priceEth: n(r.price_eth),
    marketCapEth: n(r.market_cap_eth),
    liquidityEth: n(r.liquidity_eth),
    volume24hEth: n(r.volume_24h_eth),
    trades24h: Number(r.trades_24h ?? 0),
    change1h: n(r.change_1h),
    change24h: n(r.change_24h),
    athMarketCapEth: n(r.ath_market_cap_eth),
    curveProgress: progress,
    treasuryEth: Number(r.treasury_eth ?? 0),
    citizens: Number(r.citizens ?? 0),
    citizens24hAgo: n(r.citizens_24h_ago),
    economicPower: Number(r.economic_power ?? 0),
    militaryPower: Number(r.military_power ?? 0),
    defensivePower: Number(r.defensive_power ?? 0),
    influenceScore: Number(r.influence_score ?? 0),
    populationScore: Number(r.population_score ?? 0),
    developmentScore: Number(r.development_score ?? 0),
    civilizationScore: Number(r.civilization_score ?? 0),
    tier: Number(r.tier ?? 0),
    territoryCells: Number(r.territory_cells ?? 6),
    resources: {
      influence: Number(r.influence ?? 0),
      culture: Number(r.culture ?? 0),
      energy: Number(r.energy ?? 0),
      materials: Number(r.materials ?? 0),
    },
    rank: n(r.rank),
    previousRank: n(r.previous_rank),
    statuses: ((r.statuses as { type: string; until: number }[]) ?? []).filter((s) => s.until > Date.now() / 1000),
    activeWars: Number(r.active_wars ?? 0),
    allianceId: n(r.alliance_id),
    buildings: ((r.built as number[]) ?? []).map(Number),
    warWins: Number(r.war_wins ?? 0),
    warLosses: Number(r.war_losses ?? 0),
  };
}

export async function warSummaries(sql: Db, opts: { status?: "active" | "ended"; nationId?: number; limit?: number } = {}): Promise<WarSummary[]> {
  const rows = await sql`
    SELECT w.* FROM game_wars w
    WHERE (${opts.status ?? null}::text IS NULL OR w.status = ${opts.status ?? null})
      AND (${opts.nationId ?? null}::int IS NULL OR w.attacker_id = ${opts.nationId ?? null} OR w.defender_id = ${opts.nationId ?? null})
    ORDER BY w.declared_at DESC
    LIMIT ${opts.limit ?? 200}`;
  return rows.map(toWar);
}

export function toWar(r: Record<string, unknown>): WarSummary {
  const as = r.attacker_score as { total?: number } | null;
  const ds = r.defender_score as { total?: number } | null;
  return {
    id: Number(r.id),
    attackerId: Number(r.attacker_id),
    defenderId: Number(r.defender_id),
    declaredAt: Number(r.declared_at),
    endsAt: Number(r.ends_at),
    status: r.status as WarSummary["status"],
    winnerId: n(r.winner_id),
    attackerScore: as?.total ?? null,
    defenderScore: ds?.total ?? null,
    proposalId: Number(r.id),
    txHash: r.tx_hash as string,
  };
}

export async function allianceSummaries(sql: Db, opts: { activeOnly?: boolean } = {}): Promise<AllianceSummary[]> {
  const rows = await sql`
    SELECT a.*, COALESCE((
      SELECT array_agg(m.nation_id ORDER BY m.joined_at) FROM game_alliance_members m
      WHERE m.alliance_id = a.id AND m.left_at IS NULL), '{}') AS members
    FROM game_alliances a
    WHERE (${opts.activeOnly ?? false} = false OR a.active)
    ORDER BY a.created_at`;
  return rows.map((r) => ({
    id: Number(r.id),
    name: r.name as string,
    leaderId: Number(r.leader_id),
    memberIds: ((r.members as number[]) ?? []).map(Number),
    createdAt: Number(r.created_at),
    active: Boolean(r.active),
  }));
}

export async function newsItems(
  sql: Db,
  opts: { beforeId?: number; limit?: number; nationId?: number; minSeverity?: "minor" | "notable" | "major" } = {},
): Promise<NewsItem[]> {
  const severities =
    opts.minSeverity === "major" ? ["major"] : opts.minSeverity === "notable" ? ["notable", "major"] : ["minor", "notable", "major"];
  const rows = await sql`
    SELECT e.*, n.name AS nation_name, n.ticker AS nation_ticker, t.name AS target_name
    FROM game_events e
    LEFT JOIN nations n ON n.id = e.nation_id
    LEFT JOIN nations t ON t.id = e.target_nation_id
    WHERE (${opts.beforeId ?? null}::int IS NULL OR e.id < ${opts.beforeId ?? null})
      AND (${opts.nationId ?? null}::int IS NULL OR e.nation_id = ${opts.nationId ?? null} OR e.target_nation_id = ${opts.nationId ?? null})
      AND e.severity = ANY(${severities})
    ORDER BY e.id DESC
    LIMIT ${Math.min(opts.limit ?? 50, 200)}`;
  return rows.map((r) => ({
    id: Number(r.id),
    type: r.type as string,
    severity: r.severity as NewsItem["severity"],
    nationId: n(r.nation_id),
    nationName: (r.nation_name as string) ?? null,
    ticker: (r.nation_ticker as string) ?? null,
    targetNationId: n(r.target_nation_id),
    targetNationName: (r.target_name as string) ?? null,
    title: r.title as string,
    body: r.body as string,
    data: (r.data as Record<string, unknown>) ?? {},
    txHash: (r.tx_hash as string) ?? null,
    createdAt: Number(r.created_at),
  }));
}

export async function indexerHealth(sql: Db): Promise<IndexerHealth & { ethUsd: number | null; gameCursor: number | null }> {
  const [s] = await sql`SELECT * FROM indexer_state WHERE id = 'main'`;
  if (!s) return { lastIndexedBlock: null, lastIndexedAt: null, chainHeadBlock: null, lagBlocks: null, ethUsd: null, gameCursor: null };
  const last = Number(s.last_block);
  const head = s.chain_head === null ? null : Number(s.chain_head);
  return {
    lastIndexedBlock: last,
    lastIndexedAt: n(s.last_block_timestamp),
    chainHeadBlock: head,
    lagBlocks: head === null ? null : Math.max(0, head - last),
    ethUsd: n(s.eth_usd),
    gameCursor: n(s.game_cursor),
  };
}
