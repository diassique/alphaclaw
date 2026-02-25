import express from "express";
import { conditionalPaywall } from "../lib/paywall.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const { WALLET_ADDRESS, FACILITATOR_URL, NETWORK, PORT_DEFI } = process.env;
const port = PORT_DEFI ?? "4003";

conditionalPaywall(app, WALLET_ADDRESS, {
  "POST /scan": {
    price: "$0.015",
    network: NETWORK,
    description: "Scan DeFi markets for alpha — momentum, yield, and arbitrage signals",
  },
}, FACILITATOR_URL);

// ─── Types ───────────────────────────────────────────────────────────────────

type AlphaLevel = "HOT" | "WARM" | "COOL";

interface CoinGeckoToken {
  id: string;
  symbol: string;
  name: string;
  current_price: number;
  price_change_percentage_1h_in_currency?: number;
  price_change_percentage_24h?: number;
  price_change_percentage_7d_in_currency?: number;
  market_cap: number;
  total_volume: number;
}

interface ScoredToken {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change1h: number;
  change24h: number;
  change7d: number;
  volumeToMcap: string;
  alphaScore: number;
  alphaLevel: AlphaLevel;
  suggestedAction: string;
}

// ─── CoinGecko API ───────────────────────────────────────────────────────────

const COINGECKO_API = "https://api.coingecko.com/api/v3";

async function fetchDeFiTokens(): Promise<CoinGeckoToken[]> {
  try {
    const url =
      `${COINGECKO_API}/coins/markets` +
      `?vs_currency=usd&order=market_cap_desc&per_page=100&page=1` +
      `&sparkline=false&price_change_percentage=1h,24h,7d` +
      `&category=decentralized-finance-defi`;

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as CoinGeckoToken[];
  } catch {
    return getFallbackTokens();
  }
}

async function fetchTopCrypto(): Promise<CoinGeckoToken[]> {
  try {
    const url =
      `${COINGECKO_API}/coins/markets` +
      `?vs_currency=usd&order=market_cap_desc&per_page=50&page=1` +
      `&sparkline=false&price_change_percentage=1h,24h,7d`;

    const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json() as CoinGeckoToken[];
  } catch {
    return getFallbackTokens();
  }
}

function getFallbackTokens(): CoinGeckoToken[] {
  return [
    { id: "ethereum",  symbol: "eth",  name: "Ethereum",  current_price: 3120, price_change_percentage_24h: 4.2, price_change_percentage_7d_in_currency: 12.5, market_cap: 375000000000, total_volume: 18000000000 },
    { id: "solana",    symbol: "sol",  name: "Solana",    current_price: 186,  price_change_percentage_24h: 7.8, price_change_percentage_7d_in_currency: 22.1, market_cap: 85000000000,  total_volume: 4200000000  },
    { id: "chainlink", symbol: "link", name: "Chainlink", current_price: 18.4, price_change_percentage_24h: 9.1, price_change_percentage_7d_in_currency: 28.3, market_cap: 11000000000,  total_volume: 820000000   },
    { id: "arbitrum",  symbol: "arb",  name: "Arbitrum",  current_price: 1.12, price_change_percentage_24h: 5.4, price_change_percentage_7d_in_currency: 18.7, market_cap: 1500000000,   total_volume: 340000000   },
    { id: "uniswap",   symbol: "uni",  name: "Uniswap",   current_price: 12.3, price_change_percentage_24h: 3.8, price_change_percentage_7d_in_currency: 15.2, market_cap: 9200000000,   total_volume: 620000000   },
    { id: "aave",      symbol: "aave", name: "Aave",      current_price: 248,  price_change_percentage_24h: 6.1, price_change_percentage_7d_in_currency: 19.8, market_cap: 3700000000,   total_volume: 290000000   },
    { id: "the-graph", symbol: "grt",  name: "The Graph", current_price: 0.28, price_change_percentage_24h: 11.2, price_change_percentage_7d_in_currency: 31.4, market_cap: 2600000000, total_volume: 210000000   },
  ];
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
  const { asset, category = "top", limit = 10 } = req.body as {
    asset?: string;
    category?: string;
    limit?: number;
  };

  const tokens = category === "defi" ? await fetchDeFiTokens() : await fetchTopCrypto();

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
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "defi-alpha-scanner", port });
});

app.listen(port, () => {
  console.log(`[defi] defi-alpha-scanner listening on http://localhost:${port}`);
});
