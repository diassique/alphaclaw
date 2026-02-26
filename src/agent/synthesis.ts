import type {
  AlphaSynthesis,
  SentimentResult,
  PolymarketResult,
  DefiResult,
  NewsResult,
  WhaleResult,
  ServiceKey,
  StakingSummary,
  ReputationSnapshot,
  DynamicPrice,
  CompetitionResult,
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

export function synthesizeAlpha({
  huntId,
  sentimentResult,
  polymarketResult,
  defiResult,
  newsResult,
  whaleResult,
  warnings,
  competitionResult,
}: {
  huntId: string;
  sentimentResult: { result?: SentimentResult } | null;
  polymarketResult: { result?: PolymarketResult } | null;
  defiResult: { result?: DefiResult } | null;
  newsResult: { result?: NewsResult } | null;
  whaleResult: { result?: WhaleResult } | null;
  warnings?: string[];
  competitionResult?: CompetitionResult;
}): AlphaSynthesis {
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

  // Settle staking
  const stakingSummary: StakingSummary = settleHunt(huntId, entries, consensus);
  const reputationSnapshot: ReputationSnapshot = getReputationSnapshot();

  // ─── Weighted scoring ───────────────────────────────────────────────────

  // Signal strength per service (0–1 scale)
  const signalStrengths: Record<ServiceKey, number> = {
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

  // Weighted confidence: weight = signal_strength * confidence * reputation
  let totalWeight = 0;
  let maxPossibleWeight = 0;

  for (const { key, confidenceScore } of entries) {
    const rep = getReputation(key).score;
    const strength = signalStrengths[key];
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

  const confidence = Math.min(Math.round(weightedConfidence), 100);

  const recommendation =
    confidence >= 75 ? "STRONG BUY SIGNAL — multiple confirming indicators" :
    confidence >= 55 ? "MODERATE OPPORTUNITY — proceed with position sizing" :
    confidence >= 35 ? "WATCH CLOSELY — early signals forming" :
                       "WAIT — insufficient signal strength";

  const topDefi = defi?.topOpportunity;
  const topPoly = polymarket?.opportunities?.[0];
  const topNews = news?.articles?.[0];

  const dynamicPricing: DynamicPrice[] = getAllDynamicPrices();

  return {
    confidence: `${confidence}%`,
    weightedConfidence,
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
    },
  };
}
