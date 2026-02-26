// ─── Service Keys ───────────────────────────────────────────────────────────

export type ServiceKey = string;

export const BUILTIN_KEYS = ["sentiment", "sentiment2", "polymarket", "defi", "news", "whale"] as const;
export type BuiltinServiceKey = typeof BUILTIN_KEYS[number];

// ─── Agent Registry ─────────────────────────────────────────────────────────

export type AgentCategory = "sentiment" | "prediction" | "defi" | "news" | "onchain" | "other";

export interface AgentRegistration {
  key: string;
  displayName: string;
  url: string;
  endpoint: string;
  price: string;
  description: string;
  category: AgentCategory;
}

export interface AgentEntry extends AgentRegistration {
  builtin: boolean;
  online: boolean;
  registeredAt: string;
  lastHealthCheck: string | null;
  healthFailures: number;
}

export interface ExternalAgentResponse {
  service: string;
  timestamp: string;
  result: {
    direction: Direction;
    confidenceScore: number;
    confidenceBasis?: string;
    signals?: string[];
    data?: Record<string, unknown>;
  };
}

// ─── Confidence Staking ─────────────────────────────────────────────────────

export interface ConfidencePayload {
  confidenceScore: number; // 0.0–1.0
  confidenceBasis: string;
}

export type Direction = "bullish" | "bearish" | "neutral";

export interface AgentReputation {
  key: ServiceKey;
  score: number;           // 0.0–1.0
  hunts: number;
  correct: number;
  pnl: number;             // cumulative P&L from staking
  history: number[];        // ring buffer of recent scores
}

export interface StakeResult {
  service: ServiceKey;
  confidence: number;
  direction: Direction;
  staked: number;
  returned: number;
  reputationBefore: number;
  reputationAfter: number;
  correct: boolean;
}

export interface StakingSummary {
  huntId: string;
  consensus: Direction;
  results: StakeResult[];
  totalStaked: number;
  totalReturned: number;
}

export interface ReputationSnapshot {
  [key: string]: { score: number; hunts: number; correct: number; pnl: number };
}

export interface DynamicPrice {
  service: ServiceKey;
  basePrice: string;
  effectivePrice: string;
  multiplier: number;
  reputation: number;
}

export interface CompetitionResult {
  winner: ServiceKey;
  loser: ServiceKey;
  winnerRatio: number;
  loserRatio: number;
  reason: string;
}

// ─── Sentiment ──────────────────────────────────────────────────────────────

export type SentimentLabel = "strongly_bullish" | "bullish" | "neutral" | "bearish" | "strongly_bearish";
export type ConfidenceLevel = "high" | "medium" | "low";

export interface SentimentSignal {
  word: string;
  type: "STRONG_BULL" | "STRONG_BEAR" | "BULL" | "BEAR";
  score: number;
}

export interface SentimentResult {
  label: string;
  score: number;
  confidence: string;
}

// ─── Polymarket ─────────────────────────────────────────────────────────────

export type AlphaSignal = "HIGH" | "MEDIUM" | "LOW";

export interface PolymarketMarket {
  question?: string;
  title?: string;
  volume?: string | number;
  volumeNum?: string | number;
  outcomePrices?: string | number[];
  active?: boolean;
  endDate?: string;
  endDateIso?: string;
}

export interface AlphaOpportunity {
  question: string;
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  endDate?: string;
  alphaSignal: AlphaSignal;
  reason: string;
}

// ─── DeFi ───────────────────────────────────────────────────────────────────

export type AlphaLevel = "HOT" | "WARM" | "COOL";

export interface CoinGeckoToken {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_24h?: number;
  price_change_percentage_7d_in_currency?: number;
  market_cap: number;
  total_volume: number;
}

export interface ScoredToken {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change1h: number;
  change24h: number;
  change7d: number;
  volumeToMcap: string;
  alphaScore: number;
  alphaLevel: AlphaLevel;
  suggestedAction: string;
}

// ─── News ───────────────────────────────────────────────────────────────────

export interface NewsArticle {
  title: string;
  description: string;
  publishedAt: string;
  source: string;
  url?: string;
}

export interface CryptoPanicPost {
  title: string;
  description?: string;
  published_at: string;
  url: string;
  original_url?: string;
  source: { title: string; domain: string; region?: string };
  votes?: { positive: number; negative: number; important: number };
  metadata?: { description?: string };
}

export interface CryptoPanicResponse {
  results?: CryptoPanicPost[];
}

export interface NewsResult {
  topic: string;
  articles: Array<{ title: string; description: string; publishedAt: string; source: string }>;
  count: number;
}

// ─── Whale ──────────────────────────────────────────────────────────────────

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

export interface WhaleResult {
  address: string;
  movements: Array<{ hash: string; from: string; to: string; value: string; tokenSymbol: string; isWhale: boolean }>;
  whaleCount: number;
  totalVolumeUSD: string;
  signal: string;
}

// ─── Hunter / Orchestrator ──────────────────────────────────────────────────

export interface X402Body {
  accepts: Array<{
    maxAmountRequired?: string;
    description?: string;
    scheme?: string;
    network?: string;
  }>;
  x402Version?: number;
}

export interface X402FetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  paid: boolean;
  txHash?: string;
  demoMode?: boolean;
  paymentRequired?: { description?: string; amount: string };
}

export interface ServiceResponse {
  ok: boolean;
  data: { result?: SentimentResult | PolymarketResult | DefiResult | NewsResult | WhaleResult | Record<string, unknown> } | null;
  paid: boolean;
  txHash?: string;
  demoMode?: boolean;
  paymentRequired?: { description?: string; amount: string };
}

export interface PolymarketResult {
  topSignal: string;
  opportunities?: Array<{ question: string; alphaSignal: string; yesPrice: number }>;
}

export interface DefiOpportunity {
  symbol: string;
  alphaLevel: string;
  suggestedAction: string;
  change24h: number;
}

export interface DefiResult {
  topOpportunity?: DefiOpportunity;
}

export interface PaymentEntry {
  service: string;
  price: string;
  paid: boolean;
  txHash?: string;
}

export interface PaymentLog {
  totalPaid: string;
  breakdown: PaymentEntry[];
}

export interface AlphaSynthesis {
  confidence: string;
  weightedConfidence: number;
  consensusStrength: number;
  recommendation: string;
  signals: string[];
  warnings?: string[];
  stakingSummary: StakingSummary;
  reputationSnapshot: ReputationSnapshot;
  dynamicPricing: DynamicPrice[];
  competitionResult?: CompetitionResult;
  breakdown: {
    sentiment: Pick<SentimentResult, "label" | "score" | "confidence"> | null;
    polymarket: { market: string; signal: string; yesPrice: number } | null;
    defi: { asset: string; action: string; change24h: string } | null;
    news: { topHeadline: string; articleCount: number } | null;
    whale: { signal: string; whaleCount: number; totalVolume: string } | null;
    external?: Record<string, { direction: Direction; confidence: number; signals: string[] } | null>;
  };
}

export interface CachedReport {
  id: string;
  topic: string;
  timestamp: string;
  createdAt: number;
  alpha: AlphaSynthesis;
  agentPayments: PaymentLog;
  stakingSummary: StakingSummary;
  preview: string;
}

export interface SettledResult {
  news: ServiceResponse | null;
  sentiment: ServiceResponse | null;
  polymarket: ServiceResponse | null;
  defi: ServiceResponse | null;
  whale: ServiceResponse | null;
  external: Record<string, ServiceResponse | null>;
  warnings: string[];
  competitionResult?: CompetitionResult;
}

// ─── Circuit Breaker ────────────────────────────────────────────────────────

export type CircuitState = "closed" | "open" | "half-open";

export interface CircuitBreakerEntry {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  openedAt: number;
}

export interface CircuitBreakerStatus {
  [key: string]: CircuitBreakerEntry;
}

// ─── Autopilot ──────────────────────────────────────────────────────────────

export type AutopilotPhase = "idle" | "hunting" | "adapting" | "waiting";

export interface AutopilotConfig {
  topics: string[];
  baseIntervalMs: number;
  minIntervalMs: number;
  maxIntervalMs: number;
}

export interface AdaptationRecord {
  timestamp: string;
  oldIntervalMs: number;
  newIntervalMs: number;
  confidence: number;
  reason: string;
}

export interface AutopilotStatus {
  running: boolean;
  phase: AutopilotPhase;
  currentIntervalMs: number;
  huntCount: number;
  topicIndex: number;
  nextHuntAt: string | null;
  adaptations: AdaptationRecord[];
  lastConfidence: number | null;
}

// ─── Agent Memory ───────────────────────────────────────────────────────────

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

export interface SignalCombination {
  combo: string;           // sorted signals joined, e.g. "sentiment:bullish+whale:ACCUMULATION"
  occurrences: number;
  correctCount: number;
  accuracy: number;         // correctCount / verified occurrences
  lastSeen: string;
}

export interface MemoryInsight {
  combo: string;
  accuracy: number;
  occurrences: number;
  adjustment: number;       // confidence adjustment points
}

export interface MemoryStats {
  totalEntries: number;
  verifiedEntries: number;
  patterns: number;
  activePatterns: number;   // patterns with 3+ occurrences
  topPatterns: MemoryInsight[];
  weakPatterns: MemoryInsight[];
}

// ─── Telegram ───────────────────────────────────────────────────────────────

export interface TelegramConfig {
  botToken: string;
  chatId: string;
  alertThreshold: number;   // minimum confidence % to send alert
  enabled: boolean;
}
