import "server-only";
import type postgres from "postgres";
import { allianceSummaries, indexerHealth, nationSummaries, newsItems, warSummaries } from "@atlaspad/db/queries";
import {
  ACHIEVEMENT_BY_CODE,
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
  type NationSummary,
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
  const [nations, wars, alliances, health] = await Promise.all([
    nationSummaries(sql),
    warSummaries(sql, { limit: 300 }),
    allianceSummaries(sql, { activeOnly: true }),
    indexerHealth(sql),
  ]);
  return {
    network: { chainId: network.chain.id, name: network.chain.name, deployed: network.contracts !== null },
    nations,
    wars,
    alliances,
    ethUsd: health.ethUsd,
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
    realEth: number;
    virtualEth: string;
    virtualTokens: string;
    lpReserve: string;
    graduationEth: number | null;
  };
  ethUsd: number | null;
}

export async function getNationDetail(sql: Sql, id: number): Promise<NationDetail | null> {
  const [nation] = await nationSummaries(sql, { ids: [id] });
  if (!nation) return null;
  const [raw] = await sql`SELECT * FROM nations WHERE id = ${id}`;
  const [buildings, achievements, wars, allianceRow, invites, ledger, holderCount, health] = await Promise.all([
    sql`SELECT * FROM game_buildings WHERE nation_id = ${id} ORDER BY started_at`,
    sql`SELECT code, unlocked_at FROM game_nation_achievements WHERE nation_id = ${id} ORDER BY unlocked_at`,
    warSummaries(sql, { nationId: id, limit: 50 }),
    nation.allianceId === null
      ? Promise.resolve([])
      : sql`SELECT a.id, a.name, a.leader_id, COALESCE((SELECT array_agg(m.nation_id ORDER BY m.joined_at) FROM game_alliance_members m WHERE m.alliance_id = a.id AND m.left_at IS NULL), '{}') AS members FROM game_alliances a WHERE a.id = ${nation.allianceId}`,
    sql`SELECT i.alliance_id, i.invited_at, a.name FROM game_alliance_invites i JOIN game_alliances a ON a.id = i.alliance_id WHERE i.nation_id = ${id} AND a.active AND i.invited_at > ${Math.floor(Date.now() / 1000) - 14 * 86400}`,
    sql`SELECT at, influence, culture, energy, materials, reason FROM game_resource_ledger WHERE nation_id = ${id} AND reason <> 'Hourly production' ORDER BY at DESC LIMIT 40`,
    sql`SELECT count(*)::int AS c FROM holders WHERE nation_id = ${id}`,
    indexerHealth(sql),
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
      realEth: Number(raw!.real_eth) / WAD,
      virtualEth: String(raw!.virtual_eth),
      virtualTokens: String(raw!.virtual_tokens),
      lpReserve: String(raw!.lp_reserve),
      graduationEth: raw!.graduation_eth === null ? null : Number(raw!.graduation_eth) / WAD,
    },
    ethUsd: health.ethUsd,
  };
}

export async function getCandles(sql: Sql, id: number, interval: number): Promise<CandleDTO[]> {
  const rows = await sql`
    SELECT (timestamp / ${interval}) * ${interval} AS bucket,
      (array_agg(price_eth ORDER BY timestamp, log_index))[1] AS open,
      max(price_eth) AS high, min(price_eth) AS low,
      (array_agg(price_eth ORDER BY timestamp DESC, log_index DESC))[1] AS close,
      COALESCE(sum(eth_amount), 0) AS volume
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
    SELECT epoch, price_eth, market_cap_eth, liquidity_eth, volume_1h_eth, citizens, treasury_eth, civilization_score, economic_power
    FROM game_snapshots WHERE nation_id = ${id} AND epoch >= ${since} ORDER BY epoch`;
  return rows.map((r) => ({
    time: Number(r.epoch),
    priceEth: num(r.price_eth),
    marketCapEth: num(r.market_cap_eth),
    liquidityEth: num(r.liquidity_eth),
    volumeEth: Number(r.volume_1h_eth),
    citizens: Number(r.citizens),
    treasuryEth: Number(r.treasury_eth),
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
    ethAmount: Number(r.eth_amount) / WAD,
    tokenAmount: Number(r.token_amount) / WAD,
    priceEth: Number(r.price_eth),
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
  const now = Math.floor(Date.now() / 1000);
  return rows.map((r) => toProposal(r, now));
}

export async function getProposal(sql: Sql, id: number) {
  const [r] = await sql`
    SELECT p.*, ga.status AS ga_status, ga.reason AS ga_reason FROM proposals p
    LEFT JOIN game_actions ga ON ga.proposal_id = p.id WHERE p.id = ${id}`;
  if (!r) return null;
  const votes = await sql`SELECT voter, support, weight, reason, tx_hash, timestamp FROM votes WHERE proposal_id = ${id} ORDER BY weight DESC LIMIT 200`;
  return {
    proposal: toProposal(r, Math.floor(Date.now() / 1000)),
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

export async function getTreasury(sql: Sql, id: number): Promise<{ balanceEth: number; receivedEth: number; releasedEth: number; txs: TreasuryTxDTO[] }> {
  const rows = await sql`SELECT * FROM treasury_txs WHERE nation_id = ${id} ORDER BY timestamp DESC, log_index DESC LIMIT 100`;
  const [agg] = await sql`
    SELECT COALESCE(sum(amount) FILTER (WHERE direction = 'in'), 0) AS rin, COALESCE(sum(amount) FILTER (WHERE direction = 'out'), 0) AS rout
    FROM treasury_txs WHERE nation_id = ${id}`;
  const received = Number(agg?.rin ?? 0) / WAD;
  const released = Number(agg?.rout ?? 0) / WAD;
  return {
    balanceEth: received - released,
    receivedEth: received,
    releasedEth: released,
    txs: rows.map((r) => ({
      direction: r.direction as TreasuryTxDTO["direction"],
      amountEth: Number(r.amount) / WAD,
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
  const aStart = w.attacker_start as { citizens: number; marketCapEth: number };
  const dStart = w.defender_start as { citizens: number; marketCapEth: number };
  let projection: { attacker: ReturnType<typeof warScore>; defender: ReturnType<typeof warScore>; leader: number } | null = null;
  if (w.status === "active" && attacker && defender) {
    const vol = await sql`
      SELECT nation_id, COALESCE(sum(eth_amount), 0) AS v FROM trades
      WHERE nation_id = ANY(${[attackerId, defenderId]}) AND timestamp >= ${Number(w.declared_at)} GROUP BY nation_id`;
    const v = new Map(vol.map((r) => [Number(r.nation_id), Number(r.v) / WAD]));
    const side = (n: NationSummary, start: typeof aStart) => ({
      citizensStart: start.citizens,
      citizensEnd: n.citizens,
      marketCapStartEth: start.marketCapEth,
      marketCapEndEth: n.marketCapEth ?? start.marketCapEth,
      warVolumeEth: v.get(n.id) ?? 0,
      economicPowerEnd: n.economicPower,
      defensivePowerEnd: n.defensivePower,
      allies: 0,
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

/** Earned XP + citizenship-day XP (5/day per nation, capped at 30 days per nation). */
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
  const now = Math.floor(Date.now() / 1000);
  const [xpRow] = await sql`SELECT * FROM (${XP_SQL(sql, now)}) x WHERE address = ${a}`;
  const holdings = await sql`
    SELECT h.nation_id, h.balance, h.first_held_at, n.name, n.ticker, n.emblem, n.total_supply, n.founder
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

export async function getTopCitizens(sql: Sql, limit: number) {
  const now = Math.floor(Date.now() / 1000);
  const rows = await sql`SELECT * FROM (${XP_SQL(sql, now)}) x ORDER BY rank LIMIT ${limit}`;
  return rows.map((r) => ({ address: r.address as string, xp: Number(r.xp), rank: Number(r.rank), title: citizenRank(Number(r.xp)) }));
}

export async function getSearchIndex(sql: Sql) {
  const nations = await sql`SELECT id, name, ticker, token, founder, emblem FROM nations ORDER BY id`;
  const alliances = await sql`SELECT id, name FROM game_alliances WHERE active ORDER BY id`;
  return {
    nations: nations.map((n) => ({
      id: Number(n.id),
      name: n.name as string,
      ticker: n.ticker as string,
      token: n.token as string,
      founder: n.founder as string,
      emblem: String(n.emblem),
    })),
    alliances: alliances.map((a) => ({ id: Number(a.id), name: a.name as string })),
  };
}

export { newsItems, allianceSummaries, warSummaries };
