import { createService } from "../../lib/service-factory.js";
import { validateString } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import { BULL_WORDS, BEAR_WORDS, STRONG_BULL, STRONG_BEAR, BULL_PHRASES, BEAR_PHRASES, NEGATIONS } from "../sentiment/lexicon.js";
import type { SentimentLabel, ConfidenceLevel, SentimentSignal } from "../../types/index.js";

// Conservative sentiment agent — applies a bearish bias (0.85x bull, 1.2x bear)
// This creates natural disagreement with sentiment-v1, driving reputation divergence

const BULL_DAMPENER = 0.85;
const BEAR_AMPLIFIER = 1.2;

const { app, log, start } = createService({
  name: "sentiment-v2",
  displayName: "crypto-sentiment-v2",
  port: config.ports.sentiment2,
  routes: {
    "POST /analyze": {
      price: "$0.001",
      description: "Conservative crypto sentiment — competing agent with bearish bias",
    },
  },
});

app.post("/analyze", (req, res) => {
  const text = validateString(req, res, "text", { required: true, maxLen: 5000 });
  if (text === null) return;

  const lower = text.toLowerCase();
  const words = lower.split(/[\s,.\-!?;:()[\]{}'"]+/).filter(Boolean);

  let score = 0;
  const signals: SentimentSignal[] = [];

  const lowerJoined = " " + words.join(" ") + " ";

  for (const [phrase, pts] of BULL_PHRASES) {
    if (lowerJoined.includes(` ${phrase} `)) {
      const adjusted = pts * BULL_DAMPENER;
      score += adjusted;
      signals.push({ word: phrase, type: "STRONG_BULL", score: adjusted });
    }
  }
  for (const [phrase, pts] of BEAR_PHRASES) {
    if (lowerJoined.includes(` ${phrase} `)) {
      const adjusted = pts * BEAR_AMPLIFIER;
      score -= adjusted;
      signals.push({ word: phrase, type: "STRONG_BEAR", score: -adjusted });
    }
  }

  for (let i = 0; i < words.length; i++) {
    const raw = words[i]!;
    const clean = raw.replace(/[^a-z0-9]/g, "");
    if (!clean) continue;

    const origWords = text.split(/[\s,.\-;:()[\]{}'"]+/).filter(Boolean);
    const origWord = origWords[i] ?? raw;
    const isAllCaps = origWord.length > 2 && origWord === origWord.toUpperCase() && /[A-Z]/.test(origWord);
    const hasExclaim = origWord.endsWith("!");

    let modifier = 1.0;
    if (isAllCaps) modifier *= 1.5;
    if (hasExclaim) modifier *= 1.3;

    const prevWord = i > 0 ? (words[i - 1]?.replace(/[^a-z']/g, "") ?? "") : "";
    const negated = NEGATIONS.has(prevWord);

    const bullScore = BULL_WORDS.get(clean);
    const bearScore = BEAR_WORDS.get(clean);

    if (bullScore !== undefined) {
      const pts = bullScore * modifier * BULL_DAMPENER;
      if (negated) {
        score -= pts;
        signals.push({ word: clean, type: "BEAR", score: -pts });
      } else {
        score += pts;
        if (STRONG_BULL.has(clean)) signals.push({ word: clean, type: "STRONG_BULL", score: pts });
      }
    }

    if (bearScore !== undefined) {
      const pts = bearScore * modifier * BEAR_AMPLIFIER;
      if (negated) {
        score += pts;
        signals.push({ word: clean, type: "BULL", score: pts });
      } else {
        score -= pts;
        if (STRONG_BEAR.has(clean)) signals.push({ word: clean, type: "STRONG_BEAR", score: -pts });
      }
    }
  }

  const normalized = Math.max(-1, Math.min(1, score / Math.max(words.length * 0.15, 1)));

  let label: SentimentLabel;
  let confidence: ConfidenceLevel;
  if (normalized > 0.4)        { label = "strongly_bullish"; confidence = "high";   }
  else if (normalized > 0.15)  { label = "bullish";          confidence = "medium"; }
  else if (normalized < -0.4)  { label = "strongly_bearish"; confidence = "high";   }
  else if (normalized < -0.15) { label = "bearish";          confidence = "medium"; }
  else                         { label = "neutral";          confidence = "low";    }

  const confMap: Record<string, number> = { high: 0.85, medium: 0.6, low: 0.35 };
  const confidenceScore = Math.min(1, (confMap[confidence] ?? 0.35) * 0.6 + Math.abs(normalized) * 0.25 + Math.min(signals.length / 10, 1) * 0.15);
  const confidenceBasis = `${confidence} conf + ${Math.abs(normalized).toFixed(2)} magnitude + ${signals.length} signals (conservative)`;

  log.info("analyze", { label, score: normalized, wordCount: words.length, signalCount: signals.length, confidenceScore: confidenceScore.toFixed(3) });

  res.json({
    service: "crypto-sentiment-v2",
    timestamp: new Date().toISOString(),
    result: {
      score: parseFloat(normalized.toFixed(3)),
      label,
      confidence,
      confidenceScore: parseFloat(confidenceScore.toFixed(3)),
      confidenceBasis,
      signals: signals.slice(0, 20),
      wordCount: words.length,
      variant: "conservative",
    },
  });
});

start();
