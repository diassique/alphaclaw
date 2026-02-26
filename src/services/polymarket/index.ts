import { createService } from "../../lib/service-factory.js";
import { ApiCache } from "../../lib/cache.js";
import { fetchWithRetry } from "../../lib/fetch-retry.js";
import { validateString, validateInt } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import type { PolymarketMarket, AlphaOpportunity, AlphaSignal } from "../../types/index.js";

const cache = new ApiCache<PolymarketMarket[]>();
const CACHE_TTL = 60_000;

const { app, log, start } = createService({
  name: "polymarket",
  displayName: "polymarket-alpha-scanner",
  port: config.ports.polymarket,
  routes: {
    "POST /scan": {
      price: "$0.02",
      description: "Scan Polymarket for mispriced prediction markets — alpha opportunities",
    },
  },
  healthExtra: () => ({ cacheAge: cache.age("markets:all:50") }),
});

// ─── Polymarket API ──────────────────────────────────────────────────────────

const GAMMA_API = "https://gamma-api.polymarket.com";

async function fetchMarkets(limit: number, filter?: string): Promise<{ markets: PolymarketMarket[]; cached: boolean; cacheAge?: number }> {
  const cacheKey = `markets:${filter || "all"}:${limit}`;

  if (cache.isFresh(cacheKey)) {
    return { markets: cache.get(cacheKey)!, cached: true, cacheAge: cache.age(cacheKey) };
  }

  try {
    const res = await fetchWithRetry(
      `${GAMMA_API}/markets?limit=${limit}&active=true&closed=false&order=volume&ascending=false`,
      undefined,
      { timeoutMs: 8000, retries: 2 },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as PolymarketMarket[] | { data?: PolymarketMarket[]; markets?: PolymarketMarket[] };
    const markets = Array.isArray(data) ? data : (data.data ?? data.markets ?? []);
    cache.set(cacheKey, markets, CACHE_TTL);
    log.info("fetched live markets", { count: markets.length });
    return { markets, cached: false };
  } catch (err) {
    log.warn("API fetch failed", { error: (err as Error).message });
  }

  if (cache.has(cacheKey)) {
    log.warn("returning stale cache", { cacheAge: cache.age(cacheKey) });
    return { markets: cache.get(cacheKey)!, cached: true, cacheAge: cache.age(cacheKey) };
  }

  throw new Error("API_UNAVAILABLE");
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreMarket(market: PolymarketMarket): AlphaOpportunity {
  const volume = parseFloat(String(market.volume ?? market.volumeNum ?? "0"));

  let yesPrice = 0.5;
  try {
    const raw = market.outcomePrices;
    const prices: number[] = typeof raw === "string" ? JSON.parse(raw) : (raw ?? [0.5, 0.5]);
    yesPrice = parseFloat(String(prices[0])) || 0.5;
  } catch { /* keep default */ }

  const distFromHalf = Math.abs(yesPrice - 0.5);
  const isHighVolume = volume > 1_000_000;
  const isNear50     = distFromHalf < 0.15;
  const isMedium     = distFromHalf < 0.25;

  let alphaSignal: AlphaSignal;
  let reason: string;
  if (isHighVolume && isNear50) {
    alphaSignal = "HIGH";
    reason = "High-volume market near 50/50 — strong sentiment divergence likely";
  } else if (isMedium || (isHighVolume && !isNear50)) {
    alphaSignal = "MEDIUM";
    reason = "Moderate opportunity — monitor for momentum shift";
  } else {
    alphaSignal = "LOW";
    reason = "Clear consensus — limited alpha unless new catalyst emerges";
  }

  return {
    question: String(market.question ?? market.title ?? ""),
    yesPrice: parseFloat(yesPrice.toFixed(3)),
    noPrice:  parseFloat((1 - yesPrice).toFixed(3)),
    volume24h: volume,
    endDate: market.endDate ?? market.endDateIso,
    alphaSignal,
    reason,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

const SIGNAL_ORDER: Record<AlphaSignal, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

app.post("/scan", async (req, res) => {
  const filter = validateString(req, res, "filter", { maxLen: 200 });
  if (filter === null) return;
  const limit = validateInt(req, res, "limit", { min: 1, max: 50, defaultVal: 20 });
  if (limit === null) return;

  try {
    const { markets, cached, cacheAge } = await fetchMarkets(Math.min(limit * 3, 50), filter || undefined);

    const opportunities: AlphaOpportunity[] = markets
      .filter((m) => m.active !== false && m.question)
      .map(scoreMarket)
      .filter((o) => !filter || o.question.toLowerCase().includes(filter.toLowerCase()))
      .sort((a, b) => SIGNAL_ORDER[b.alphaSignal] - SIGNAL_ORDER[a.alphaSignal])
      .slice(0, limit);

    const topSignal = opportunities[0]?.alphaSignal ?? "NONE";
    const highCount = opportunities.filter((o) => o.alphaSignal === "HIGH").length;
    const hasVolume = opportunities.some((o) => o.volume24h > 0);

    // Confidence staking score
    const highRatio = opportunities.length > 0 ? highCount / opportunities.length : 0;
    const confidenceScore = Math.min(1, highRatio * 0.5 + (hasVolume ? 0.2 : 0) + (cached ? 0 : 0.15) + Math.min(opportunities.length / 20, 1) * 0.15);
    const confidenceBasis = `${highCount} HIGH signals, ${opportunities.length} markets, ${cached ? "cached" : "fresh"}`;

    log.info("scan", { total: opportunities.length, highCount, cached, confidenceScore: confidenceScore.toFixed(3) });

    res.json({
      service: "polymarket-alpha-scanner",
      timestamp: new Date().toISOString(),
      result: {
        opportunities,
        total: opportunities.length,
        topSignal,
        highSignalCount: highCount,
        confidenceScore: parseFloat(confidenceScore.toFixed(3)),
        confidenceBasis,
        summary: `Found ${highCount} HIGH-alpha markets out of ${opportunities.length} scanned`,
      },
      ...(cached ? { cached: true, cacheAge } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message;
    log.error("scan failed", { error: msg });
    res.status(502).json({
      service: "polymarket-alpha-scanner",
      timestamp: new Date().toISOString(),
      error: "Polymarket API unavailable",
      code: "API_UNAVAILABLE",
      cached: false,
    });
  }
});

start();
