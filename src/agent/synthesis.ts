import type {
  AlphaSynthesis,
  SentimentResult,
  PolymarketResult,
  DefiResult,
  NewsResult,
  WhaleResult,
} from "../types/index.js";

export function synthesizeAlpha({
  sentimentResult,
  polymarketResult,
  defiResult,
  newsResult,
  whaleResult,
  warnings,
}: {
  sentimentResult: { result?: SentimentResult } | null;
  polymarketResult: { result?: PolymarketResult } | null;
  defiResult: { result?: DefiResult } | null;
  newsResult: { result?: NewsResult } | null;
  whaleResult: { result?: WhaleResult } | null;
  warnings?: string[];
}): AlphaSynthesis {
  const sentiment  = sentimentResult?.result as SentimentResult | undefined;
  const polymarket = polymarketResult?.result as PolymarketResult | undefined;
  const defi       = defiResult?.result as DefiResult | undefined;
  const news       = newsResult?.result as NewsResult | undefined;
  const whale      = whaleResult?.result as WhaleResult | undefined;

  let confidence = 0;
  const signals: string[] = [];

  if (sentiment) {
    const s = sentiment.label;
    if (s === "strongly_bullish") { confidence += 25; signals.push("sentiment:strongly_bullish"); }
    else if (s === "bullish")     { confidence += 15; signals.push("sentiment:bullish"); }
    else if (s === "neutral")     { confidence +=  8; signals.push("sentiment:neutral"); }
    else if (s === "bearish")     { confidence +=  3; signals.push("sentiment:bearish"); }
  }

  if (polymarket) {
    if (polymarket.topSignal === "HIGH")   { confidence += 25; signals.push("polymarket:HIGH_ALPHA"); }
    if (polymarket.topSignal === "MEDIUM") { confidence += 12; signals.push("polymarket:MEDIUM_ALPHA"); }
  }

  if (defi) {
    if (defi.topOpportunity?.alphaLevel === "HOT")  { confidence += 20; signals.push(`defi:HOT(${defi.topOpportunity.symbol})`); }
    if (defi.topOpportunity?.alphaLevel === "WARM") { confidence += 10; signals.push(`defi:WARM(${defi.topOpportunity.symbol})`); }
  }

  if (whale) {
    if (whale.signal === "ACCUMULATION") { confidence += 20; signals.push("whale:ACCUMULATION"); }
    if (whale.signal === "WATCH")        { confidence += 8;  signals.push("whale:WATCH"); }
    if (whale.whaleCount >= 2)           { confidence += 5;  signals.push(`whale:${whale.whaleCount}_whales`); }
  }

  if (news && news.articles?.length > 0) {
    confidence += 5;
    signals.push(`news:${news.articles.length}_articles`);
  }

  const recommendation =
    confidence >= 75 ? "STRONG BUY SIGNAL — multiple confirming indicators" :
    confidence >= 55 ? "MODERATE OPPORTUNITY — proceed with position sizing" :
    confidence >= 35 ? "WATCH CLOSELY — early signals forming" :
                       "WAIT — insufficient signal strength";

  const topDefi = defi?.topOpportunity;
  const topPoly = polymarket?.opportunities?.[0];
  const topNews = news?.articles?.[0];

  return {
    confidence: `${Math.min(confidence, 100)}%`,
    recommendation,
    signals,
    ...(warnings && warnings.length > 0 ? { warnings } : {}),
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
