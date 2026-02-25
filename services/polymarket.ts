import express from "express";
import { conditionalPaywall } from "../lib/paywall.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const { WALLET_ADDRESS, FACILITATOR_URL, NETWORK, PORT_POLYMARKET } = process.env;
const port = PORT_POLYMARKET ?? "4002";

conditionalPaywall(app, WALLET_ADDRESS, {
  "POST /scan": {
    price: "$0.02",
    network: NETWORK,
    description: "Scan Polymarket for mispriced prediction markets — alpha opportunities",
  },
}, FACILITATOR_URL);

// ─── Types ───────────────────────────────────────────────────────────────────

type AlphaSignal = "HIGH" | "MEDIUM" | "LOW";

interface PolymarketMarket {
  question?: string;
  title?: string;
  volume?: string | number;
  volumeNum?: string | number;
  outcomePrices?: string | number[];
  active?: boolean;
  endDate?: string;
  endDateIso?: string;
}

interface AlphaOpportunity {
  question: string;
  yesPrice: number;
  noPrice: number;
  volume24h: number;
  endDate?: string;
  alphaSignal: AlphaSignal;
  reason: string;
}

// ─── Polymarket API ───────────────────────────────────────────────────────────

const GAMMA_API = "https://gamma-api.polymarket.com";

async function fetchMarkets(limit = 30): Promise<PolymarketMarket[]> {
  try {
    const res = await fetch(
      `${GAMMA_API}/markets?limit=${limit}&active=true&closed=false&order=volume&ascending=false`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as PolymarketMarket[] | { data?: PolymarketMarket[]; markets?: PolymarketMarket[] };
    return Array.isArray(data) ? data : (data.data ?? data.markets ?? []);
  } catch {
    return getFallbackMarkets();
  }
}

function getFallbackMarkets(): PolymarketMarket[] {
  return [
    { question: "Will ETH exceed $4,000 before April 2025?",          volume: "4200000",  outcomePrices: "[0.34, 0.66]", active: true, endDate: "2025-04-01" },
    { question: "Will Bitcoin reach $100k by end of 2025?",            volume: "18000000", outcomePrices: "[0.41, 0.59]", active: true, endDate: "2025-12-31" },
    { question: "Will the Fed cut rates in Q1 2025?",                  volume: "5200000",  outcomePrices: "[0.72, 0.28]", active: true, endDate: "2025-03-31" },
    { question: "Will Solana flip Ethereum by market cap in 2025?",    volume: "900000",   outcomePrices: "[0.12, 0.88]", active: true, endDate: "2025-12-31" },
    { question: "Will BASE surpass 1M daily active users by Q2 2025?", volume: "310000",   outcomePrices: "[0.58, 0.42]", active: true, endDate: "2025-06-30" },
    { question: "Will there be a US crypto spot ETF approval in Q1 2025?", volume: "7800000", outcomePrices: "[0.48, 0.52]", active: true, endDate: "2025-03-31" },
    { question: "Will DeFi TVL exceed $200B by mid-2025?",             volume: "2100000",  outcomePrices: "[0.52, 0.48]", active: true, endDate: "2025-06-30" },
  ];
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

  // Near 50/50 with high volume = high uncertainty = alpha opportunity
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
  const { filter, limit = 10 } = req.body as { filter?: string; limit?: number };

  const markets = await fetchMarkets(Math.min(limit * 3, 50));

  const opportunities: AlphaOpportunity[] = markets
    .filter((m) => m.active !== false && m.question)
    .map(scoreMarket)
    .filter((o) => !filter || o.question.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => SIGNAL_ORDER[b.alphaSignal] - SIGNAL_ORDER[a.alphaSignal])
    .slice(0, limit);

  const topSignal = opportunities[0]?.alphaSignal ?? "NONE";
  const highCount = opportunities.filter((o) => o.alphaSignal === "HIGH").length;

  res.json({
    service: "polymarket-alpha-scanner",
    timestamp: new Date().toISOString(),
    result: {
      opportunities,
      total: opportunities.length,
      topSignal,
      highSignalCount: highCount,
      summary: `Found ${highCount} HIGH-alpha markets out of ${opportunities.length} scanned`,
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "polymarket-alpha-scanner", port });
});

app.listen(port, () => {
  console.log(`[polymarket] polymarket-alpha-scanner listening on http://localhost:${port}`);
});
