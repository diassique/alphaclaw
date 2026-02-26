import type {
  ServiceKey,
  Direction,
  AgentReputation,
  StakeResult,
  StakingSummary,
  ReputationSnapshot,
  SentimentResult,
  PolymarketResult,
  DefiResult,
  NewsResult,
  WhaleResult,
} from "../types/index.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const INITIAL_REPUTATION = 0.5;
const DECAY_FACTOR = 0.95;
const CORRECT_REWARD = 0.05;
const INCORRECT_PENALTY = 0.08;
const BASE_STAKE = 100;
const SLASH_RATE = 0.5;
const REWARD_RATE = 0.3;
const HISTORY_SIZE = 20;

const ALL_KEYS: ServiceKey[] = ["sentiment", "sentiment2", "polymarket", "defi", "news", "whale"];

// ─── State ──────────────────────────────────────────────────────────────────

const reputations = new Map<ServiceKey, AgentReputation>();

function initAgent(key: ServiceKey): AgentReputation {
  return { key, score: INITIAL_REPUTATION, hunts: 0, correct: 0, pnl: 0, history: [] };
}

for (const k of ALL_KEYS) reputations.set(k, initAgent(k));

// ─── Getters ────────────────────────────────────────────────────────────────

export function getReputation(key: ServiceKey): AgentReputation {
  return reputations.get(key) ?? initAgent(key);
}

export function getAllReputations(): AgentReputation[] {
  return ALL_KEYS.map(k => getReputation(k));
}

export function getReputationSnapshot(): ReputationSnapshot {
  const snap: ReputationSnapshot = {};
  for (const k of ALL_KEYS) {
    const r = getReputation(k);
    snap[k] = { score: parseFloat(r.score.toFixed(3)), hunts: r.hunts, correct: r.correct, pnl: parseFloat(r.pnl.toFixed(2)) };
  }
  return snap;
}

export function resetAllReputations(): void {
  for (const k of ALL_KEYS) reputations.set(k, initAgent(k));
}

// ─── Direction extraction ───────────────────────────────────────────────────

export function extractDirection(key: ServiceKey, data: unknown): Direction {
  if (!data || typeof data !== "object") return "neutral";
  const d = data as Record<string, unknown>;
  const result = d["result"] as Record<string, unknown> | undefined;
  if (!result) return "neutral";

  switch (key) {
    case "sentiment":
    case "sentiment2": {
      const s = result as unknown as SentimentResult;
      if (s.label === "strongly_bullish" || s.label === "bullish") return "bullish";
      if (s.label === "strongly_bearish" || s.label === "bearish") return "bearish";
      return "neutral";
    }
    case "polymarket": {
      const p = result as unknown as PolymarketResult;
      if (p.topSignal === "HIGH" || p.topSignal === "MEDIUM") return "bullish";
      return "neutral";
    }
    case "defi": {
      const df = result as unknown as DefiResult;
      if (df.topOpportunity?.alphaLevel === "HOT") return "bullish";
      if (df.topOpportunity?.alphaLevel === "WARM") return "bullish";
      if (df.topOpportunity && df.topOpportunity.change24h < -5) return "bearish";
      return "neutral";
    }
    case "news": {
      const n = result as unknown as NewsResult;
      return (n.articles?.length ?? 0) > 2 ? "bullish" : "neutral";
    }
    case "whale": {
      const w = result as unknown as WhaleResult;
      if (w.signal === "ACCUMULATION") return "bullish";
      if (w.signal === "QUIET") return "bearish";
      return "neutral";
    }
    default:
      return "neutral";
  }
}

// ─── Consensus ──────────────────────────────────────────────────────────────

export function computeConsensus(directions: { key: ServiceKey; direction: Direction }[]): Direction {
  let bullWeight = 0;
  let bearWeight = 0;

  for (const { key, direction } of directions) {
    const rep = getReputation(key).score;
    if (direction === "bullish") bullWeight += rep;
    else if (direction === "bearish") bearWeight += rep;
  }

  if (bullWeight > bearWeight && bullWeight > 0.3) return "bullish";
  if (bearWeight > bullWeight && bearWeight > 0.3) return "bearish";
  return "neutral";
}

// ─── Settlement ─────────────────────────────────────────────────────────────

interface ServiceEntry {
  key: ServiceKey;
  data: unknown;
  confidenceScore: number;
}

export function settleHunt(
  huntId: string,
  entries: ServiceEntry[],
  consensus: Direction,
): StakingSummary {
  const results: StakeResult[] = [];
  let totalStaked = 0;
  let totalReturned = 0;

  for (const { key, data, confidenceScore } of entries) {
    const rep = reputations.get(key) ?? initAgent(key);
    const direction = extractDirection(key, data);
    const reputationBefore = rep.score;

    // Stake proportional to confidence and reputation
    const staked = parseFloat((BASE_STAKE * confidenceScore * rep.score).toFixed(2));
    totalStaked += staked;

    const correct = direction === consensus || consensus === "neutral";

    let returned: number;
    if (correct) {
      returned = parseFloat((staked * (1 + REWARD_RATE * confidenceScore)).toFixed(2));
      rep.score = Math.min(1, rep.score * DECAY_FACTOR + CORRECT_REWARD);
      rep.correct++;
    } else {
      returned = parseFloat((staked * (1 - SLASH_RATE * confidenceScore)).toFixed(2));
      rep.score = Math.max(0.05, rep.score * DECAY_FACTOR - INCORRECT_PENALTY);
    }

    totalReturned += returned;
    rep.pnl += returned - staked;
    rep.hunts++;

    // Ring buffer
    rep.history.push(rep.score);
    if (rep.history.length > HISTORY_SIZE) rep.history.shift();

    reputations.set(key, rep);

    results.push({
      service: key,
      confidence: confidenceScore,
      direction,
      staked,
      returned,
      reputationBefore: parseFloat(reputationBefore.toFixed(3)),
      reputationAfter: parseFloat(rep.score.toFixed(3)),
      correct,
    });
  }

  return {
    huntId,
    consensus,
    results,
    totalStaked: parseFloat(totalStaked.toFixed(2)),
    totalReturned: parseFloat(totalReturned.toFixed(2)),
  };
}

// ─── Confidence extraction helper ───────────────────────────────────────────

export function extractConfidence(data: unknown): number {
  if (!data || typeof data !== "object") return 0.3;
  const d = data as Record<string, unknown>;
  const result = d["result"] as Record<string, unknown> | undefined;
  if (!result) return 0.3;
  const cs = result["confidenceScore"];
  if (typeof cs === "number" && cs >= 0 && cs <= 1) return cs;
  return 0.3;
}
