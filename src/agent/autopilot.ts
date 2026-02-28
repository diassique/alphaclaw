import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger.js";
import { createStore } from "../lib/store.js";
import { config } from "../config/env.js";
import { callAllServices } from "./orchestrator.js";
import { synthesizeAlpha } from "./synthesis.js";
import { generateReportId, cacheReport } from "./report-cache.js";
import { recordHunt } from "./memory.js";
import { getCircuitSnapshot } from "./circuit-breaker.js";
import { getEffectivePrice } from "../config/services.js";
import { walletClient } from "./wallet.js";
import { notifyHuntResult } from "./telegram.js";
import { notifyMoltbookHuntResult } from "./moltbook.js";
import { generateAlphaNarrative, isClaudeEnabled } from "./claude.js";
import type {
  AutopilotPhase,
  AutopilotStatus,
  AdaptationRecord,
  SentimentResult,
  PolymarketResult,
  DefiResult,
  NewsResult,
  WhaleResult,
  CachedReport,
  PaymentLog,
} from "../types/index.js";

const log = createLogger("autopilot");

// ─── Persistence ────────────────────────────────────────────────────────────

interface AutopilotData {
  currentIntervalMs: number;
  huntCount: number;
  topicIndex: number;
  adaptations: AdaptationRecord[];
}

const store = createStore<AutopilotData>({
  filename: "autopilot.json",
  defaultValue: {
    currentIntervalMs: config.autopilot.baseIntervalMs,
    huntCount: 0,
    topicIndex: 0,
    adaptations: [],
  },
  debounceMs: 5000,
});

function saveToStore(): void {
  store.set({
    currentIntervalMs,
    huntCount,
    topicIndex,
    adaptations: adaptations.slice(-50),
  });
}

/** Load persisted autopilot state. Does NOT restore running — autopilot must be explicitly started. */
export function loadAutopilot(): void {
  store.load();
  const data = store.get();
  currentIntervalMs = data.currentIntervalMs || config.autopilot.baseIntervalMs;
  huntCount = data.huntCount || 0;
  topicIndex = data.topicIndex || 0;
  adaptations.length = 0;
  adaptations.push(...(data.adaptations ?? []));
  log.info("autopilot state loaded", { huntCount, topicIndex, currentIntervalMs });
}

// ─── State ──────────────────────────────────────────────────────────────────

export const autopilotEmitter = new EventEmitter();
autopilotEmitter.setMaxListeners(50);

let running = false;
let phase: AutopilotPhase = "idle";
let currentIntervalMs = config.autopilot.baseIntervalMs;
let huntCount = 0;
let topicIndex = 0;
let nextHuntAt: Date | null = null;
let lastConfidence: number | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const adaptations: AdaptationRecord[] = [];

function emit(event: string, data: unknown) {
  autopilotEmitter.emit(event, data);
}

function setPhase(p: AutopilotPhase) {
  phase = p;
  emit("autopilot:phase", { phase: p });
}

async function runHunt(): Promise<void> {
  if (!running) return;

  const topics = config.autopilot.topics;
  const topic = topics[topicIndex % topics.length]!;
  topicIndex++;

  setPhase("hunting");
  const huntId = randomUUID().slice(0, 12);
  const ts = new Date().toISOString();

  emit("autopilot:hunting", { huntId, topic, timestamp: ts });
  log.info("autopilot hunt", { huntId, topic, interval: currentIntervalMs });

  try {
    const { news, sentiment, polymarket, defi, whale, external, warnings, competitionResult } = await callAllServices(topic);

    const alpha = await synthesizeAlpha({
      huntId,
      sentimentResult: sentiment?.data as { result?: SentimentResult } | null,
      polymarketResult: polymarket?.data as { result?: PolymarketResult } | null,
      defiResult: defi?.data as { result?: DefiResult } | null,
      newsResult: news?.data as { result?: NewsResult } | null,
      whaleResult: whale?.data as { result?: WhaleResult } | null,
      warnings,
      competitionResult,
      externalResults: external,
    });

    huntCount++;
    lastConfidence = alpha.weightedConfidence;

    // Cache report
    const reportId = generateReportId(topic, ts);
    const dp = alpha.dynamicPricing;
    const priceOf = (svc: string) => dp.find(p => p.service === svc)?.effectivePrice ?? "?";
    const builtinBreakdown = [
      { service: "news-agent", price: priceOf("news"), paid: news?.paid ?? false, txHash: news?.txHash },
      { service: "crypto-sentiment", price: priceOf("sentiment"), paid: sentiment?.paid ?? false, txHash: sentiment?.txHash },
      { service: "polymarket-alpha-scanner", price: priceOf("polymarket"), paid: polymarket?.paid ?? false, txHash: polymarket?.txHash },
      { service: "defi-alpha-scanner", price: priceOf("defi"), paid: defi?.paid ?? false, txHash: defi?.txHash },
      { service: "whale-agent", price: priceOf("whale"), paid: whale?.paid ?? false, txHash: whale?.txHash },
    ];
    for (const [key, resp] of Object.entries(external)) {
      builtinBreakdown.push({ service: key, price: priceOf(key), paid: resp?.paid ?? false, txHash: resp?.txHash });
    }
    const paymentLog: PaymentLog = {
      totalPaid: walletClient ? `${dp.reduce((s, p) => s + parseFloat(p.effectivePrice.replace("$", "")), 0).toFixed(4)} USDC` : "demo mode",
      breakdown: builtinBreakdown,
    };

    // Enrich with Claude narrative if enabled
    if (isClaudeEnabled()) {
      try {
        const narrative = await generateAlphaNarrative({
          topic,
          sentiment: alpha.breakdown.sentiment,
          polymarket: alpha.breakdown.polymarket
            ? { ...alpha.breakdown.polymarket, yesPrice: String(alpha.breakdown.polymarket.yesPrice) }
            : null,
          defi: alpha.breakdown.defi,
          news: alpha.breakdown.news,
          whale: alpha.breakdown.whale,
          confidence: alpha.confidence,
          recommendation: alpha.recommendation,
          consensusStrength: alpha.consensusStrength,
        });
        if (narrative) alpha.narrative = narrative;
      } catch (_) { /* non-critical */ }
    }

    const report: CachedReport = {
      id: reportId,
      topic,
      timestamp: ts,
      createdAt: Date.now(),
      alpha,
      agentPayments: paymentLog,
      stakingSummary: alpha.stakingSummary,
      preview: alpha.narrative?.keyInsight ?? `[autopilot] ${alpha.recommendation} | ${alpha.confidence}`,
    };
    cacheReport(report);

    // Record in memory
    recordHunt({
      topic,
      timestamp: ts,
      signals: alpha.signals,
      confidence: alpha.weightedConfidence,
      recommendation: alpha.recommendation,
    });

    emit("autopilot:result", {
      huntId,
      topic,
      confidence: alpha.weightedConfidence,
      recommendation: alpha.recommendation,
      signals: alpha.signals,
      reportId,
      circuits: getCircuitSnapshot(),
    });

    // Notify Telegram + Moltbook
    notifyHuntResult(topic, alpha, "autopilot").catch(() => {});
    notifyMoltbookHuntResult(report).catch(() => {});

    // Adapt interval
    adaptInterval(alpha.weightedConfidence);

  } catch (err) {
    log.warn("autopilot hunt failed", { error: (err as Error).message });
    emit("autopilot:error", { error: (err as Error).message });
  }

  scheduleNext();
}

function adaptInterval(confidence: number): void {
  setPhase("adapting");
  const oldInterval = currentIntervalMs;
  const { minIntervalMs, maxIntervalMs, baseIntervalMs } = config.autopilot;

  let reason: string;
  if (confidence >= 70) {
    // High confidence → slow down (save money, signals are strong)
    currentIntervalMs = Math.min(maxIntervalMs, Math.round(currentIntervalMs * 1.3));
    reason = "high confidence → slowing";
  } else if (confidence <= 15) {
    // Very low confidence → slight speed-up (conservative: 10% faster, not 30%)
    currentIntervalMs = Math.max(minIntervalMs, Math.round(currentIntervalMs * 0.9));
    reason = "very low confidence → slight speed-up";
  } else if (confidence <= 40) {
    // Moderate-low → drift toward base (no aggressive speed-up)
    currentIntervalMs = Math.max(minIntervalMs, Math.round(currentIntervalMs * 0.95 + baseIntervalMs * 0.05));
    reason = "low confidence → drifting to base";
  } else {
    // 40–70 range → drift toward base
    currentIntervalMs = Math.round(currentIntervalMs * 0.9 + baseIntervalMs * 0.1);
    reason = "moderate confidence → drifting to base";
  }

  // Clamp to bounds
  currentIntervalMs = Math.max(minIntervalMs, Math.min(maxIntervalMs, currentIntervalMs));

  if (oldInterval !== currentIntervalMs) {
    const record: AdaptationRecord = {
      timestamp: new Date().toISOString(),
      oldIntervalMs: oldInterval,
      newIntervalMs: currentIntervalMs,
      confidence,
      reason,
    };
    adaptations.push(record);
    if (adaptations.length > 50) adaptations.shift();

    emit("autopilot:adapted", record);
    log.info("autopilot adapted", { oldInterval, newInterval: currentIntervalMs, confidence });
  }
  saveToStore();
}

function scheduleNext(): void {
  if (!running) return;
  setPhase("waiting");
  nextHuntAt = new Date(Date.now() + currentIntervalMs);
  emit("autopilot:scheduled", { nextHuntAt: nextHuntAt.toISOString(), intervalMs: currentIntervalMs });
  timer = setTimeout(() => runHunt(), currentIntervalMs);
  timer.unref();
}

export function startAutopilot(): AutopilotStatus {
  if (running) return getAutopilotStatus();
  running = true;
  // Resume from persisted state (huntCount, topicIndex, currentIntervalMs, adaptations)
  // Only reset transient UI state
  lastConfidence = null;

  log.info("autopilot started", { interval: currentIntervalMs, topics: config.autopilot.topics });
  emit("autopilot:started", { interval: currentIntervalMs });

  // Run first hunt immediately
  runHunt();

  return getAutopilotStatus();
}

export function stopAutopilot(): AutopilotStatus {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  setPhase("idle");
  nextHuntAt = null;

  log.info("autopilot stopped", { huntCount });
  emit("autopilot:stopped", { huntCount });

  return getAutopilotStatus();
}

export function getAutopilotStatus(): AutopilotStatus {
  return {
    running,
    phase,
    currentIntervalMs,
    huntCount,
    topicIndex,
    nextHuntAt: nextHuntAt?.toISOString() ?? null,
    adaptations: adaptations.slice(-10),
    lastConfidence,
  };
}
