// ─── Health ────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: string;
  port: number;
  status: "ok" | "error" | "offline";
  latencyMs: number;
  price?: string;
}

export interface HealthAllResponse {
  ok: boolean;
  networkStatus: string;
  onlineCount: number;
  totalCount: number;
  avgLatencyMs: number;
  checkedAt: string;
  services: ServiceHealth[];
}

// ─── Ping ──────────────────────────────────────────────────────────────────

export interface DynamicPrice {
  service: string;
  basePrice: string;
  effectivePrice: string;
  multiplier: number;
  reputation: number;
}

export interface PingResponse {
  status: string;
  totalBuyCost: string;
  margin: string;
  cachedReports: number;
  dynamicPricing: DynamicPrice[];
}

// ─── Reports ───────────────────────────────────────────────────────────────

export interface ReportSummary {
  id: string;
  topic: string;
  timestamp: string;
  preview: string;
  price: string;
}

export interface ReportsResponse {
  count: number;
  reports: ReportSummary[];
}

export interface BreakdownSection {
  sentiment?: { label: string; score: number; confidence: string } | null;
  polymarket?: { market: string; signal: string; yesPrice: number } | null;
  defi?: { asset: string; action: string; change24h: string } | null;
  news?: { topHeadline: string; articleCount: number } | null;
  whale?: { signal: string; whaleCount: number; totalVolume: string } | null;
  external?: Record<string, { direction: string; confidence: number; signals: string[] } | null>;
}

export interface StakeResult {
  service: string;
  confidence: number;
  direction: string;
  staked: number;
  returned: number;
  reputationBefore: number;
  reputationAfter: number;
  correct: boolean;
}

export interface StakingSummary {
  huntId: string;
  consensus: string;
  results: StakeResult[];
  totalStaked: number;
  totalReturned: number;
}

export interface PaymentEntry {
  service: string;
  price: string;
  paid: boolean;
  txHash?: string;
}

export interface ReportDetail {
  reportId: string;
  topic: string;
  timestamp: string;
  alpha: {
    confidence: string;
    weightedConfidence?: number;
    recommendation: string;
    signals: string[];
    breakdown: BreakdownSection;
    narrative?: AlphaNarrative;
  };
  agentPayments?: { breakdown: PaymentEntry[] };
  stakingSummary?: StakingSummary;
}

// ─── Reputation ────────────────────────────────────────────────────────────

export interface AgentRep {
  key: string;
  score: number;
  hunts: number;
  correct: number;
  pnl: number;
  history: number[];
}

export interface ReputationResponse {
  agents: AgentRep[];
}

// ─── Autopilot ─────────────────────────────────────────────────────────────

export interface AutopilotStatus {
  running: boolean;
  phase: string;
  currentIntervalMs: number;
  huntCount: number;
  topicIndex: number;
  nextHuntAt: string | null;
  adaptations: AdaptationRecord[];
  lastConfidence: number | null;
}

export interface AdaptationRecord {
  timestamp: string;
  oldIntervalMs: number;
  newIntervalMs: number;
  confidence: number;
  reason: string;
}

// ─── Telegram ──────────────────────────────────────────────────────────────

export interface TelegramStatus {
  enabled: boolean;
  chatId?: string;
  alertThreshold?: number;
}

// ─── Moltbook ─────────────────────────────────────────────────────────────

export interface MoltbookStatus {
  enabled: boolean;
  submolt: string;
  autoPost: boolean;
  minConfidence: number;
  postsToday: number;
  lastPost: string | null;
  rateLimitRemainingMs: number;
}

export interface MoltbookPostRecord {
  postId: string;
  reportId: string;
  topic: string;
  confidence: string;
  timestamp: string;
}

export interface MoltbookHistoryResponse {
  posts: MoltbookPostRecord[];
}

// ─── Circuits ──────────────────────────────────────────────────────────────

export interface CircuitEntry {
  state: "closed" | "open" | "half-open";
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  openedAt: number;
}

export type CircuitsResponse = Record<string, CircuitEntry>;

// ─── Memory ────────────────────────────────────────────────────────────────

export interface MemoryInsight {
  combo: string;
  accuracy: number;
  occurrences: number;
  adjustment: number;
}

export interface MemoryStats {
  totalEntries: number;
  verifiedEntries: number;
  patterns: number;
  activePatterns: number;
  topPatterns: MemoryInsight[];
  weakPatterns: MemoryInsight[];
}

export interface MemoryEntry {
  id: string;
  topic: string;
  timestamp: string;
  signals: string[];
  confidence: number;
  recommendation: string;
  verified?: boolean;
  outcome?: "correct" | "incorrect";
}

// ─── Live ──────────────────────────────────────────────────────────────────

export interface LiveConfig {
  sender: string | null;
  receiver: string | null;
  walletConnected: boolean;
  network: string;
  explorer: string;
  whaleExplorer: string;
  usdcContract: string;
}

export interface TxFeedItem {
  timestamp: string;
  service: string;
  fromAddr?: string;
  toAddr?: string;
  amount: string;
  txHash?: string;
  status: string;
}

export interface WhaleMovement {
  hash: string;
  from: string;
  to: string;
  value: string;
  tokenSymbol: string;
  timestamp: string;
  isWhale: boolean;
  usdEstimate?: string;
}

// ─── Settlement ────────────────────────────────────────────────────────────

export interface SettlementStats {
  totalSettled: number;
  correctCount: number;
  avgPriceMovePct: number | null;
}

// ─── Registry ──────────────────────────────────────────────────────────────

export interface AgentInfo {
  key: string;
  displayName: string;
  url: string;
  endpoint: string;
  price: string;
  description: string;
  category: string;
  builtin: boolean;
  online: boolean;
}

export interface RegistryResponse {
  agents: AgentInfo[];
  builtin: number;
  external: number;
}

// ─── Marketplace ──────────────────────────────────────────────────────────

export interface MarketplaceAgent {
  key: string;
  displayName: string;
  port: number;
  url: string;
}

export interface MarketplaceStatus {
  running: boolean;
  agents: MarketplaceAgent[];
}

// ─── SSE Events ────────────────────────────────────────────────────────────

export interface HuntStartEvent {
  services: number;
}

export interface HuntPayingEvent {
  service: string;
  amount: string;
  multiplier?: number;
}

export interface HuntResultEvent {
  service: string;
  paid: boolean;
  txHash?: string;
  amount?: string;
  fromAddr?: string;
  toAddr?: string;
}

export interface AlphaNarrative {
  summary: string;
  keyInsight: string;
  moltbookTitle: string;
  moltbookBody: string;
}

export interface HuntAlphaEvent {
  recommendation: string;
  confidence: string;
  weightedConfidence?: number;
  signals: string[];
  breakdown?: BreakdownSection;
  narrative?: AlphaNarrative;
  consensusStrength?: number;
}

export interface HuntStakingEvent {
  consensus: string;
  totalStaked: number;
  totalReturned: number;
  results: StakeResult[];
}

export interface HuntCompetitionEvent {
  winner: string;
  loser: string;
  winnerRatio: number;
  loserRatio: number;
  reason: string;
}

// ─── ACP (Alpha Consensus Protocol) ─────────────────────────────────────

export interface ACPAgentVote {
  key: string;
  direction: string;
  confidence: number;
  declaredStake: number;
  effectiveStake: number;
  reputation: number;
  weight: number;
  agreedWithConsensus: boolean;
  fromHeaders: boolean;
  responseTimeMs?: number;
}

export interface ACPConsensusResult {
  direction: string;
  strength: number;
  unanimity: boolean;
  quorum: number;
  totalWeight: number;
  weightBreakdown: Record<string, number>;
}

export interface ACPSlashEvent {
  roundId: string;
  agent: string;
  reason: string;
  slashedAmount: number;
  reputationDelta: number;
  timestamp: string;
}

export interface ACPRewardEvent {
  roundId: string;
  agent: string;
  reason: string;
  rewardAmount: number;
  reputationDelta: number;
  timestamp: string;
}

export interface ACPSettlementResult {
  totalStaked: number;
  totalReturned: number;
  netPnl: number;
  slashedAgents: string[];
  rewardedAgents: string[];
  slashEvents: ACPSlashEvent[];
  rewardEvents: ACPRewardEvent[];
}

export interface ACPRound {
  roundId: string;
  topic: string;
  timestamp: string;
  phases: { phase: string; durationMs: number }[];
  agents: ACPAgentVote[];
  consensus: ACPConsensusResult;
  settlement: ACPSettlementResult;
}

export interface ACPAgentStats {
  key: string;
  rounds: number;
  totalStaked: number;
  totalReturned: number;
  pnl: number;
  agreementRate: number;
  currentStreak: number;
  bestStreak: number;
  slashCount: number;
  rewardCount: number;
}

export interface ACPProtocolStatus {
  version: number;
  totalRounds: number;
  totalSlashes: number;
  totalRewards: number;
  recentRounds: ACPRound[];
  leaderboard: ACPAgentStats[];
  recentSlashes: ACPSlashEvent[];
  recentRewards: ACPRewardEvent[];
}
