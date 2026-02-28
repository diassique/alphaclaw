import { createService } from "../../lib/service-factory.js";
import { validateString } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import { callLLMJson, isLLMEnabled } from "../../lib/llm.js";
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
      description: "AI-powered crypto market sentiment analysis — bullish/bearish signals from text",
    },
  },
});

// ─── AI Sentiment (primary) ─────────────────────────────────────────────────

interface AISentimentResult {
  label: SentimentLabel;
  score: number;
  confidence: ConfidenceLevel;
  reasoning: string;
  keyPhrases: string[];
}

async function aiSentiment(text: string): Promise<AISentimentResult | null> {
  return callLLMJson<AISentimentResult>(
    `You are a crypto market sentiment analyzer. Analyze this text for market sentiment.

Text: "${text.slice(0, 3000)}"

Consider: sarcasm, negation ("not bullish"), context ("short-term bullish but long-term bearish"), entity-specific sentiment ("SEC approved" = bullish despite SEC being scary), and intensity.

Return ONLY valid JSON:
{"label":"strongly_bullish|bullish|neutral|bearish|strongly_bearish","score":<float -1.0 to 1.0>,"confidence":"high|medium|low","reasoning":"<1 sentence why>","keyPhrases":["<up to 5 key signal phrases>"]}`,
    256,
  );
}

// ─── Lexicon Sentiment (fallback) ───────────────────────────────────────────

function lexiconSentiment(text: string): { label: SentimentLabel; score: number; confidence: ConfidenceLevel; signals: SentimentSignal[] } {
  const lower = text.toLowerCase();
  const words = lower.split(/[\s,.\-!?;:()[\]{}'"]+/).filter(Boolean);
  const origWords = text.split(/[\s,.\-;:()[\]{}'"]+/).filter(Boolean);

  let score = 0;
  const signals: SentimentSignal[] = [];

  // Phase 1: Phrase detection
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

  // Phase 2: Word-level with negation
  for (let i = 0; i < words.length; i++) {
    const raw = words[i]!;
    const clean = raw.replace(/[^a-z0-9]/g, "");
    if (!clean) continue;

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
      if (negated) { score -= pts; signals.push({ word: clean, type: "BEAR", score: -pts }); }
      else { score += pts; if (STRONG_BULL.has(clean)) signals.push({ word: clean, type: "STRONG_BULL", score: pts }); }
    }
    if (bearScore !== undefined) {
      const pts = bearScore * modifier;
      if (negated) { score += pts; signals.push({ word: clean, type: "BULL", score: pts }); }
      else { score -= pts; if (STRONG_BEAR.has(clean)) signals.push({ word: clean, type: "STRONG_BEAR", score: -pts }); }
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

  return { label, score: parseFloat(normalized.toFixed(3)), confidence, signals };
}

// ─── Route ──────────────────────────────────────────────────────────────────

app.post("/analyze", async (req, res) => {
  const text = validateString(req, res, "text", { required: true, maxLen: 5000 });
  if (text === null) return;

  let label: SentimentLabel;
  let score: number;
  let confidence: ConfidenceLevel;
  let signals: SentimentSignal[] = [];
  let reasoning: string | undefined;
  let keyPhrases: string[] | undefined;
  let source: "ai" | "lexicon" = "lexicon";

  // Try AI first, fall back to lexicon
  if (isLLMEnabled()) {
    const ai = await aiSentiment(text);
    if (ai) {
      label = ai.label;
      score = Math.max(-1, Math.min(1, ai.score));
      confidence = ai.confidence;
      reasoning = ai.reasoning;
      keyPhrases = ai.keyPhrases;
      source = "ai";
      // Convert key phrases to signals for downstream compatibility
      signals = (ai.keyPhrases ?? []).map(p => ({
        word: p,
        type: (score > 0 ? "BULL" : score < 0 ? "BEAR" : "BULL") as SentimentSignal["type"],
        score,
      }));
    } else {
      const fallback = lexiconSentiment(text);
      label = fallback.label; score = fallback.score; confidence = fallback.confidence; signals = fallback.signals;
    }
  } else {
    const fallback = lexiconSentiment(text);
    label = fallback.label; score = fallback.score; confidence = fallback.confidence; signals = fallback.signals;
  }

  // Confidence staking score
  const confMap: Record<string, number> = { high: 0.85, medium: 0.6, low: 0.35 };
  const confidenceScore = Math.min(1, (confMap[confidence] ?? 0.35) * 0.6 + Math.abs(score) * 0.25 + Math.min(signals.length / 10, 1) * 0.15);
  const confidenceBasis = `${source} ${confidence} + ${Math.abs(score).toFixed(2)} magnitude + ${signals.length} signals`;

  log.info("analyze", { source, label, score, signalCount: signals.length, confidenceScore: confidenceScore.toFixed(3) });

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
      score,
      label,
      confidence,
      confidenceScore: parseFloat(confidenceScore.toFixed(3)),
      confidenceBasis,
      signals: signals.slice(0, 20),
      wordCount: text.split(/\s+/).length,
      ...(reasoning ? { reasoning } : {}),
      ...(keyPhrases ? { keyPhrases } : {}),
      source,
    },
  });
});

start();
