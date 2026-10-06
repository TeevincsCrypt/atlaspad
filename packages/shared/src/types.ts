/**
 * Data transfer types shared by the web API and the indexer's realtime stream.
 *
 * Convention: `null` means "data unavailable" and must be rendered as such — never substituted with a guess.
 * Financial values (ETH/USD) come from on-chain state. Game values (powers, resources, tiers) are derived by
 * the published game rules and are not financial assets.
 */

export interface ResourcesDTO {
  influence: number;
  culture: number;
  energy: number;
  materials: number;
}

export interface NationStatus {
  type: string;
  until: number;
}

export interface NationSummary {
  id: number;
  name: string;
  ticker: string;
  token: string;
  pair: string;
  founder: string;
  theme: number;
  emblem: string;
  metadataUri: string;
  description: string;
  createdAt: number;
  graduated: boolean;
  graduatedAt: number | null;
  totalSupply: string;
  // ON-CHAIN / MARKET DATA (null when unavailable)
  priceEth: number | null;
  marketCapEth: number | null;
  liquidityEth: number | null;
  volume24hEth: number | null;
  trades24h: number;
  change1h: number | null;
  change24h: number | null;
  athMarketCapEth: number | null;
  curveProgress: number | null;
  treasuryEth: number;
  citizens: number;
  citizens24hAgo: number | null;
  // GAME DATA
  economicPower: number;
  militaryPower: number;
  defensivePower: number;
  influenceScore: number;
  populationScore: number;
  developmentScore: number;
  civilizationScore: number;
  tier: number;
  territoryCells: number;
  resources: ResourcesDTO;
  rank: number | null;
  previousRank: number | null;
  statuses: NationStatus[];
  activeWars: number;
  allianceId: number | null;
  buildings: number[];
  warWins: number;
  warLosses: number;
}

export interface WarSummary {
  id: number;
  attackerId: number;
  defenderId: number;
  declaredAt: number;
  endsAt: number;
  status: "active" | "ended";
  winnerId: number | null;
  attackerScore: number | null;
  defenderScore: number | null;
  proposalId: number;
  txHash: string;
}

export interface AllianceSummary {
  id: number;
  name: string;
  leaderId: number;
  memberIds: number[];
  createdAt: number;
  active: boolean;
}

export interface IndexerHealth {
  lastIndexedBlock: number | null;
  lastIndexedAt: number | null;
  chainHeadBlock: number | null;
  lagBlocks: number | null;
}

export interface WorldResponse {
  network: { chainId: number; name: string; deployed: boolean };
  nations: NationSummary[];
  wars: WarSummary[];
  alliances: AllianceSummary[];
  ethUsd: number | null;
  indexer: IndexerHealth;
  generatedAt: number;
}

export interface NewsItem {
  id: number;
  type: string;
  severity: "minor" | "notable" | "major";
  nationId: number | null;
  nationName: string | null;
  ticker: string | null;
  targetNationId: number | null;
  targetNationName: string | null;
  title: string;
  body: string;
  data: Record<string, unknown>;
  txHash: string | null;
  createdAt: number;
}

export interface TradeDTO {
  txHash: string;
  logIndex: number;
  trader: string;
  side: "buy" | "sell";
  ethAmount: number;
  tokenAmount: number;
  priceEth: number;
  venue: "curve" | "uniswap";
  timestamp: number;
}

export interface CandleDTO {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface HolderDTO {
  address: string;
  balance: string;
  share: number;
  since: number;
  isCitizen: boolean;
  label: string | null;
}

export interface ProposalDTO {
  id: number;
  nationId: number;
  proposer: string;
  kind: number;
  payload: string;
  decoded: Record<string, unknown>;
  description: string;
  snapshot: number;
  voteEnd: number;
  eta: number;
  quorum: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  state: number;
  createdAt: number;
  executedAt: number | null;
  txHash: string;
  gameOutcome: { status: string; reason: string | null } | null;
}

export interface BuildingDTO {
  id: number;
  type: number;
  status: "constructing" | "complete" | "rejected";
  startedAt: number;
  completesAt: number;
  completedAt: number | null;
  proposalId: number;
}

export interface TreasuryTxDTO {
  direction: "in" | "out";
  amountEth: number;
  counterparty: string;
  kind: "trade_fee" | "donation" | "release";
  proposalId: number | null;
  txHash: string;
  timestamp: number;
}

export interface AchievementDTO {
  code: string;
  nationId: number | null;
  unlockedAt: number;
}

export interface CitizenshipDTO {
  nationId: number;
  name: string;
  ticker: string;
  emblem: string;
  balance: string;
  share: number;
  since: number;
  isFounder: boolean;
}

export interface CitizenProfile {
  address: string;
  xp: number;
  rank: number | null;
  rankTitle: string;
  titles: string[];
  citizenships: CitizenshipDTO[];
  foundedNationIds: number[];
  achievements: AchievementDTO[];
  votesCast: number;
  proposalsCreated: number;
  warsParticipated: number;
  recentVotes: { proposalId: number; nationId: number; support: number; weight: string; timestamp: number }[];
}

/** Server-sent realtime messages from the indexer. */
export type RealtimeMessage =
  | { kind: "news"; item: NewsItem }
  | { kind: "trade"; nationId: number; trade: TradeDTO; priceEth: number; marketCapEth: number | null }
  | { kind: "nation"; nation: NationSummary }
  | { kind: "ranks"; ranks: { id: number; rank: number; previousRank: number | null }[] }
  | { kind: "proposal"; proposal: ProposalDTO }
  | { kind: "heartbeat"; block: number | null; at: number };
