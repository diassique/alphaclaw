import { createService } from "../../lib/service-factory.js";
import { ApiCache } from "../../lib/cache.js";
import { fetchWithRetry } from "../../lib/fetch-retry.js";
import { validateString, validateInt } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import { callLLMJson, isLLMEnabled } from "../../lib/llm.js";
import type { NewsArticle, CryptoPanicResponse } from "../../types/index.js";

const cache = new ApiCache<NewsArticle[]>();
const CACHE_TTL = 300_000; // 5 min

const { app, log, start } = createService({
  name: "news",
  displayName: "news-agent",
  port: config.ports.news,
  routes: {
    "POST /news": {
      price: "$0.001",
      description: "Fresh news articles for a prediction market topic",
    },
  },
  healthExtra: () => ({ configured: !!config.cryptoPanicToken }),
});

// ─── CryptoPanic API ────────────────────────────────────────────────────────

const CRYPTOPANIC_API = "https://cryptopanic.com/api/developer/v2/posts/";

async function fetchCryptoPanic(topic: string, limit: number): Promise<{ articles: NewsArticle[]; cached: boolean; cacheAge?: number }> {
  const cacheKey = `news:${topic}`;

  if (cache.isFresh(cacheKey)) {
    const articles = cache.get(cacheKey)!.slice(0, limit);
    return { articles, cached: true, cacheAge: cache.age(cacheKey) };
  }

  try {
    const params = new URLSearchParams({
      auth_token: config.cryptoPanicToken,
      currencies: topic,
      filter: "hot",
      kind: "news",
      public: "true",
    });

    const res = await fetchWithRetry(
      `${CRYPTOPANIC_API}?${params}`,
      undefined,
      { timeoutMs: 8000, retries: 2 },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json() as CryptoPanicResponse;
    const articles: NewsArticle[] = (data.results ?? []).map((p) => ({
      title: p.title,
      description: p.description ?? p.metadata?.description ?? "",
      publishedAt: p.published_at,
      source: p.source?.title ?? p.source?.domain ?? "Unknown",
      url: p.original_url ?? p.url,
    }));

    cache.set(cacheKey, articles, CACHE_TTL);
    log.info("fetched live news", { topic, count: articles.length });
    return { articles: articles.slice(0, limit), cached: false };
  } catch (err) {
    log.warn("API fetch failed", { error: (err as Error).message, topic });
  }

  if (cache.has(cacheKey)) {
    log.warn("returning stale cache", { topic, cacheAge: cache.age(cacheKey) });
    const articles = cache.get(cacheKey)!.slice(0, limit);
    return { articles, cached: true, cacheAge: cache.age(cacheKey) };
  }

  throw new Error("API_UNAVAILABLE");
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post("/news", async (req, res) => {
  if (!config.cryptoPanicToken) {
    res.status(503).json({
      service: "news-agent",
      timestamp: new Date().toISOString(),
      error: "News service not configured — set CRYPTOPANIC_TOKEN env var",
      code: "NOT_CONFIGURED",
    });
    return;
  }

  const topic = validateString(req, res, "topic", { required: true, maxLen: 200 });
  if (topic === null) return;
  const limit = validateInt(req, res, "limit", { min: 1, max: 20, defaultVal: 5 });
  if (limit === null) return;

  try {
    const { articles, cached, cacheAge } = await fetchCryptoPanic(topic, limit);

    // AI summarization of articles
    let aiSummary: { sentiment: string; impact: string; keyEvent: string; relevance: number } | undefined;
    if (isLLMEnabled() && articles.length > 0) {
      const headlines = articles.slice(0, 8).map((a, i) => `${i + 1}. ${a.title}`).join("\n");
      const ai = await callLLMJson<{ sentiment: string; impact: string; keyEvent: string; relevance: number }>(
        `You are a crypto news analyst. Analyze these headlines about "${topic}":

${headlines}

Return ONLY valid JSON:
{"sentiment":"bullish|bearish|neutral|mixed","impact":"high|medium|low","keyEvent":"<most important event in 15 words>","relevance":<0.0-1.0 how relevant to ${topic}>}`,
        128,
      );
      if (ai) {
        aiSummary = ai;
        log.info("news AI summary", { sentiment: ai.sentiment, impact: ai.impact });
      }
    }

    // Confidence staking score — AI-enhanced when available
    const recencyBonus = articles.length > 0 && articles[0]
      ? Math.max(0, 1 - (Date.now() - new Date(articles[0].publishedAt).getTime()) / 3_600_000)
      : 0;
    const aiRelevanceBonus = aiSummary ? aiSummary.relevance * 0.2 : 0;
    const aiImpactBonus = aiSummary?.impact === "high" ? 0.15 : aiSummary?.impact === "medium" ? 0.08 : 0;
    const confidenceScore = Math.min(1,
      Math.min(articles.length / 5, 1) * 0.4
      + recencyBonus * 0.2
      + (cached ? 0 : 0.05)
      + aiRelevanceBonus
      + aiImpactBonus,
    );
    const confidenceBasis = aiSummary
      ? `AI: ${aiSummary.sentiment}/${aiSummary.impact}, ${articles.length} articles, relevance ${aiSummary.relevance}`
      : `${articles.length} articles, recency ${recencyBonus.toFixed(2)}, ${cached ? "cached" : "fresh"}`;

    log.info("news", { topic, count: articles.length, cached, confidenceScore: confidenceScore.toFixed(3) });

    res.json({
      service: "news-agent",
      timestamp: new Date().toISOString(),
      result: {
        topic,
        articles,
        count: articles.length,
        confidenceScore: parseFloat(confidenceScore.toFixed(3)),
        confidenceBasis,
        source: "cryptopanic",
        ...(aiSummary ? { aiSummary } : {}),
      },
      ...(cached ? { cached: true, cacheAge } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message;
    log.error("news fetch failed", { error: msg, topic });
    res.status(502).json({
      service: "news-agent",
      timestamp: new Date().toISOString(),
      error: "News API unavailable",
      code: "API_UNAVAILABLE",
      cached: false,
    });
  }
});

if (!config.cryptoPanicToken) {
  log.warn("CRYPTOPANIC_TOKEN not set — /news will return NOT_CONFIGURED");
}

start();
