import type {
  AlphaSynthesis,
  SentimentResult,
  PolymarketResult,
  DefiResult,
  NewsResult,
  WhaleResult,
  ServiceKey,
  ServiceResponse,
  StakingSummary,
  ReputationSnapshot,
  DynamicPrice,
  CompetitionResult,
  Direction,
} from "../types/index.js";
import {
  extractConfidence,
  extractDirection,
  computeConsensus,
  settleHunt,
  getReputation,
  getReputationSnapshot,
} from "./reputation.js";
import { getAllDynamicPrices } from "../config/services.js";
import { getConfidenceAdjustment } from "./memory.js";
import { callLLMJson, isLLMEnabled } from "../lib/llm.js";

export async function synthesizeAlpha({
  huntId,
  sentimentResult,
  polymarketResult,
  defiResult,
  newsResult,
  whaleResult,
  warnings,
  competitionResult,
  externalResults,
}: {
  huntId: string;
  sentimentResult: { result?: SentimentResult } | null;
  polymarketResult: { result?: PolymarketResult } | null;
  defiResult: { result?: DefiResult } | null;
  newsResult: { result?: NewsResult } | null;
  whaleResult: { result?: WhaleResult } | null;
  warnings?: string[];
  competitionResult?: CompetitionResult;
  externalResults?: Record<string, ServiceResponse | null>;
}): Promise<AlphaSynthesis> {
  const sentiment  = sentimentResult?.result as SentimentResult | undefined;
  const polymarket = polymarketResult?.result as PolymarketResult | undefined;
  const defi       = defiResult?.result as DefiResult | undefined;
  const news       = newsResult?.result as NewsResult | undefined;
  const whale      = whaleResult?.result as WhaleResult | undefined;

  // Map service key to its raw data wrapper (for direction/confidence extraction)
  const serviceData: { key: ServiceKey; data: unknown }[] = [
    { key: "sentiment",  data: sentimentResult },
    { key: "polymarket", data: polymarketResult },
    { key: "defi",       data: defiResult },
    { key: "news",       data: newsResult },
    { key: "whale",      data: whaleResult },
  ];

  // Include external agents in consensus / staking
  if (externalResults) {
    for (const [key, resp] of Object.entries(externalResults)) {
      if (resp) serviceData.push({ key, data: resp.data });
    }
  }

  // Extract confidence from each service
  const entries = serviceData.map(({ key, data }) => ({
    key,
    data,
    confidenceScore: extractConfidence(data),
  }));

  // Extract directions for consensus
  const directions = serviceData.map(({ key, data }) => ({
    key,
    direction: extractDirection(key, data),
  }));

  const consensus = computeConsensus(directions);

  // Consensus strength: how many services agree on the consensus direction?
  const agreeingServices = directions.filter(d => d.direction === consensus).length;
  const respondingServices = serviceData.filter(d => d.data !== null).length;
  const consensusStrength = respondingServices > 0 ? agreeingServices / respondingServices : 0;

  // Settle staking
  const stakingSummary: StakingSummary = settleHunt(huntId, entries, consensus);
  const reputationSnapshot: ReputationSnapshot = getReputationSnapshot();

  // ─── Weighted scoring ───────────────────────────────────────────────────

  // Signal strength per service (0–1 scale)
  const signalStrengths: Record<string, number> = {
    sentiment: 0,
    sentiment2: 0,
    polymarket: 0,
    defi: 0,
    news: 0,
    whale: 0,
  };

  const signals: string[] = [];

  if (sentiment) {
    const s = sentiment.label;
    if (s === "strongly_bullish") { signalStrengths.sentiment = 1.0;  signals.push("sentiment:strongly_bullish"); }
    else if (s === "bullish")     { signalStrengths.sentiment = 0.7;  signals.push("sentiment:bullish"); }
    else if (s === "neutral")     { signalStrengths.sentiment = 0.3;  signals.push("sentiment:neutral"); }
    else if (s === "bearish")     { signalStrengths.sentiment = 0.5;  signals.push("sentiment:bearish"); }
    else                          { signalStrengths.sentiment = 0.8;  signals.push("sentiment:strongly_bearish"); }
  }

  if (polymarket) {
    if (polymarket.topSignal === "HIGH")   { signalStrengths.polymarket = 1.0; signals.push("polymarket:HIGH_ALPHA"); }
    if (polymarket.topSignal === "MEDIUM") { signalStrengths.polymarket = 0.6; signals.push("polymarket:MEDIUM_ALPHA"); }
  }

  if (defi) {
    if (defi.topOpportunity?.alphaLevel === "HOT")  { signalStrengths.defi = 1.0; signals.push(`defi:HOT(${defi.topOpportunity.symbol})`); }
    if (defi.topOpportunity?.alphaLevel === "WARM") { signalStrengths.defi = 0.6; signals.push(`defi:WARM(${defi.topOpportunity.symbol})`); }
  }

  if (whale) {
    if (whale.signal === "ACCUMULATION") { signalStrengths.whale = 1.0; signals.push("whale:ACCUMULATION"); }
    if (whale.signal === "WATCH")        { signalStrengths.whale = 0.5; signals.push("whale:WATCH"); }
    if (whale.whaleCount >= 2)           { signals.push(`whale:${whale.whaleCount}_whales`); }
  }

  if (news && news.articles?.length > 0) {
    signalStrengths.news = Math.min(news.articles.length / 5, 1);
    signals.push(`news:${news.articles.length}_articles`);
  }

  // External agent signals
  if (externalResults) {
    for (const [key, resp] of Object.entries(externalResults)) {
      if (!resp?.data) continue;
      const extResult = (resp.data as Record<string, unknown>)["result"] as Record<string, unknown> | undefined;
      if (!extResult) continue;

      const dir = extResult["direction"] as string | undefined;
      const conf = typeof extResult["confidenceScore"] === "number" ? extResult["confidenceScore"] as number : 0.3;
      const extSignals = Array.isArray(extResult["signals"]) ? extResult["signals"] as string[] : [];

      // Map direction to signal strength
      if (dir === "bullish") signalStrengths[key] = conf;
      else if (dir === "bearish") signalStrengths[key] = conf;
      else signalStrengths[key] = 0.2;

      signals.push(`${key}:${dir ?? "unknown"}(${(conf * 100).toFixed(0)}%)`);
      for (const s of extSignals.slice(0, 3)) signals.push(`${key}:${s}`);
    }
  }

  // Weighted confidence: weight = signal_strength * confidence * reputation
  let totalWeight = 0;
  let maxPossibleWeight = 0;

  for (const { key, confidenceScore } of entries) {
    const rep = getReputation(key).score;
    const strength = signalStrengths[key] ?? 0;
    totalWeight += strength * confidenceScore * rep;
    maxPossibleWeight += 1.0 * 1.0 * 1.0; // theoretical max
  }

  let weightedConfidence = maxPossibleWeight > 0
    ? parseFloat((totalWeight / maxPossibleWeight * 100).toFixed(1))
    : 0;

  // Apply memory-based adjustment
  const memoryAdj = getConfidenceAdjustment(signals);
  if (memoryAdj.adjustment !== 0) {
    weightedConfidence = parseFloat(Math.max(0, Math.min(100, weightedConfidence + memoryAdj.adjustment)).toFixed(1));
    if (memoryAdj.adjustment > 0) signals.push(`memory:+${memoryAdj.adjustment}`);
    else signals.push(`memory:${memoryAdj.adjustment}`);
  }

  // Consensus penalty: if fewer than 3/5 services agree, reduce confidence
  if (consensusStrength < 0.6 && consensus !== "neutral") {
    const penalty = parseFloat(((0.6 - consensusStrength) * 30).toFixed(1)); // up to -18 pts
    weightedConfidence = parseFloat(Math.max(0, weightedConfidence - penalty).toFixed(1));
    signals.push(`consensus:weak(${agreeingServices}/${respondingServices},-${penalty})`);
  } else if (consensusStrength >= 0.8) {
    signals.push(`consensus:strong(${agreeingServices}/${respondingServices})`);
  }

  const confidence = Math.min(Math.round(weightedConfidence), 100);

  // Static fallback recommendation
  const staticRec =
    confidence >= 75 ? "STRONG BUY SIGNAL — multiple confirming indicators" :
    confidence >= 55 ? "MODERATE OPPORTUNITY — proceed with position sizing" :
    confidence >= 35 ? "WATCH CLOSELY — early signals forming" :
                       "WAIT — insufficient signal strength";

  // AI-powered recommendation that reasons about signal conflicts
  let recommendation = staticRec;
  if (isLLMEnabled()) {
    const signalSummary = [
      sentiment ? `Sentiment: ${sentiment.label} (${sentiment.score})` : null,
      polymarket?.topSignal ? `Polymarket: ${polymarket.topSignal} alpha` : null,
      defi?.topOpportunity ? `DeFi: ${defi.topOpportunity.symbol} ${defi.topOpportunity.alphaLevel} (${defi.topOpportunity.change24h}% 24h)` : null,
      news?.articles?.length ? `News: ${news.articles.length} articles` : null,
      whale ? `Whale: ${whale.signal} (${whale.whaleCount} whales)` : null,
    ].filter(Boolean).join(", ");

    const ai = await callLLMJson<{ recommendation: string }>(
      `You are AlphaClaw, a crypto alpha agent. Generate a 1-sentence actionable trading recommendation.

Signals: ${signalSummary}
Consensus: ${consensus} (${(consensusStrength * 100).toFixed(0)}% agree)
Confidence: ${confidence}%

If signals conflict (e.g. sentiment bearish but whales accumulating), note the contrarian opportunity.
If signals align, be direct about the opportunity.
Keep it under 100 chars. Be specific to the data, not generic.

Return ONLY valid JSON: {"recommendation":"<your recommendation>"}`,
      96,
    );
    if (ai?.recommendation) recommendation = ai.recommendation;
  }

  const topDefi = defi?.topOpportunity;
  const topPoly = polymarket?.opportunities?.[0];
  const topNews = news?.articles?.[0];

  const dynamicPricing: DynamicPrice[] = getAllDynamicPrices();

  return {
    confidence: `${confidence}%`,
    weightedConfidence,
    consensusStrength: parseFloat(consensusStrength.toFixed(2)),
    recommendation,
    signals,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
    stakingSummary,
    reputationSnapshot,
    dynamicPricing,
    ...(competitionResult ? { competitionResult } : {}),
    breakdown: {
      sentiment: sentiment
        ? { label: sentiment.label, score: sentiment.score, confidence: sentiment.confidence }
        : null,
      polymarket: topPoly
        ? { market: topPoly.question, signal: topPoly.alphaSignal, yesPrice: topPoly.yesPrice }
        : null,
      defi: topDefi
        ? { asset: topDefi.symbol, action: topDefi.suggestedAction, change24h: `${topDefi.change24h}%` }
        : null,
      news: topNews
        ? { topHeadline: topNews.title, articleCount: news!.count }
        : null,
      whale: whale
        ? { signal: whale.signal, whaleCount: whale.whaleCount, totalVolume: whale.totalVolumeUSD }
        : null,
      ...(externalResults && Object.keys(externalResults).length > 0
        ? { external: buildExternalBreakdown(externalResults) }
        : {}),
    },
  };
}

function buildExternalBreakdown(
  externalResults: Record<string, ServiceResponse | null>,
): Record<string, { direction: Direction; confidence: number; signals: string[] } | null> {
  const breakdown: Record<string, { direction: Direction; confidence: number; signals: string[] } | null> = {};
  for (const [key, resp] of Object.entries(externalResults)) {
    if (!resp?.data) {
      breakdown[key] = null;
      continue;
    }
    const extResult = (resp.data as Record<string, unknown>)["result"] as Record<string, unknown> | undefined;
    if (!extResult) {
      breakdown[key] = null;
      continue;
    }
    const dir = extResult["direction"] as Direction | undefined;
    const conf = typeof extResult["confidenceScore"] === "number" ? extResult["confidenceScore"] as number : 0;
    const sigs = Array.isArray(extResult["signals"]) ? extResult["signals"] as string[] : [];
    breakdown[key] = {
      direction: dir ?? "neutral",
      confidence: conf,
      signals: sigs,
    };
  }
  return breakdown;
}
