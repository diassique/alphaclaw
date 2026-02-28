import { createService } from "../../lib/service-factory.js";
import { validateString } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import { BULL_WORDS, BEAR_WORDS, STRONG_BULL, STRONG_BEAR, BULL_PHRASES, BEAR_PHRASES, NEGATIONS } from "./lexicon.js";
import type { SentimentLabel, ConfidenceLevel, SentimentSignal } from "../../types/index.js";

const MAX_STAKE = 100;

const { app, log, start } = createService({
  name: "sentiment",
  displayName: "crypto-sentiment",
  port: config.ports.sentiment,
  routes: {
    "POST /analyze": {
      price: "$0.001",
      description: "Crypto market sentiment analysis — bullish/bearish signals from text",
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

  // Phase 1: Phrase detection (bigrams/trigrams)
  const lowerJoined = " " + words.join(" ") + " ";

  for (const [phrase, pts] of BULL_PHRASES) {
    if (lowerJoined.includes(` ${phrase} `)) {
      score += pts;
      signals.push({ word: phrase, type: "STRONG_BULL", score: pts });
    }
  }
  for (const [phrase, pts] of BEAR_PHRASES) {
    if (lowerJoined.includes(` ${phrase} `)) {
      score -= pts;
      signals.push({ word: phrase, type: "STRONG_BEAR", score: -pts });
    }
  }

  // Phase 2: Word-level with negation + modifier weighting
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
      const pts = bullScore * modifier;
      if (negated) {
        score -= pts;
        signals.push({ word: clean, type: "BEAR", score: -pts });
      } else {
        score += pts;
        if (STRONG_BULL.has(clean)) {
          signals.push({ word: clean, type: "STRONG_BULL", score: pts });
        }
      }
    }

    if (bearScore !== undefined) {
      const pts = bearScore * modifier;
      if (negated) {
        score += pts;
        signals.push({ word: clean, type: "BULL", score: pts });
      } else {
        score -= pts;
        if (STRONG_BEAR.has(clean)) {
          signals.push({ word: clean, type: "STRONG_BEAR", score: -pts });
        }
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

  // Confidence staking score
  const confMap: Record<string, number> = { high: 0.85, medium: 0.6, low: 0.35 };
  const confidenceScore = Math.min(1, (confMap[confidence] ?? 0.35) * 0.6 + Math.abs(normalized) * 0.25 + Math.min(signals.length / 10, 1) * 0.15);
  const confidenceBasis = `${confidence} conf + ${Math.abs(normalized).toFixed(2)} magnitude + ${signals.length} signals`;

  log.info("analyze", { label, score: normalized, wordCount: words.length, signalCount: signals.length, confidenceScore: confidenceScore.toFixed(3) });

  // ACP protocol headers
  const acpDirection = (label === "strongly_bullish" || label === "bullish") ? "bullish"
    : (label === "strongly_bearish" || label === "bearish") ? "bearish" : "neutral";
  res.setHeader("X-ACP-Direction", acpDirection);
  res.setHeader("X-ACP-Confidence", confidenceScore.toFixed(3));
  res.setHeader("X-ACP-Stake", (MAX_STAKE * confidenceScore).toFixed(2));
  res.setHeader("X-ACP-Version", "1");

  res.json({
    service: "crypto-sentiment",
    timestamp: new Date().toISOString(),
    result: {
      score: parseFloat(normalized.toFixed(3)),
      label,
      confidence,
      confidenceScore: parseFloat(confidenceScore.toFixed(3)),
      confidenceBasis,
      signals: signals.slice(0, 20),
      wordCount: words.length,
    },
  });
});

start();
