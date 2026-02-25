import express from "express";
import { conditionalPaywall } from "../lib/paywall.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const { WALLET_ADDRESS, FACILITATOR_URL, NETWORK, PORT_SENTIMENT } = process.env;
const port = PORT_SENTIMENT ?? "4001";

conditionalPaywall(app, WALLET_ADDRESS, {
  "POST /analyze": {
    price: "$0.01",
    network: NETWORK,
    description: "Crypto market sentiment analysis — bullish/bearish signals from text",
  },
}, FACILITATOR_URL);

// ─── Types ───────────────────────────────────────────────────────────────────

type SentimentLabel = "strongly_bullish" | "bullish" | "neutral" | "bearish" | "strongly_bearish";
type ConfidenceLevel = "high" | "medium" | "low";

interface SentimentSignal {
  word: string;
  type: "STRONG_BULL" | "STRONG_BEAR";
}

// ─── Crypto-specific sentiment lexicon ───────────────────────────────────────

const BULLISH: readonly string[] = [
  "bullish", "moon", "mooning", "pump", "pumping", "rally", "rallying", "surge",
  "surging", "breakout", "ath", "adoption", "accumulate", "buy", "long", "uptrend",
  "green", "gains", "profit", "strong", "support", "reversal", "explosive",
  "parabolic", "outperform", "institutional", "whale", "hodl", "accumulation",
  "undervalued", "opportunity", "catalyst", "bullrun", "recovery", "rebound",
  "momentum", "positive", "growth", "expand", "rise", "rising",
];
const BEARISH: readonly string[] = [
  "bearish", "dump", "dumping", "crash", "crashing", "correction", "downtrend",
  "red", "sell", "short", "resistance", "breakdown", "capitulation", "panic",
  "fear", "fud", "rug", "scam", "overvalued", "bubble", "liquidation",
  "margin-call", "rekt", "weak", "decline", "plunge", "bleed", "distribution",
  "downfall", "collapse", "warning", "risk", "volatile", "uncertainty",
];
const STRONG_BULL: readonly string[] = ["moon", "parabolic", "explosive", "breakout", "ath", "surge", "bullrun"];
const STRONG_BEAR: readonly string[] = ["crash", "rug", "rekt", "capitulation", "liquidation", "collapse"];

// ─── Route ───────────────────────────────────────────────────────────────────

app.post("/analyze", (req, res) => {
  const { text } = req.body as { text?: string };

  if (!text) { res.status(400).json({ error: "Missing 'text' field" }); return; }

  const lower = text.toLowerCase();
  const words = lower.split(/[\s,.\-!?;:]+/);

  let score = 0;
  const signals: SentimentSignal[] = [];

  for (const word of words) {
    const clean = word.replace(/[^a-z0-9-]/g, "");
    if (!clean) continue;

    if (BULLISH.includes(clean)) {
      const strength = STRONG_BULL.includes(clean) ? 2 : 1;
      score += strength;
      if (STRONG_BULL.includes(clean)) signals.push({ word: clean, type: "STRONG_BULL" });
    }
    if (BEARISH.includes(clean)) {
      const strength = STRONG_BEAR.includes(clean) ? 2 : 1;
      score -= strength;
      if (STRONG_BEAR.includes(clean)) signals.push({ word: clean, type: "STRONG_BEAR" });
    }
  }

  const normalized = Math.max(-1, Math.min(1, score / Math.max(words.length * 0.15, 1)));

  let label: SentimentLabel;
  let confidence: ConfidenceLevel;
  if (normalized > 0.4)        { label = "strongly_bullish"; confidence = "high";   }
  else if (normalized > 0.15)  { label = "bullish";           confidence = "medium"; }
  else if (normalized < -0.4)  { label = "strongly_bearish";  confidence = "high";   }
  else if (normalized < -0.15) { label = "bearish";            confidence = "medium"; }
  else                         { label = "neutral";            confidence = "low";    }

  res.json({
    service: "crypto-sentiment",
    input: text.slice(0, 200),
    result: {
      score: parseFloat(normalized.toFixed(3)),
      label,
      confidence,
      signals,
      wordCount: words.length,
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "crypto-sentiment", port });
});

app.listen(port, () => {
  console.log(`[sentiment] crypto-sentiment listening on http://localhost:${port}`);
});
