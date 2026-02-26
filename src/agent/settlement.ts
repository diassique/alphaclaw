/**
 * Settlement Oracle — verifies hunts against real market prices.
 *
 * After each hunt, records the predicted direction + snapshot price.
 * After SETTLEMENT_DELAY_MS, fetches the actual price and settles:
 *   - If price moved in predicted direction → correct
 *   - Otherwise → incorrect
 *
 * Updates reputation based on REAL outcomes, not consensus.
 */

import { createLogger } from "../lib/logger.js";
import { createStore } from "../lib/store.js";
import { fetchWithRetry } from "../lib/fetch-retry.js";
import { verifyEntry } from "./memory.js";
import type { Direction, ServiceKey, StakeResult } from "../types/index.js";

const log = createLogger("settlement");

// ─── Config ──────────────────────────────────────────────────────────────────

/** How long to wait before settling (default 10 min for demo, ideally 24h) */
const SETTLEMENT_DELAY_MS = 10 * 60_000;

/** Minimum price change % to count as directional (below this = neutral is correct) */
const MIN_PRICE_MOVE_PCT = 0.3;

const COINGECKO_SIMPLE = "https://api.coingecko.com/api/v3/simple/price";

/** Map common topic keywords to CoinGecko IDs */
const TOPIC_TO_COIN: Record<string, string> = {
  bitcoin: "bitcoin",
  btc: "bitcoin",
  ethereum: "ethereum",
  eth: "ethereum",
  solana: "solana",
  sol: "solana",
  defi: "ethereum",     // proxy DeFi with ETH
  crypto: "bitcoin",    // proxy general crypto with BTC
  market: "bitcoin",
  polygon: "matic-network",
  matic: "matic-network",
  avalanche: "avalanche-2",
  avax: "avalanche-2",
  cardano: "cardano",
  ada: "cardano",
  polkadot: "polkadot",
  dot: "polkadot",
  chainlink: "chainlink",
  link: "chainlink",
  base: "ethereum",
};

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PendingSettlement {
  huntId: string;
  topic: string;
  coinId: string;
  consensus: Direction;
  snapshotPrice: number;
  timestamp: string;
  settleAt: number;                 // epoch ms
  serviceDirections: { key: ServiceKey; direction: Direction }[];
  memoryEntryId?: string;
  settled: boolean;
}

export interface SettlementResult {
  huntId: string;
  topic: string;
  coinId: string;
  consensus: Direction;
  snapshotPrice: number;
  settledPrice: number;
  priceChangePct: number;
  actualDirection: Direction;
  correct: boolean;
  settledAt: string;
  serviceResults: { key: ServiceKey; direction: Direction; correct: boolean }[];
}

// ─── Persistence ─────────────────────────────────────────────────────────────

interface SettlementData {
  pending: PendingSettlement[];
  history: SettlementResult[];
}

const store = createStore<SettlementData>({
  filename: "settlements.json",
  defaultValue: { pending: [], history: [] },
  debounceMs: 5000,
});

let pending: PendingSettlement[] = [];
let history: SettlementResult[] = [];
let checkTimer: ReturnType<typeof setInterval> | null = null;

// ─── CoinGecko Price ─────────────────────────────────────────────────────────

async function fetchPrice(coinId: string): Promise<number> {
  try {
    const res = await fetchWithRetry(
      `${COINGECKO_SIMPLE}?ids=${coinId}&vs_currencies=usd`,
      undefined,
      { timeoutMs: 5000, retries: 2 },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as Record<string, { usd?: number }>;
    return data[coinId]?.usd ?? 0;
  } catch (err) {
    log.warn("price fetch failed", { coinId, error: (err as Error).message });
    return 0;
  }
}

/** Extract CoinGecko coin ID from a topic string */
function topicToCoin(topic: string): string {
  const lower = topic.toLowerCase();
  for (const [keyword, coinId] of Object.entries(TOPIC_TO_COIN)) {
    if (lower.includes(keyword)) return coinId;
  }
  return "bitcoin"; // default proxy
}

// ─── Public API ──────────────────────────────────────────────────────────────

/** Load persisted settlements from disk. Call once at startup. */
export function loadSettlements(): void {
  store.load();
  const data = store.get();
  pending = data.pending.filter(p => !p.settled);
  history = data.history.slice(-200); // keep last 200
  log.info("settlements loaded", { pending: pending.length, history: history.length });
}

/**
 * Schedule a hunt for settlement. Called after every hunt completes.
 * Fetches current price as snapshot immediately.
 */
export async function scheduleSettlement(opts: {
  huntId: string;
  topic: string;
  consensus: Direction;
  serviceDirections: { key: ServiceKey; direction: Direction }[];
  memoryEntryId?: string;
}): Promise<void> {
  const coinId = topicToCoin(opts.topic);
  const snapshotPrice = await fetchPrice(coinId);

  if (snapshotPrice === 0) {
    log.warn("skipping settlement — no snapshot price", { huntId: opts.huntId, coinId });
    return;
  }

  const entry: PendingSettlement = {
    huntId: opts.huntId,
    topic: opts.topic,
    coinId,
    consensus: opts.consensus,
    snapshotPrice,
    timestamp: new Date().toISOString(),
    settleAt: Date.now() + SETTLEMENT_DELAY_MS,
    serviceDirections: opts.serviceDirections,
    memoryEntryId: opts.memoryEntryId,
    settled: false,
  };

  pending.push(entry);
  save();

  log.info("settlement scheduled", {
    huntId: opts.huntId,
    coinId,
    snapshotPrice,
    settleIn: `${Math.round(SETTLEMENT_DELAY_MS / 60_000)}min`,
  });
}

/** Settle a single hunt by comparing current price to snapshot. */
async function settleOne(entry: PendingSettlement): Promise<SettlementResult | null> {
  const currentPrice = await fetchPrice(entry.coinId);
  if (currentPrice === 0) {
    log.warn("settlement deferred — no current price", { huntId: entry.huntId });
    entry.settleAt = Date.now() + 60_000; // retry in 1 min
    return null;
  }

  const changePct = ((currentPrice - entry.snapshotPrice) / entry.snapshotPrice) * 100;

  let actualDirection: Direction;
  if (changePct > MIN_PRICE_MOVE_PCT) actualDirection = "bullish";
  else if (changePct < -MIN_PRICE_MOVE_PCT) actualDirection = "bearish";
  else actualDirection = "neutral";

  const consensusCorrect =
    entry.consensus === actualDirection ||
    (actualDirection === "neutral"); // neutral = nobody wrong

  // Settle each service's direction
  const serviceResults = entry.serviceDirections.map(({ key, direction }) => ({
    key,
    direction,
    correct: direction === actualDirection || actualDirection === "neutral",
  }));

  // Update reputation via the reputation module
  const { updateReputationFromSettlement } = await import("./reputation.js");
  updateReputationFromSettlement(serviceResults);

  // Auto-verify memory entry
  if (entry.memoryEntryId) {
    verifyEntry(entry.memoryEntryId, consensusCorrect ? "correct" : "incorrect");
  }

  entry.settled = true;

  const result: SettlementResult = {
    huntId: entry.huntId,
    topic: entry.topic,
    coinId: entry.coinId,
    consensus: entry.consensus,
    snapshotPrice: entry.snapshotPrice,
    settledPrice: currentPrice,
    priceChangePct: parseFloat(changePct.toFixed(3)),
    actualDirection,
    correct: consensusCorrect,
    settledAt: new Date().toISOString(),
    serviceResults,
  };

  history.push(result);
  if (history.length > 200) history = history.slice(-200);

  log.info("hunt settled", {
    huntId: entry.huntId,
    snapshot: entry.snapshotPrice,
    current: currentPrice,
    changePct: changePct.toFixed(3),
    actualDirection,
    consensus: entry.consensus,
    correct: consensusCorrect,
  });

  return result;
}

/** Check all pending settlements and settle those past their deadline. */
async function checkSettlements(): Promise<void> {
  const now = Date.now();
  const due = pending.filter(p => !p.settled && p.settleAt <= now);

  for (const entry of due) {
    await settleOne(entry);
  }

  // Clean up settled entries from pending
  pending = pending.filter(p => !p.settled);
  save();
}

function save(): void {
  store.set({ pending, history });
}

/** Start periodic settlement checks. */
export function startSettlementLoop(): void {
  if (checkTimer) return;
  checkTimer = setInterval(() => {
    checkSettlements().catch(err => {
      log.error("settlement check failed", { error: (err as Error).message });
    });
  }, 30_000); // check every 30s
  checkTimer.unref();
  log.info("settlement loop started", { checkIntervalMs: 30_000, delayMs: SETTLEMENT_DELAY_MS });
}

export function stopSettlementLoop(): void {
  if (checkTimer) {
    clearInterval(checkTimer);
    checkTimer = null;
  }
}

// ─── Getters ─────────────────────────────────────────────────────────────────

export function getPendingSettlements(): PendingSettlement[] {
  return pending;
}

export function getSettlementHistory(limit = 20): SettlementResult[] {
  return history.slice(-limit).reverse();
}

export function getSettlementStats(): {
  pending: number;
  settled: number;
  accuracy: number;
  avgPriceMove: number;
} {
  const settled = history.length;
  const correct = history.filter(h => h.correct).length;
  const avgMove = settled > 0
    ? history.reduce((sum, h) => sum + Math.abs(h.priceChangePct), 0) / settled
    : 0;

  return {
    pending: pending.length,
    settled,
    accuracy: settled > 0 ? parseFloat((correct / settled * 100).toFixed(1)) : 0,
    avgPriceMove: parseFloat(avgMove.toFixed(3)),
  };
}
