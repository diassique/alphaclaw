import { createService } from "../../lib/service-factory.js";
import { ApiCache } from "../../lib/cache.js";
import { fetchWithRetry } from "../../lib/fetch-retry.js";
import { validateString, validateInt } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import type { CoinGeckoToken, ScoredToken, AlphaLevel } from "../../types/index.js";

const cache = new ApiCache<CoinGeckoToken[]>();
const CACHE_TTL = 60_000;

const { app, log, start } = createService({
  name: "defi",
  displayName: "defi-alpha-scanner",
  port: config.ports.defi,
  routes: {
    "POST /scan": {
      price: "$0.015",
      description: "Scan DeFi markets for alpha — momentum, yield, and arbitrage signals",
    },
  },
  healthExtra: () => ({
    cacheAge: {
      defi: cache.age("defi"),
      "top-crypto": cache.age("top-crypto"),
    },
  }),
});

// ─── CoinGecko API ──────────────────────────────────────────────────────────

const COINGECKO_API = "https://api.coingecko.com/api/v3";

async function fetchTokens(category: string): Promise<{ tokens: CoinGeckoToken[]; cached: boolean; cacheAge?: number }> {
  const cacheKey = category === "defi" ? "defi" : "top-crypto";

  if (cache.isFresh(cacheKey)) {
    return { tokens: cache.get(cacheKey)!, cached: true, cacheAge: cache.age(cacheKey) };
  }

  try {
    const catParam = category === "defi" ? "&category=decentralized-finance-defi" : "";
    const perPage = category === "defi" ? 100 : 50;
    const url =
      `${COINGECKO_API}/coins/markets` +
      `?vs_currency=usd&order=market_cap_desc&per_page=${perPage}&page=1` +
      `&sparkline=false&price_change_percentage=1h,24h,7d` +
      catParam;

    const res = await fetchWithRetry(url, undefined, { timeoutMs: 8000, retries: 2 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const tokens = await res.json() as CoinGeckoToken[];
    cache.set(cacheKey, tokens, CACHE_TTL);
    log.info("fetched live tokens", { category: cacheKey, count: tokens.length });
    return { tokens, cached: false };
  } catch (err) {
    log.warn("API fetch failed", { error: (err as Error).message, category: cacheKey });
  }

  if (cache.has(cacheKey)) {
    log.warn("returning stale cache", { category: cacheKey, cacheAge: cache.age(cacheKey) });
    return { tokens: cache.get(cacheKey)!, cached: true, cacheAge: cache.age(cacheKey) };
  }

  throw new Error("API_UNAVAILABLE");
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

function scoreToken(token: CoinGeckoToken): ScoredToken {
  const change1h  = token.price_change_percentage_1h_in_currency  ?? 0;
  const change24h = token.price_change_percentage_24h             ?? 0;
  const change7d  = token.price_change_percentage_7d_in_currency  ?? 0;
  const volumeToMcap = token.total_volume / (token.market_cap || 1);

  let score = 0;

  if (change1h  > 2)  score += 2;
  if (change24h > 8)  score += 3;
  else if (change24h > 4) score += 2;
  else if (change24h > 1) score += 1;
  if (change7d  > 20) score += 3;
  else if (change7d  > 10) score += 2;
  else if (change7d  > 5)  score += 1;

  if (volumeToMcap > 0.1)  score += 3;
  else if (volumeToMcap > 0.05) score += 1;

  if (change24h < -5) score -= 3;

  const alphaLevel: AlphaLevel = score >= 7 ? "HOT" : score >= 4 ? "WARM" : "COOL";
  const suggestedAction =
    score >= 7 && change24h > 5  ? "MOMENTUM ENTRY — strong multi-timeframe trend" :
    score >= 4                    ? "WATCH CLOSELY — building momentum" :
    change24h < -5                ? "POTENTIAL REVERSAL — dip opportunity?" :
                                    "HOLD / MONITOR";

  return {
    id:     token.id,
    symbol: token.symbol.toUpperCase(),
    name:   token.name,
    price:  token.current_price,
    change1h:  parseFloat(change1h.toFixed(2)),
    change24h: parseFloat(change24h.toFixed(2)),
    change7d:  parseFloat(change7d.toFixed(2)),
    volumeToMcap: parseFloat((volumeToMcap * 100).toFixed(2)) + "%",
    alphaScore: score,
    alphaLevel,
    suggestedAction,
  };
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post("/scan", async (req, res) => {
  const asset = validateString(req, res, "asset", { maxLen: 200 });
  if (asset === null) return;
  const category = validateString(req, res, "category", { maxLen: 50, defaultVal: "top" });
  if (category === null) return;
  const limit = validateInt(req, res, "limit", { min: 1, max: 50, defaultVal: 10 });
  if (limit === null) return;

  try {
    const { tokens, cached, cacheAge } = await fetchTokens(category);

    const opportunities: ScoredToken[] = tokens
      .filter((t) =>
        !asset ||
        t.symbol?.toLowerCase() === asset.toLowerCase() ||
        t.name?.toLowerCase().includes(asset.toLowerCase())
      )
      .map(scoreToken)
      .sort((a, b) => b.alphaScore - a.alphaScore)
      .slice(0, limit);

    const topOpportunity = opportunities[0] ?? null;
    const hotCount = opportunities.filter((o) => o.alphaLevel === "HOT").length;

    log.info("scan", { category, total: opportunities.length, hotCount, cached });

    res.json({
      service: "defi-alpha-scanner",
      timestamp: new Date().toISOString(),
      result: {
        opportunities,
        total: opportunities.length,
        topOpportunity,
        hotCount,
        summary: topOpportunity
          ? `Top pick: ${topOpportunity.symbol} (${topOpportunity.alphaLevel}) — ${topOpportunity.suggestedAction}`
          : "No significant opportunities detected",
      },
      ...(cached ? { cached: true, cacheAge } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message;
    log.error("scan failed", { error: msg });
    res.status(502).json({
      service: "defi-alpha-scanner",
      timestamp: new Date().toISOString(),
      error: "CoinGecko API unavailable",
      code: "API_UNAVAILABLE",
      cached: false,
    });
  }
});

start();
