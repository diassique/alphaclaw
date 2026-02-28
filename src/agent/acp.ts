/**
 * Alpha Consensus Protocol (ACP) — Consensus Engine
 *
 * Formalizes the agent staking/reputation system into a visible protocol:
 *   1. COLLECT — parse X-ACP-* headers from service responses (or fallback to extraction)
 *   2. CONSENSUS — weighted vote using effectiveStake * reputation
 *   3. SETTLE — slash/reward based on agreement with consensus direction
 *
 * Runs AFTER synthesizeAlpha() to add a protocol layer on top of existing logic.
 */

import { createLogger } from "../lib/logger.js";
import { createStore } from "../lib/store.js";
import { extractDirection, extractConfidence, getReputation, computeConsensus } from "./reputation.js";
import type {
  ServiceKey,
  Direction,
  ACPPhase,
  ACPRound,
  ACPAgentVote,
  ACPConsensusResult,
  ACPSettlementResult,
  ACPSlashEvent,
  ACPRewardEvent,
  ACPProtocolStatus,
  ACPAgentStats,
  ServiceResponse,
} from "../types/index.js";
import { ACP_VERSION, ACP_HEADERS } from "../types/index.js";

const log = createLogger("acp");

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_STAKE = 100;
const SLASH_RATE = 0.5;
const REWARD_RATE = 0.3;
const HIGH_CONFIDENCE_THRESHOLD = 0.7;
const HIGH_CONF_EXTRA_SLASH = 0.2;
const HIGH_CONF_EXTRA_REWARD = 0.15;
const REP_AGREE = 0.05;
const REP_DISAGREE = -0.08;
const REP_HIGH_CONF_WRONG = -0.05;
const REP_HIGH_CONF_RIGHT = 0.03;
const MAX_ROUNDS = 200;
const MAX_EVENTS = 500;

// ─── Persistence ────────────────────────────────────────────────────────────

interface ACPData {
  rounds: ACPRound[];
  stats: Record<string, ACPAgentStats>;
  slashLog: ACPSlashEvent[];
  rewardLog: ACPRewardEvent[];
}

const store = createStore<ACPData>({
  filename: "acp-rounds.json",
  defaultValue: { rounds: [], stats: {}, slashLog: [], rewardLog: [] },
  debounceMs: 5000,
});

let rounds: ACPRound[] = [];
let agentStats: Record<string, ACPAgentStats> = {};
let slashLog: ACPSlashEvent[] = [];
let rewardLog: ACPRewardEvent[] = [];

function save(): void {
  store.set({ rounds, stats: agentStats, slashLog, rewardLog });
}

export function loadACP(): void {
  store.load();
  const data = store.get();
  rounds = data.rounds.slice(-MAX_ROUNDS);
  agentStats = data.stats;
  slashLog = data.slashLog.slice(-MAX_EVENTS);
  rewardLog = data.rewardLog.slice(-MAX_EVENTS);
  log.info("ACP loaded", { rounds: rounds.length, agents: Object.keys(agentStats).length });
}

// ─── Stats helpers ──────────────────────────────────────────────────────────

function ensureStats(key: ServiceKey): ACPAgentStats {
  if (!agentStats[key]) {
    agentStats[key] = {
      key,
      rounds: 0,
      totalStaked: 0,
      totalReturned: 0,
      pnl: 0,
      agreementRate: 0,
      currentStreak: 0,
      bestStreak: 0,
      slashCount: 0,
      rewardCount: 0,
    };
  }
  return agentStats[key]!;
}

// ─── Main entry point ───────────────────────────────────────────────────────

export interface ACPInput {
  roundId: string;
  topic: string;
  responses: {
    key: ServiceKey;
    response: ServiceResponse | null;
    responseTimeMs?: number;
  }[];
}

export function executeACPRound(input: ACPInput): ACPRound {
  const ts = new Date().toISOString();
  const phases: { phase: ACPPhase; durationMs: number }[] = [];

  // ─── Phase 1: COLLECT ─────────────────────────────────────────────────

  const collectStart = performance.now();
  const votes: ACPAgentVote[] = [];

  for (const { key, response, responseTimeMs } of input.responses) {
    if (!response) continue;

    const rep = getReputation(key);

    // Try to read ACP headers from response
    const acpHeaders = (response as ServiceResponse & { acpHeaders?: Record<string, string> }).acpHeaders;
    let fromHeaders = false;
    let direction: Direction;
    let confidence: number;
    let declaredStake: number;

    if (acpHeaders?.[ACP_HEADERS.direction] && acpHeaders?.[ACP_HEADERS.confidence]) {
      // Parse from protocol headers
      const dirHeader = acpHeaders[ACP_HEADERS.direction];
      direction = (dirHeader === "bullish" || dirHeader === "bearish" || dirHeader === "neutral")
        ? dirHeader : "neutral";
      confidence = Math.max(0, Math.min(1, parseFloat(acpHeaders[ACP_HEADERS.confidence] ?? "0.3")));
      declaredStake = Math.max(0, parseFloat(acpHeaders[ACP_HEADERS.stake] ?? String(MAX_STAKE * confidence)));
      fromHeaders = true;
    } else {
      // Fallback to extraction from response data
      direction = extractDirection(key, response.data);
      confidence = extractConfidence(response.data);
      declaredStake = MAX_STAKE * confidence;
    }

    // Effective stake: capped by reputation
    const effectiveStake = parseFloat(Math.min(declaredStake, MAX_STAKE * rep.score).toFixed(2));
    const weight = parseFloat((effectiveStake * rep.score).toFixed(2));

    votes.push({
      key,
      direction,
      confidence: parseFloat(confidence.toFixed(3)),
      declaredStake: parseFloat(declaredStake.toFixed(2)),
      effectiveStake,
      reputation: parseFloat(rep.score.toFixed(3)),
      weight,
      agreedWithConsensus: false, // filled after consensus
      fromHeaders,
      responseTimeMs,
    });
  }

  phases.push({ phase: "collect", durationMs: parseFloat((performance.now() - collectStart).toFixed(2)) });

  // ─── Phase 2: CONSENSUS ───────────────────────────────────────────────

  const consensusStart = performance.now();

  // Use existing computeConsensus for direction
  const directions = votes.map(v => ({ key: v.key, direction: v.direction }));
  const consensusDirection = computeConsensus(directions);

  // Compute weighted breakdown
  const weightBreakdown: Record<Direction, number> = { bullish: 0, bearish: 0, neutral: 0 };
  let totalWeight = 0;
  for (const vote of votes) {
    weightBreakdown[vote.direction] += vote.weight;
    totalWeight += vote.weight;
  }

  // Mark agreement
  let agreeWeight = 0;
  for (const vote of votes) {
    vote.agreedWithConsensus = vote.direction === consensusDirection || consensusDirection === "neutral";
    if (vote.agreedWithConsensus) agreeWeight += vote.weight;
  }

  const strength = totalWeight > 0 ? parseFloat((agreeWeight / totalWeight).toFixed(3)) : 0;
  const unanimity = votes.length > 0 && votes.every(v => v.agreedWithConsensus);

  const consensus: ACPConsensusResult = {
    direction: consensusDirection,
    strength,
    unanimity,
    quorum: votes.length,
    totalWeight: parseFloat(totalWeight.toFixed(2)),
    weightBreakdown: {
      bullish: parseFloat(weightBreakdown.bullish.toFixed(2)),
      bearish: parseFloat(weightBreakdown.bearish.toFixed(2)),
      neutral: parseFloat(weightBreakdown.neutral.toFixed(2)),
    },
  };

  phases.push({ phase: "consensus", durationMs: parseFloat((performance.now() - consensusStart).toFixed(2)) });

  // ─── Phase 3: SETTLE ──────────────────────────────────────────────────

  const settleStart = performance.now();

  let totalStaked = 0;
  let totalReturned = 0;
  const slashEvents: ACPSlashEvent[] = [];
  const rewardEvents: ACPRewardEvent[] = [];
  const slashedAgents: string[] = [];
  const rewardedAgents: string[] = [];

  for (const vote of votes) {
    const stats = ensureStats(vote.key);
    const staked = vote.effectiveStake;
    totalStaked += staked;

    if (vote.agreedWithConsensus) {
      // Base reward
      let returned = staked * (1 + REWARD_RATE * vote.confidence);
      let repDelta = REP_AGREE;
      let reason = "agreed with consensus";

      // High confidence correct bonus
      if (vote.confidence > HIGH_CONFIDENCE_THRESHOLD) {
        returned += staked * HIGH_CONF_EXTRA_REWARD;
        repDelta += REP_HIGH_CONF_RIGHT;
        reason = "high-confidence correct";
      }

      returned = parseFloat(returned.toFixed(2));
      repDelta = parseFloat(repDelta.toFixed(3));
      totalReturned += returned;

      rewardedAgents.push(vote.key);
      const rewardEvent: ACPRewardEvent = {
        roundId: input.roundId,
        agent: vote.key,
        reason,
        rewardAmount: parseFloat((returned - staked).toFixed(2)),
        reputationDelta: repDelta,
        timestamp: ts,
      };
      rewardEvents.push(rewardEvent);
      rewardLog.push(rewardEvent);

      stats.rewardCount++;
      stats.totalReturned += returned;
      stats.currentStreak = stats.currentStreak >= 0 ? stats.currentStreak + 1 : 1;
      stats.bestStreak = Math.max(stats.bestStreak, stats.currentStreak);
    } else {
      // Base slash
      let returned = staked * (1 - SLASH_RATE * vote.confidence);
      let repDelta = REP_DISAGREE;
      let reason = "against consensus";

      // High confidence wrong extra slash
      if (vote.confidence > HIGH_CONFIDENCE_THRESHOLD) {
        returned -= staked * HIGH_CONF_EXTRA_SLASH;
        repDelta += REP_HIGH_CONF_WRONG;
        reason = "high-confidence wrong";
      }

      returned = parseFloat(Math.max(0, returned).toFixed(2));
      repDelta = parseFloat(repDelta.toFixed(3));
      totalReturned += returned;

      slashedAgents.push(vote.key);
      const slashEvent: ACPSlashEvent = {
        roundId: input.roundId,
        agent: vote.key,
        reason,
        slashedAmount: parseFloat((staked - returned).toFixed(2)),
        reputationDelta: repDelta,
        timestamp: ts,
      };
      slashEvents.push(slashEvent);
      slashLog.push(slashEvent);

      stats.slashCount++;
      stats.totalReturned += returned;
      stats.currentStreak = stats.currentStreak <= 0 ? stats.currentStreak - 1 : -1;
    }

    stats.rounds++;
    stats.totalStaked += staked;
    stats.pnl = parseFloat((stats.totalReturned - stats.totalStaked).toFixed(2));

    // Update agreement rate
    const totalAgreed = rewardLog.filter(e => e.agent === vote.key).length;
    stats.agreementRate = stats.rounds > 0
      ? parseFloat((totalAgreed / stats.rounds * 100).toFixed(1))
      : 0;
  }

  const settlement: ACPSettlementResult = {
    totalStaked: parseFloat(totalStaked.toFixed(2)),
    totalReturned: parseFloat(totalReturned.toFixed(2)),
    netPnl: parseFloat((totalReturned - totalStaked).toFixed(2)),
    slashedAgents,
    rewardedAgents,
    slashEvents,
    rewardEvents,
  };

  phases.push({ phase: "settle", durationMs: parseFloat((performance.now() - settleStart).toFixed(2)) });

  // Trim logs
  if (slashLog.length > MAX_EVENTS) slashLog = slashLog.slice(-MAX_EVENTS);
  if (rewardLog.length > MAX_EVENTS) rewardLog = rewardLog.slice(-MAX_EVENTS);

  // Build round
  const round: ACPRound = {
    roundId: input.roundId,
    topic: input.topic,
    timestamp: ts,
    phases,
    agents: votes,
    consensus,
    settlement,
  };

  rounds.push(round);
  if (rounds.length > MAX_ROUNDS) rounds = rounds.slice(-MAX_ROUNDS);

  save();

  log.info("ACP round completed", {
    roundId: input.roundId,
    consensus: consensusDirection,
    strength: strength.toFixed(2),
    quorum: votes.length,
    slashed: slashedAgents.length,
    rewarded: rewardedAgents.length,
    netPnl: settlement.netPnl,
  });

  return round;
}

// ─── Query functions ────────────────────────────────────────────────────────

export function getACPStatus(): ACPProtocolStatus {
  const leaderboard = Object.values(agentStats)
    .sort((a, b) => b.pnl - a.pnl);

  return {
    version: ACP_VERSION,
    totalRounds: rounds.length,
    totalSlashes: slashLog.length,
    totalRewards: rewardLog.length,
    recentRounds: rounds.slice(-10).reverse(),
    leaderboard,
    recentSlashes: slashLog.slice(-20).reverse(),
    recentRewards: rewardLog.slice(-20).reverse(),
  };
}

export function getACPRound(id: string): ACPRound | null {
  return rounds.find(r => r.roundId === id) ?? null;
}

export function getSlashLog(limit = 50): ACPSlashEvent[] {
  return slashLog.slice(-limit).reverse();
}

export function getRewardLog(limit = 50): ACPRewardEvent[] {
  return rewardLog.slice(-limit).reverse();
}

export function getAgentACPStats(key: ServiceKey): ACPAgentStats | null {
  return agentStats[key] ?? null;
}
