import "server-only";
import type postgres from "postgres";
import { allianceSummaries, flywheelStats, indexerHealth, nationSummaries, newsItems, warSummaries } from "@atlaspad/db/queries";
import {
  ACHIEVEMENT_BY_CODE,
  ALLIANCE,
  TITLE_ACHIEVEMENTS,
  XP,
  citizenRank,
  decodePayload,
  warScore,
  type AchievementDTO,
  type BuildingDTO,
  type CandleDTO,
  type CitizenProfile,
  type HolderDTO,
  type NationSocials,
  type NationSummary,
  type PositionDTO,
  type ProposalDTO,
  type TradeDTO,
  type TreasuryTxDTO,
  type WarSummary,
  type WorldResponse,
} from "@atlaspad/shared";
import type { Hex } from "viem";
import { network } from "../env";

type Sql = postgres.Sql;
const WAD = 1e18;
const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export async function getWorld(sql: Sql): Promise<WorldResponse> {
  const [nations, wars, alliances, health, flywheel] = await Promise.all([
    nationSummaries(sql),
    warSummaries(sql, { limit: 300 }),
    allianceSummaries(sql, { activeOnly: true }),
    indexerHealth(sql),
    flywheelStats(sql),
  ]);
  return {
    network: { chainId: network.chain.id, name: network.chain.name, deployed: network.contracts !== null },
    nations,
    flywheel,
    wars,
    alliances,
    wifUsd: health.wifUsd,
    indexer: {
      lastIndexedBlock: health.lastIndexedBlock,
      lastIndexedAt: health.lastIndexedAt,
      chainHeadBlock: health.chainHeadBlock,
      lagBlocks: health.lagBlocks,
    },
    generatedAt: Math.floor(Date.now() / 1000),
  };
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
  socials: NationSocials | null;
}

export async function getNationDetail(sql: Sql, id: number): Promise<NationDetail | null> {
  const [nation] = await nationSummaries(sql, { ids: [id] });
  if (!nation) return null;
  const [raw] = await sql`SELECT * FROM nations WHERE id = ${id}`;
  const now = await chainNow(sql);
  const [buildings, achievements, wars, allianceRow, invites, ledger, holderCount, health, socials] = await Promise.all([
    sql`SELECT * FROM game_buildings WHERE nation_id = ${id} ORDER BY started_at`,
    sql`SELECT code, unlocked_at FROM game_nation_achievements WHERE nation_id = ${id} ORDER BY unlocked_at`,
    warSummaries(sql, { nationId: id, limit: 50 }),
    nation.allianceId === null
      ? Promise.resolve([])
      : sql`SELECT a.id, a.name, a.leader_id, COALESCE((SELECT array_agg(m.nation_id ORDER BY m.joined_at) FROM game_alliance_members m WHERE m.alliance_id = a.id AND m.left_at IS NULL), '{}') AS members FROM game_alliances a WHERE a.id = ${nation.allianceId}`,
    sql`SELECT i.alliance_id, i.invited_at, a.name FROM game_alliance_invites i JOIN game_alliances a ON a.id = i.alliance_id WHERE i.nation_id = ${id} AND a.active AND i.invited_at > ${now - ALLIANCE.inviteTtlSeconds}`,
    sql`SELECT at, influence, culture, energy, materials, reason FROM game_resource_ledger WHERE nation_id = ${id} AND reason <> 'Hourly production' ORDER BY at DESC LIMIT 40`,
    sql`SELECT count(*)::int AS c FROM holders WHERE nation_id = ${id}`,
    indexerHealth(sql),
    getSocials(sql, id),
  ]);
  const a = allianceRow[0];
  return {
    nation,
    buildings: buildings.map((b) => ({
      id: Number(b.id),
      type: Number(b.type),
      status: b.status as BuildingDTO["status"],
      startedAt: Number(b.started_at),
      completesAt: Number(b.completes_at),
      completedAt: num(b.completed_at),
      proposalId: Number(b.proposal_id),
    })),
    achievements: achievements.map((r) => ({ code: r.code as string, nationId: id, unlockedAt: Number(r.unlocked_at) })),
    wars,
    alliance: a ? { id: Number(a.id), name: a.name as string, leaderId: Number(a.leader_id), memberIds: (a.members as number[]).map(Number) } : null,
    invites: invites.map((i) => ({ allianceId: Number(i.alliance_id), allianceName: i.name as string, invitedAt: Number(i.invited_at) })),
    resourceLedger: ledger.map((l) => ({
      at: Number(l.at),
      influence: Number(l.influence),
      culture: Number(l.culture),
      energy: Number(l.energy),
      materials: Number(l.materials),
      reason: l.reason as string,
    })),
    holders: Number(holderCount[0]?.c ?? 0),
    founderAllocation: String(raw!.founder_allocation),
    curve: {
      curveSupply: String(raw!.curve_supply),
      curveTokensRemaining: String(raw!.curve_tokens_remaining),
      realWif: Number(raw!.real_wif) / WAD,
      virtualWif: String(raw!.virtual_wif),
      virtualTokens: String(raw!.virtual_tokens),
      lpReserve: String(raw!.lp_reserve),
      graduationWif: raw!.graduation_wif === null ? null : Number(raw!.graduation_wif) / WAD,
    },
    wifUsd: health.wifUsd,
    socials,
  };
}

export async function getCandles(sql: Sql, id: number, interval: number): Promise<CandleDTO[]> {
  const rows = await sql`
    SELECT (timestamp / ${interval}) * ${interval} AS bucket,
      (array_agg(price_wif ORDER BY timestamp, log_index))[1] AS open,
      max(price_wif) AS high, min(price_wif) AS low,
      (array_agg(price_wif ORDER BY timestamp DESC, log_index DESC))[1] AS close,
      COALESCE(sum(wif_amount), 0) AS volume
    FROM trades WHERE nation_id = ${id}
    GROUP BY bucket ORDER BY bucket DESC LIMIT 500`;
  const candles = rows.reverse().map((r) => ({
    time: Number(r.bucket),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume) / WAD,
  }));
  // Each candle opens where the previous one closed (prices are continuous between trades).
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i]!;
    c.open = candles[i - 1]!.close;
    c.high = Math.max(c.high, c.open);
    c.low = Math.min(c.low, c.open);
  }
  return candles;
}

export async function getSeries(sql: Sql, id: number, days: number) {
  const since = Math.floor(Date.now() / 1000) - days * 86400;
  const rows = await sql`
    SELECT epoch, price_wif, market_cap_wif, liquidity_wif, volume_1h_wif, citizens, treasury_wif, civilization_score, economic_power
    FROM game_snapshots WHERE nation_id = ${id} AND epoch >= ${since} ORDER BY epoch`;
  return rows.map((r) => ({
    time: Number(r.epoch),
    priceWif: num(r.price_wif),
    marketCapWif: num(r.market_cap_wif),
    liquidityWif: num(r.liquidity_wif),
    volumeWif: Number(r.volume_1h_wif),
    citizens: Number(r.citizens),
    treasuryWif: Number(r.treasury_wif),
    civilizationScore: Number(r.civilization_score),
    economicPower: Number(r.economic_power),
  }));
}

export async function getTrades(sql: Sql, opts: { nationId?: number; trader?: string; limit: number }): Promise<(TradeDTO & { nationId: number })[]> {
  const rows = await sql`
    SELECT * FROM trades
    WHERE (${opts.nationId ?? null}::int IS NULL OR nation_id = ${opts.nationId ?? null})
      AND (${opts.trader ?? null}::text IS NULL OR trader = ${opts.trader ?? null})
    ORDER BY timestamp DESC, log_index DESC LIMIT ${opts.limit}`;
  return rows.map((r) => ({
    nationId: Number(r.nation_id),
    txHash: r.tx_hash as string,
    logIndex: Number(r.log_index),
    trader: r.trader as string,
    side: r.is_buy ? "buy" : "sell",
    wifAmount: Number(r.wif_amount) / WAD,
    tokenAmount: Number(r.token_amount) / WAD,
    priceWif: Number(r.price_wif),
    venue: r.venue as TradeDTO["venue"],
    timestamp: Number(r.timestamp),
  }));
}

export async function getHolders(sql: Sql, id: number, limit: number): Promise<{ holders: HolderDTO[]; total: number; citizens: number; top10Share: number }> {
  const [n] = await sql`SELECT total_supply, pair, founder FROM nations WHERE id = ${id}`;
  if (!n) return { holders: [], total: 0, citizens: 0, top10Share: 0 };
  const supply = BigInt(n.total_supply as string);
  const threshold = supply / 1_000_000n;
  const excluded = await sql`SELECT address, label FROM excluded_addresses`;
  const labels = new Map(excluded.map((e) => [e.address as string, e.label as string]));
  labels.set(n.pair as string, "Uniswap V2 pool (locked liquidity)");
  const rows = await sql`SELECT address, balance, first_held_at FROM holders WHERE nation_id = ${id} ORDER BY balance DESC LIMIT ${limit}`;
  const [{ total }] = (await sql`SELECT count(*)::int AS total FROM holders WHERE nation_id = ${id}`) as unknown as [{ total: number }];
  const [{ citizens }] = (await sql`SELECT citizens FROM game_nations WHERE nation_id = ${id}`) as unknown as [{ citizens: number }];
  const holders = rows.map((r) => {
    const balance = BigInt(r.balance as string);
    const system = labels.get(r.address as string) ?? null;
    const label = system ?? ((r.address as string) === n.founder ? "Founder" : null);
    return {
      address: r.address as string,
      balance: balance.toString(),
      share: Number((balance * 1_000_000n) / supply) / 1_000_000,
      since: Number(r.first_held_at),
      isCitizen: system === null && balance >= threshold,
      label,
    };
  });
  const citizenHolders = holders.filter((h) => h.isCitizen);
  const top10Share = citizenHolders.slice(0, 10).reduce((s, h) => s + h.share, 0);
  return { holders, total, citizens: Number(citizens ?? 0), top10Share };
}

/**
 * The chain's clock as last seen by the indexer: proposal states compare against block time, exactly as
 * AtlasGovernor.state() does. Falls back to wall time before the first sync.
 */
async function chainNow(sql: Sql): Promise<number> {
  const [r] = await sql`SELECT max(last_block_timestamp) AS t FROM indexer_state`;
  const t = Number(r?.t ?? 0);
  return t > 0 ? t : Math.floor(Date.now() / 1000);
}

function toProposal(r: Record<string, unknown>, now: number): ProposalDTO {
  const executed = Boolean(r.executed);
  const canceled = Boolean(r.canceled);
  const forV = BigInt(r.for_votes as string);
  const againstV = BigInt(r.against_votes as string);
  const abstainV = BigInt(r.abstain_votes as string);
  const quorum = BigInt(r.quorum as string);
  const voteEnd = Number(r.vote_end);
  const eta = Number(r.eta);
  // Mirrors AtlasGovernor.state(); the contract remains authoritative for execution.
  let state: number;
  if (executed) state = 5;
  else if (canceled) state = 1;
  else if (now <= voteEnd) state = 0;
  else if (forV <= againstV || forV + abstainV < quorum) state = 2;
  else if (now < eta) state = 3;
  else if (now > eta + 7 * 86400) state = 6;
  else state = 4;
  const kind = Number(r.kind);
  const decoded = decodePayload(kind, r.payload as Hex) as unknown as Record<string, unknown>;
  return {
    id: Number(r.id),
    nationId: Number(r.nation_id),
    proposer: r.proposer as string,
    kind,
    payload: r.payload as string,
    decoded,
    description: r.description as string,
    snapshot: Number(r.snapshot),
    voteEnd,
    eta,
    quorum: quorum.toString(),
    forVotes: forV.toString(),
    againstVotes: againstV.toString(),
    abstainVotes: abstainV.toString(),
    state,
    createdAt: Number(r.created_at),
    executedAt: num(r.executed_at),
    txHash: r.tx_hash as string,
    gameOutcome: r.ga_status ? { status: r.ga_status as string, reason: (r.ga_reason as string) ?? null } : null,
  };
}

export async function getProposals(sql: Sql, opts: { nationId?: number; proposer?: string; limit: number }): Promise<ProposalDTO[]> {
  const rows = await sql`
    SELECT p.*, ga.status AS ga_status, ga.reason AS ga_reason FROM proposals p
    LEFT JOIN game_actions ga ON ga.proposal_id = p.id
    WHERE (${opts.nationId ?? null}::int IS NULL OR p.nation_id = ${opts.nationId ?? null})
      AND (${opts.proposer ?? null}::text IS NULL OR p.proposer = ${opts.proposer ?? null})
    ORDER BY p.id DESC LIMIT ${opts.limit}`;
  const now = await chainNow(sql);
  return rows.map((r) => toProposal(r, now));
}

export async function getProposal(sql: Sql, id: number) {
  const [r] = await sql`
    SELECT p.*, ga.status AS ga_status, ga.reason AS ga_reason FROM proposals p
    LEFT JOIN game_actions ga ON ga.proposal_id = p.id WHERE p.id = ${id}`;
  if (!r) return null;
  const votes = await sql`SELECT voter, support, weight, reason, tx_hash, timestamp FROM votes WHERE proposal_id = ${id} ORDER BY weight DESC LIMIT 200`;
  return {
    proposal: toProposal(r, await chainNow(sql)),
    votes: votes.map((v) => ({
      voter: v.voter as string,
      support: Number(v.support),
      weight: String(v.weight),
      reason: v.reason as string,
      txHash: v.tx_hash as string,
      timestamp: Number(v.timestamp),
    })),
  };
}

export async function getTreasury(sql: Sql, id: number): Promise<{ balanceWif: number; receivedWif: number; releasedWif: number; txs: TreasuryTxDTO[] }> {
  const rows = await sql`SELECT * FROM treasury_txs WHERE nation_id = ${id} ORDER BY timestamp DESC, log_index DESC LIMIT 100`;
  const [agg] = await sql`
    SELECT COALESCE(sum(amount) FILTER (WHERE direction = 'in'), 0) AS rin, COALESCE(sum(amount) FILTER (WHERE direction = 'out'), 0) AS rout
    FROM treasury_txs WHERE nation_id = ${id}`;
  const received = Number(agg?.rin ?? 0) / WAD;
  const released = Number(agg?.rout ?? 0) / WAD;
  return {
    balanceWif: received - released,
    receivedWif: received,
    releasedWif: released,
    txs: rows.map((r) => ({
      direction: r.direction as TreasuryTxDTO["direction"],
      amountWif: Number(r.amount) / WAD,
      counterparty: r.counterparty as string,
      kind: r.kind as TreasuryTxDTO["kind"],
      proposalId: num(r.proposal_id),
      txHash: r.tx_hash as string,
      timestamp: Number(r.timestamp),
    })),
  };
}

export async function getWarDetail(sql: Sql, id: number) {
  const [w] = await sql`SELECT * FROM game_wars WHERE id = ${id}`;
  if (!w) return null;
  const attackerId = Number(w.attacker_id);
  const defenderId = Number(w.defender_id);
  const [attacker, defender] = await nationSummaries(sql, { ids: [attackerId, defenderId] }).then((list) => [
    list.find((n) => n.id === attackerId)!,
    list.find((n) => n.id === defenderId)!,
  ]);
  const aStart = w.attacker_start as { citizens: number; marketCapWif: number };
  const dStart = w.defender_start as { citizens: number; marketCapWif: number };
  let projection: { attacker: ReturnType<typeof warScore>; defender: ReturnType<typeof warScore>; leader: number } | null = null;
  if (w.status === "active" && attacker && defender) {
    const vol = await sql`
      SELECT nation_id, COALESCE(sum(wif_amount), 0) AS v FROM trades
      WHERE nation_id = ANY(${[attackerId, defenderId]}) AND timestamp >= ${Number(w.declared_at)} GROUP BY nation_id`;
    const v = new Map(vol.map((r) => [Number(r.nation_id), Number(r.v) / WAD]));
    // Allies = other current members of the nation's alliance, exactly as the game engine counts them.
    const allyRows = await sql`
      SELECT g.nation_id, (SELECT count(*) FROM game_alliance_members m WHERE m.alliance_id = g.alliance_id AND m.left_at IS NULL) AS members
      FROM game_nations g WHERE g.nation_id = ANY(${[attackerId, defenderId]}) AND g.alliance_id IS NOT NULL`;
    const allies = new Map(allyRows.map((r) => [Number(r.nation_id), Math.max(0, Number(r.members) - 1)]));
    const side = (n: NationSummary, start: typeof aStart) => ({
      citizensStart: start.citizens,
      citizensEnd: n.citizens,
      marketCapStartWif: start.marketCapWif,
      marketCapEndWif: n.marketCapWif ?? start.marketCapWif,
      warVolumeWif: v.get(n.id) ?? 0,
      economicPowerEnd: n.economicPower,
      defensivePowerEnd: n.defensivePower,
      allies: allies.get(n.id) ?? 0,
    });
    const a = warScore(side(attacker, aStart), false);
    const d = warScore(side(defender, dStart), true);
    projection = { attacker: a, defender: d, leader: a.total > d.total ? attackerId : defenderId };
  }
  const [proposal] = await sql`SELECT description, proposer FROM proposals WHERE id = ${id}`;
  return {
    war: {
      id: Number(w.id),
      attackerId,
      defenderId,
      declaredAt: Number(w.declared_at),
      endsAt: Number(w.ends_at),
      status: w.status as string,
      winnerId: num(w.winner_id),
      attackerStart: aStart,
      defenderStart: dStart,
      attackerScore: (w.attacker_score as Record<string, number> | null) ?? null,
      defenderScore: (w.defender_score as Record<string, number> | null) ?? null,
      spoils: num(w.spoils),
      txHash: w.tx_hash as string,
      reason: (proposal?.description as string) ?? null,
    },
    attacker,
    defender,
    projection,
    news: await newsItems(sql, { nationId: attackerId, limit: 20 }).then((items) =>
      items.filter((i) => (i.data as { warId?: number }).warId === id),
    ),
  };
}

export async function getAllianceDetail(sql: Sql, id: number) {
  const [a] = await sql`SELECT * FROM game_alliances WHERE id = ${id}`;
  if (!a) return null;
  const members = await sql`SELECT nation_id, joined_at, left_at FROM game_alliance_members WHERE alliance_id = ${id} ORDER BY joined_at`;
  const invites = await sql`SELECT nation_id, invited_at FROM game_alliance_invites WHERE alliance_id = ${id}`;
  const ids = [...new Set([...members.map((m) => Number(m.nation_id)), ...invites.map((i) => Number(i.nation_id))])];
  const nations = ids.length ? await nationSummaries(sql, { ids }) : [];
  return {
    alliance: {
      id: Number(a.id),
      name: a.name as string,
      leaderId: Number(a.leader_id),
      createdAt: Number(a.created_at),
      active: Boolean(a.active),
      dissolvedAt: num(a.dissolved_at),
    },
    members: members.map((m) => ({ nationId: Number(m.nation_id), joinedAt: Number(m.joined_at), leftAt: num(m.left_at) })),
    invites: invites.map((i) => ({ nationId: Number(i.nation_id), invitedAt: Number(i.invited_at) })),
    nations,
  };
}

/** Earned XP + holding-day XP (5/day per nation, capped at 30 days) counted from the start of the current holding period. */
const XP_SQL = (sql: Sql, now: number) => sql`
  WITH earned AS (SELECT address, sum(amount)::int AS xp FROM game_citizen_xp GROUP BY address),
  holding AS (
    SELECT h.address, sum(LEAST(${XP.citizenshipDayCap}, floor((${now} - h.first_held_at) / 86400.0)) * ${XP.citizenshipDay})::int AS xp
    FROM holders h JOIN nations n ON n.id = h.nation_id
    WHERE h.balance >= n.total_supply / 1000000 AND h.address NOT IN (SELECT address FROM excluded_addresses) AND h.address <> n.pair
    GROUP BY h.address
  ),
  total AS (
    SELECT COALESCE(e.address, h.address) AS address, COALESCE(e.xp, 0) + COALESCE(h.xp, 0) AS xp
    FROM earned e FULL OUTER JOIN holding h ON h.address = e.address
  )
  SELECT address, xp, rank() OVER (ORDER BY xp DESC) AS rank FROM total`;

export async function getCitizen(sql: Sql, address: string): Promise<CitizenProfile> {
  const a = address.toLowerCase();
  const now = await chainNow(sql);
  const [xpRow] = await sql`SELECT * FROM (${XP_SQL(sql, now)}) x WHERE address = ${a}`;
  const holdings = await sql`
    SELECT h.nation_id, h.balance, h.first_held_at, n.name, n.ticker, n.emblem, n.metadata_uri, n.total_supply, n.founder
    FROM holders h JOIN nations n ON n.id = h.nation_id
    WHERE h.address = ${a} AND h.balance >= n.total_supply / 1000000 ORDER BY h.balance DESC`;
  const founded = await sql`SELECT id FROM nations WHERE founder = ${a} ORDER BY id`;
  const achievements = await sql`SELECT code, nation_id, unlocked_at FROM game_citizen_achievements WHERE address = ${a} ORDER BY unlocked_at`;
  const [counts] = await sql`
    SELECT (SELECT count(*)::int FROM votes WHERE voter = ${a}) AS votes,
           (SELECT count(*)::int FROM proposals WHERE proposer = ${a}) AS proposals,
           (SELECT count(DISTINCT w.id)::int FROM game_wars w JOIN votes v ON v.proposal_id = w.id AND v.voter = ${a}) AS wars`;
  const recent = await sql`SELECT proposal_id, nation_id, support, weight, timestamp FROM votes WHERE voter = ${a} ORDER BY timestamp DESC LIMIT 20`;
  const xp = Number(xpRow?.xp ?? 0);
  return {
    address: a,
    xp,
    rank: xpRow ? Number(xpRow.rank) : null,
    rankTitle: citizenRank(xp),
    titles: achievements.map((r) => TITLE_ACHIEVEMENTS[r.code as string]).filter(Boolean) as string[],
    citizenships: holdings.map((h) => ({
      nationId: Number(h.nation_id),
      name: h.name as string,
      ticker: h.ticker as string,
      emblem: String(h.emblem),
      metadataUri: (h.metadata_uri as string) ?? "",
      balance: String(h.balance),
      share: Number((BigInt(h.balance as string) * 1_000_000n) / BigInt(h.total_supply as string)) / 1_000_000,
      since: Number(h.first_held_at),
      isFounder: h.founder === a,
    })),
    foundedNationIds: founded.map((f) => Number(f.id)),
    achievements: achievements
      .filter((r) => ACHIEVEMENT_BY_CODE[r.code as string])
      .map((r) => ({ code: r.code as string, nationId: num(r.nation_id), unlockedAt: Number(r.unlocked_at) })),
    votesCast: Number(counts?.votes ?? 0),
    proposalsCreated: Number(counts?.proposals ?? 0),
    warsParticipated: Number(counts?.wars ?? 0),
    recentVotes: recent.map((v) => ({
      proposalId: Number(v.proposal_id),
      nationId: Number(v.nation_id),
      support: Number(v.support),
      weight: String(v.weight),
      timestamp: Number(v.timestamp),
    })),
  };
}

/** Profit and loss per nation for one wallet: average cost from its buys, realized on sells, unrealized at today's price. */
export async function getPositions(sql: Sql, address: string): Promise<PositionDTO[]> {
  const a = address.toLowerCase();
  const rows = await sql`
    SELECT t.nation_id,
           n.name, n.ticker, n.emblem, n.metadata_uri,
           COALESCE(h.balance, 0)::text AS balance,
           COALESCE(sum(t.wif_amount) FILTER (WHERE t.is_buy), 0)::text AS buy_wif,
           COALESCE(sum(t.token_amount) FILTER (WHERE t.is_buy), 0)::text AS buy_tokens,
           COALESCE(sum(t.wif_amount) FILTER (WHERE NOT t.is_buy), 0)::text AS sell_wif,
           COALESCE(sum(t.token_amount) FILTER (WHERE NOT t.is_buy), 0)::text AS sell_tokens,
           count(*)::int AS trades,
           max(t.timestamp) AS last_at
    FROM trades t
    JOIN nations n ON n.id = t.nation_id
    LEFT JOIN holders h ON h.nation_id = t.nation_id AND h.address = ${a}
    WHERE t.trader = ${a}
    GROUP BY t.nation_id, n.name, n.ticker, n.emblem, n.metadata_uri, h.balance
    ORDER BY last_at DESC
    LIMIT 100`;
  if (rows.length === 0) return [];
  const prices = new Map((await nationSummaries(sql, { ids: rows.map((r) => Number(r.nation_id)) })).map((n) => [n.id, n.priceWif]));
  return rows.map((r) => {
    const w = (v: unknown) => Number(v) / WAD;
    const balance = w(r.balance);
    const boughtWif = w(r.buy_wif);
    const boughtTokens = w(r.buy_tokens);
    const soldWif = w(r.sell_wif);
    const soldTokens = w(r.sell_tokens);
    const avg = boughtTokens > 0 ? boughtWif / boughtTokens : null;
    const price = prices.get(Number(r.nation_id)) ?? null;
    // Tokens still held that were bought through trades; anything above that arrived by transfer and has no known cost.
    const costed = Math.max(0, Math.min(balance, boughtTokens - soldTokens));
    const realizedWif = avg === null ? soldWif : soldWif - Math.min(soldTokens, boughtTokens) * avg;
    return {
      nationId: Number(r.nation_id),
      name: r.name as string,
      ticker: r.ticker as string,
      emblem: String(r.emblem),
      metadataUri: (r.metadata_uri as string) ?? "",
      balance,
      boughtWif,
      soldWif,
      avgCostWif: avg,
      priceWif: price,
      valueWif: price === null ? null : balance * price,
      realizedWif,
      unrealizedWif: price === null || avg === null ? null : costed * (price - avg),
      trades: Number(r.trades),
    };
  });
}

/** A nation's founder-set social links, or null when none are set (or the table has not been migrated yet). */
export async function getSocials(sql: Sql, id: number): Promise<NationSocials | null> {
  try {
    const [r] = await sql`SELECT x, telegram, website FROM nation_socials WHERE nation_id = ${id}`;
    return r ? { x: r.x as string, telegram: r.telegram as string, website: r.website as string } : null;
  } catch (err) {
    if ((err as { code?: string })?.code === "42P01") return null;
    throw err;
  }
}

export interface SellPnl {
  txHash: string;
  nationId: number;
  name: string;
  ticker: string;
  emblem: string;
  metadataUri: string;
  trader: string;
  timestamp: number;
  tokensSold: number;
  wifReceived: number;
  /** Average buy price before this sale ($WIF per token); null when the tokens never went through a buy. */
  entryPriceWif: number | null;
  exitPriceWif: number;
  /** Realized profit on this sale in $WIF and as a fraction (0.5 = +50%); null without an entry price. */
  pnlWif: number | null;
  pnlPct: number | null;
  /** Seconds between the wallet's first buy of this nation and this sale. */
  heldSeconds: number | null;
}

/**
 * The PnL of one sale, computed from indexed on-chain trades only: the sale(s) in this transaction against the
 * wallet's average buy price before it. Returns null until the transaction is indexed (or if it holds no sale).
 */
export async function getSellPnl(sql: Sql, txHash: string): Promise<SellPnl | null> {
  const tx = txHash.toLowerCase();
  const [s] = await sql`
    SELECT t.nation_id, t.trader, min(t.block_number) AS block, min(t.log_index) AS log_index, max(t.timestamp) AS ts,
           sum(t.token_amount)::text AS tokens, sum(t.wif_amount)::text AS wif,
           n.name, n.ticker, n.emblem, n.metadata_uri
    FROM trades t JOIN nations n ON n.id = t.nation_id
    WHERE t.tx_hash = ${tx} AND NOT t.is_buy
    GROUP BY t.nation_id, t.trader, n.name, n.ticker, n.emblem, n.metadata_uri
    ORDER BY sum(t.wif_amount) DESC
    LIMIT 1`;
  if (!s) return null;
  const [b] = await sql`
    SELECT COALESCE(sum(wif_amount), 0)::text AS wif, COALESCE(sum(token_amount), 0)::text AS tokens, min(timestamp) AS first_at
    FROM trades
    WHERE nation_id = ${s.nation_id} AND trader = ${s.trader} AND is_buy
      AND (block_number, log_index) < (${s.block}::bigint, ${s.log_index}::int)`;
  const tokensSold = Number(s.tokens) / WAD;
  const wifReceived = Number(s.wif) / WAD;
  const boughtTokens = Number(b?.tokens ?? 0) / WAD;
  const boughtWif = Number(b?.wif ?? 0) / WAD;
  const entry = boughtTokens > 0 ? boughtWif / boughtTokens : null;
  const exit = tokensSold > 0 ? wifReceived / tokensSold : 0;
  const cost = entry === null ? null : entry * tokensSold;
  return {
    txHash: tx,
    nationId: Number(s.nation_id),
    name: s.name as string,
    ticker: s.ticker as string,
    emblem: String(s.emblem),
    metadataUri: (s.metadata_uri as string) ?? "",
    trader: s.trader as string,
    timestamp: Number(s.ts),
    tokensSold,
    wifReceived,
    entryPriceWif: entry,
    exitPriceWif: exit,
    pnlWif: cost === null ? null : wifReceived - cost,
    pnlPct: cost === null || cost === 0 ? null : wifReceived / cost - 1,
    heldSeconds: b?.first_at === null || b?.first_at === undefined ? null : Math.max(0, Number(s.ts) - Number(b.first_at)),
  };
}

export async function getTopCitizens(sql: Sql, limit: number) {
  const now = await chainNow(sql);
  const rows = await sql`SELECT * FROM (${XP_SQL(sql, now)}) x ORDER BY rank LIMIT ${limit}`;
  return rows.map((r) => ({ address: r.address as string, xp: Number(r.xp), rank: Number(r.rank), title: citizenRank(Number(r.xp)) }));
}

export async function getSearchIndex(sql: Sql) {
  const nations = await sql`SELECT id, name, ticker, token, founder, emblem, metadata_uri FROM nations ORDER BY id`;
  const alliances = await sql`SELECT id, name FROM game_alliances WHERE active ORDER BY id`;
  return {
    nations: nations.map((n) => ({
      id: Number(n.id),
      name: n.name as string,
      ticker: n.ticker as string,
      token: n.token as string,
      founder: n.founder as string,
      emblem: String(n.emblem),
      metadataUri: (n.metadata_uri as string) ?? "",
    })),
    alliances: alliances.map((a) => ({ id: Number(a.id), name: a.name as string })),
  };
}

export { newsItems, allianceSummaries, warSummaries };
