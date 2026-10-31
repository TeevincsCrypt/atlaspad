/**
 * AtlasPad database schema.
 *
 * The blockchain is the source of truth. This database is an index/cache with two clearly separated layers:
 *  - ON-CHAIN MIRROR tables (prefix: none) hold data decoded 1:1 from contract events and chain state.
 *    They can always be rebuilt by re-indexing from the deployment block.
 *  - GAME tables (prefix `game_`) hold values derived by the published game rules (packages/shared/src/game)
 *    from the on-chain mirror. They can always be rebuilt by replaying the game engine.
 * uint256 values are stored as numeric(78,0) strings; never as floats.
 */
import {
  bigint,
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const uint = (name: string) => numeric(name, { precision: 78, scale: 0 });
const unix = (name: string) => bigint(name, { mode: "number" });

// ---------------------------------------------------------------------------------------------
// Indexer bookkeeping
// ---------------------------------------------------------------------------------------------

export const indexerState = pgTable("indexer_state", {
  id: text("id").primaryKey(),
  chainId: integer("chain_id").notNull(),
  lastBlock: unix("last_block").notNull(),
  lastBlockHash: text("last_block_hash"),
  lastBlockTimestamp: unix("last_block_timestamp"),
  chainHead: unix("chain_head"),
  gameCursor: unix("game_cursor").notNull().default(0),
  wifUsd: doublePrecision("wif_usd"),
  wifUsdUpdatedAt: unix("wif_usd_updated_at"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const indexedBlocks = pgTable("indexed_blocks", {
  number: unix("number").primaryKey(),
  hash: text("hash").notNull(),
  timestamp: unix("timestamp").notNull(),
});

export const indexerErrors = pgTable(
  "indexer_errors",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    scope: text("scope").notNull(),
    message: text("message").notNull(),
    details: jsonb("details"),
    resolved: boolean("resolved").notNull().default(false),
  },
  (t) => [index("indexer_errors_at_idx").on(t.at)],
);

export const excludedAddresses = pgTable("excluded_addresses", {
  address: text("address").primaryKey(),
  label: text("label").notNull(),
  kind: text("kind").notNull(), // burn | dex | protocol | system
});

// ---------------------------------------------------------------------------------------------
// ON-CHAIN MIRROR
// ---------------------------------------------------------------------------------------------

export const nations = pgTable(
  "nations",
  {
    id: integer("id").primaryKey(),
    token: text("token").notNull(),
    pair: text("pair").notNull(),
    founder: text("founder").notNull(),
    name: text("name").notNull(),
    ticker: text("ticker").notNull(),
    description: text("description").notNull().default(""),
    theme: integer("theme").notNull(),
    emblem: uint("emblem").notNull(),
    metadataUri: text("metadata_uri").notNull().default(""),
    totalSupply: uint("total_supply").notNull(),
    curveSupply: uint("curve_supply").notNull(),
    lpReserve: uint("lp_reserve").notNull(),
    founderAllocation: uint("founder_allocation").notNull(),
    initialVirtualWif: uint("initial_virtual_wif").notNull(),
    initialVirtualTokens: uint("initial_virtual_tokens").notNull(),
    virtualWif: uint("virtual_wif").notNull(),
    virtualTokens: uint("virtual_tokens").notNull(),
    realWif: uint("real_wif").notNull(),
    curveTokensRemaining: uint("curve_tokens_remaining").notNull(),
    graduated: boolean("graduated").notNull().default(false),
    graduatedAt: unix("graduated_at"),
    graduationTx: text("graduation_tx"),
    graduationWif: uint("graduation_wif"),
    tokenIsToken0: boolean("token_is_token0"),
    poolTokenReserve: uint("pool_token_reserve"),
    poolWifReserve: uint("pool_wif_reserve"),
    /** $WIF burned on behalf of this nation (creation fee + burn share of curve trade fees). */
    wifBurned: uint("wif_burned").notNull().default("0"),
    createdAt: unix("created_at").notNull(),
    createdBlock: unix("created_block").notNull(),
    createdTx: text("created_tx").notNull(),
  },
  (t) => [uniqueIndex("nations_token_idx").on(t.token), index("nations_pair_idx").on(t.pair)],
);

export const trades = pgTable(
  "trades",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    nationId: integer("nation_id").notNull(),
    trader: text("trader").notNull(),
    isBuy: boolean("is_buy").notNull(),
    wifAmount: uint("wif_amount").notNull(),
    tokenAmount: uint("token_amount").notNull(),
    fee: uint("fee").notNull(),
    priceWif: doublePrecision("price_wif").notNull(),
    marketCapWif: doublePrecision("market_cap_wif").notNull(),
    liquidityWif: doublePrecision("liquidity_wif").notNull(),
    venue: text("venue").notNull(), // curve | uniswap
    blockNumber: unix("block_number").notNull(),
    timestamp: unix("timestamp").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex] }),
    index("trades_nation_time_idx").on(t.nationId, t.timestamp),
    index("trades_trader_idx").on(t.trader),
    index("trades_block_idx").on(t.blockNumber),
  ],
);

export const transfers = pgTable(
  "transfers",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    nationId: integer("nation_id").notNull(),
    from: text("from_address").notNull(),
    to: text("to_address").notNull(),
    amount: uint("amount").notNull(),
    blockNumber: unix("block_number").notNull(),
    timestamp: unix("timestamp").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.txHash, t.logIndex] }),
    index("transfers_nation_time_idx").on(t.nationId, t.timestamp),
    index("transfers_block_idx").on(t.blockNumber),
  ],
);

export const holders = pgTable(
  "holders",
  {
    nationId: integer("nation_id").notNull(),
    address: text("address").notNull(),
    balance: uint("balance").notNull(),
    firstHeldAt: unix("first_held_at").notNull(),
    updatedBlock: unix("updated_block").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.nationId, t.address] }),
    index("holders_address_idx").on(t.address),
    index("holders_nation_balance_idx").on(t.nationId, t.balance),
  ],
);

export const treasuryTxs = pgTable(
  "treasury_txs",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    nationId: integer("nation_id").notNull(),
    direction: text("direction").notNull(), // in | out
    amount: uint("amount").notNull(),
    counterparty: text("counterparty").notNull(),
    kind: text("kind").notNull(), // trade_fee | donation | release
    proposalId: integer("proposal_id"),
    blockNumber: unix("block_number").notNull(),
    timestamp: unix("timestamp").notNull(),
  },
  (t) => [primaryKey({ columns: [t.txHash, t.logIndex] }), index("treasury_nation_idx").on(t.nationId, t.timestamp)],
);

export const proposals = pgTable(
  "proposals",
  {
    id: integer("id").primaryKey(),
    nationId: integer("nation_id").notNull(),
    proposer: text("proposer").notNull(),
    kind: integer("kind").notNull(),
    payload: text("payload").notNull(),
    description: text("description").notNull(),
    snapshot: unix("snapshot").notNull(),
    voteEnd: unix("vote_end").notNull(),
    eta: unix("eta").notNull(),
    quorum: uint("quorum").notNull(),
    forVotes: uint("for_votes").notNull().default("0"),
    againstVotes: uint("against_votes").notNull().default("0"),
    abstainVotes: uint("abstain_votes").notNull().default("0"),
    canceled: boolean("canceled").notNull().default(false),
    executed: boolean("executed").notNull().default(false),
    executedAt: unix("executed_at"),
    executedTx: text("executed_tx"),
    createdAt: unix("created_at").notNull(),
    createdBlock: unix("created_block").notNull(),
    txHash: text("tx_hash").notNull(),
  },
  (t) => [index("proposals_nation_idx").on(t.nationId), index("proposals_proposer_idx").on(t.proposer)],
);

export const votes = pgTable(
  "votes",
  {
    proposalId: integer("proposal_id").notNull(),
    voter: text("voter").notNull(),
    nationId: integer("nation_id").notNull(),
    support: integer("support").notNull(),
    weight: uint("weight").notNull(),
    reason: text("reason").notNull().default(""),
    txHash: text("tx_hash").notNull(),
    blockNumber: unix("block_number").notNull(),
    timestamp: unix("timestamp").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.proposalId, t.voter] }),
    index("votes_voter_idx").on(t.voter),
    index("votes_nation_time_idx").on(t.nationId, t.timestamp),
  ],
);

/** Raw GameActionExecuted events (on-chain decisions). Their game outcome lives in game_actions. */
export const gameActionEvents = pgTable(
  "game_action_events",
  {
    proposalId: integer("proposal_id").primaryKey(),
    nationId: integer("nation_id").notNull(),
    action: integer("action").notNull(),
    arg: uint("arg").notNull(),
    text: text("text").notNull(),
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: unix("block_number").notNull(),
    timestamp: unix("timestamp").notNull(),
  },
  (t) => [index("game_action_events_time_idx").on(t.timestamp, t.blockNumber, t.logIndex)],
);

// ---------------------------------------------------------------------------------------------
// GAME / DERIVED
// ---------------------------------------------------------------------------------------------

export const gameNations = pgTable("game_nations", {
  nationId: integer("nation_id").primaryKey(),
  // live market metrics (derived from the on-chain mirror)
  priceWif: doublePrecision("price_wif"),
  marketCapWif: doublePrecision("market_cap_wif"),
  liquidityWif: doublePrecision("liquidity_wif"),
  volume24hWif: doublePrecision("volume_24h_wif").notNull().default(0),
  trades24h: integer("trades_24h").notNull().default(0),
  change1h: doublePrecision("change_1h"),
  change24h: doublePrecision("change_24h"),
  athMarketCapWif: doublePrecision("ath_market_cap_wif"),
  athLiquidityWif: doublePrecision("ath_liquidity_wif"),
  treasuryWif: doublePrecision("treasury_wif").notNull().default(0),
  citizens: integer("citizens").notNull().default(0),
  citizens24hAgo: integer("citizens_24h_ago"),
  // stats
  economicPower: real("economic_power").notNull().default(0),
  militaryPower: real("military_power").notNull().default(0),
  defensivePower: real("defensive_power").notNull().default(0),
  influenceScore: real("influence_score").notNull().default(0),
  populationScore: real("population_score").notNull().default(0),
  developmentScore: real("development_score").notNull().default(0),
  civilizationScore: real("civilization_score").notNull().default(0),
  tier: integer("tier").notNull().default(0),
  territoryCells: integer("territory_cells").notNull().default(6),
  rank: integer("rank"),
  previousRank: integer("previous_rank"),
  // resources (game-only)
  influence: integer("influence").notNull().default(0),
  culture: integer("culture").notNull().default(0),
  energy: integer("energy").notNull().default(0),
  materials: integer("materials").notNull().default(0),
  // diplomacy / military
  warWins: integer("war_wins").notNull().default(0),
  warLosses: integer("war_losses").notNull().default(0),
  allianceId: integer("alliance_id"),
  warTerritoryBonusUntil: unix("war_territory_bonus_until"),
  statuses: jsonb("statuses").$type<{ type: string; until: number }[]>().notNull().default([]),
  lastFired: jsonb("last_fired").$type<Record<string, number>>().notNull().default({}),
  updatedAt: unix("updated_at").notNull().default(0),
});

export const gameSnapshots = pgTable(
  "game_snapshots",
  {
    nationId: integer("nation_id").notNull(),
    epoch: unix("epoch").notNull(),
    priceWif: doublePrecision("price_wif"),
    marketCapWif: doublePrecision("market_cap_wif"),
    liquidityWif: doublePrecision("liquidity_wif"),
    volume1hWif: doublePrecision("volume_1h_wif").notNull(),
    volume24hWif: doublePrecision("volume_24h_wif").notNull(),
    trades1h: integer("trades_1h").notNull(),
    citizens: integer("citizens").notNull(),
    treasuryWif: doublePrecision("treasury_wif").notNull(),
    civilizationScore: real("civilization_score").notNull(),
    economicPower: real("economic_power").notNull(),
    wifUsd: doublePrecision("wif_usd"),
  },
  (t) => [primaryKey({ columns: [t.nationId, t.epoch] })],
);

export const gameResourceLedger = pgTable(
  "game_resource_ledger",
  {
    id: serial("id").primaryKey(),
    nationId: integer("nation_id").notNull(),
    at: unix("at").notNull(),
    influence: integer("influence").notNull().default(0),
    culture: integer("culture").notNull().default(0),
    energy: integer("energy").notNull().default(0),
    materials: integer("materials").notNull().default(0),
    reason: text("reason").notNull(),
    ref: text("ref").notNull(),
  },
  (t) => [uniqueIndex("game_resource_ledger_ref_idx").on(t.nationId, t.ref), index("game_resource_ledger_nation_idx").on(t.nationId, t.at)],
);

export const gameActions = pgTable("game_actions", {
  proposalId: integer("proposal_id").primaryKey(),
  nationId: integer("nation_id").notNull(),
  action: integer("action").notNull(),
  status: text("status").notNull(), // applied | rejected
  reason: text("reason"),
  appliedAt: unix("applied_at").notNull(),
});

export const gameBuildings = pgTable(
  "game_buildings",
  {
    id: serial("id").primaryKey(),
    nationId: integer("nation_id").notNull(),
    type: integer("type").notNull(),
    status: text("status").notNull(), // constructing | complete
    proposalId: integer("proposal_id").notNull(),
    startedAt: unix("started_at").notNull(),
    completesAt: unix("completes_at").notNull(),
    completedAt: unix("completed_at"),
  },
  (t) => [index("game_buildings_nation_idx").on(t.nationId), uniqueIndex("game_buildings_proposal_idx").on(t.proposalId)],
);

export const gameWars = pgTable(
  "game_wars",
  {
    id: integer("id").primaryKey(), // = DeclareWar proposal id
    attackerId: integer("attacker_id").notNull(),
    defenderId: integer("defender_id").notNull(),
    declaredAt: unix("declared_at").notNull(),
    endsAt: unix("ends_at").notNull(),
    status: text("status").notNull(), // active | ended
    winnerId: integer("winner_id"),
    attackerStart: jsonb("attacker_start").$type<Record<string, number>>().notNull(),
    defenderStart: jsonb("defender_start").$type<Record<string, number>>().notNull(),
    attackerScore: jsonb("attacker_score").$type<Record<string, number>>(),
    defenderScore: jsonb("defender_score").$type<Record<string, number>>(),
    spoils: integer("spoils"),
    txHash: text("tx_hash").notNull(),
  },
  (t) => [index("game_wars_attacker_idx").on(t.attackerId), index("game_wars_defender_idx").on(t.defenderId)],
);

export const gameAlliances = pgTable("game_alliances", {
  id: integer("id").primaryKey(), // = CreateAlliance proposal id
  name: text("name").notNull(),
  leaderId: integer("leader_id").notNull(),
  createdAt: unix("created_at").notNull(),
  active: boolean("active").notNull().default(true),
  dissolvedAt: unix("dissolved_at"),
});

export const gameAllianceMembers = pgTable(
  "game_alliance_members",
  {
    allianceId: integer("alliance_id").notNull(),
    nationId: integer("nation_id").notNull(),
    joinedAt: unix("joined_at").notNull(),
    leftAt: unix("left_at"),
  },
  (t) => [primaryKey({ columns: [t.allianceId, t.nationId, t.joinedAt] }), index("game_alliance_members_nation_idx").on(t.nationId)],
);

export const gameAllianceInvites = pgTable(
  "game_alliance_invites",
  {
    allianceId: integer("alliance_id").notNull(),
    nationId: integer("nation_id").notNull(),
    invitedAt: unix("invited_at").notNull(),
    proposalId: integer("proposal_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.allianceId, t.nationId] })],
);

/** ATLAS NEWS: every world event, derived from real on-chain activity. */
export const gameEvents = pgTable(
  "game_events",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    severity: text("severity").notNull(),
    nationId: integer("nation_id"),
    targetNationId: integer("target_nation_id"),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    txHash: text("tx_hash"),
    blockNumber: unix("block_number"),
    createdAt: unix("created_at").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
  },
  (t) => [
    uniqueIndex("game_events_dedupe_idx").on(t.dedupeKey),
    index("game_events_created_idx").on(t.createdAt),
    index("game_events_nation_idx").on(t.nationId, t.createdAt),
  ],
);

export const gameNationAchievements = pgTable(
  "game_nation_achievements",
  {
    nationId: integer("nation_id").notNull(),
    code: text("code").notNull(),
    unlockedAt: unix("unlocked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.nationId, t.code] })],
);

export const gameCitizenAchievements = pgTable(
  "game_citizen_achievements",
  {
    address: text("address").notNull(),
    code: text("code").notNull(),
    nationId: integer("nation_id"),
    unlockedAt: unix("unlocked_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.address, t.code] }), index("game_citizen_achievements_time_idx").on(t.unlockedAt)],
);

export const gameCitizenXp = pgTable(
  "game_citizen_xp",
  {
    address: text("address").notNull(),
    ref: text("ref").notNull(),
    amount: integer("amount").notNull(),
    reason: text("reason").notNull(),
    at: unix("at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.address, t.ref] }), index("game_citizen_xp_at_idx").on(t.at)],
);

// ---------------------------------------------------------------------------------------------
// Off-chain profile data (not derived from the chain, so it survives re-indexing)
// ---------------------------------------------------------------------------------------------

/** A nation's social links, set by its founder with a signed message (see apps/web/src/app/api/nations/[id]/socials). */
export const nationSocials = pgTable("nation_socials", {
  nationId: integer("nation_id").primaryKey(),
  x: text("x").notNull().default(""),
  telegram: text("telegram").notNull().default(""),
  website: text("website").notNull().default(""),
  signer: text("signer").notNull(),
  updatedAt: unix("updated_at").notNull(),
});
