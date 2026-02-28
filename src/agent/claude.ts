/**
 * AlphaClaw narrative generation — powered by Groq LLM.
 * Uses shared lib/llm.ts for all API calls.
 */

import { callLLMJson, isLLMEnabled } from "../lib/llm.js";
import { createLogger } from "../lib/logger.js";

const log = createLogger("narrative");

export { isLLMEnabled as isClaudeEnabled };

// ─── Alpha Narrative ────────────────────────────────────────────────────────

export interface AlphaInput {
  topic: string;
  sentiment?: { label: string; score: number; confidence: string } | null;
  polymarket?: { market: string; signal: string; yesPrice: string } | null;
  defi?: { asset: string; action: string; change24h: string } | null;
  news?: { topHeadline: string; articleCount: number } | null;
  whale?: { signal: string; whaleCount: number; totalVolume: string } | null;
  confidence: string;
  recommendation: string;
  consensusStrength: number;
}

export interface ClaudeNarrative {
  summary: string;
  moltbookTitle: string;
  moltbookBody: string;
  keyInsight: string;
}

export async function generateAlphaNarrative(input: AlphaInput): Promise<ClaudeNarrative | null> {
  const signals: string[] = [];
  if (input.sentiment) signals.push(`Sentiment: ${input.sentiment.label} (score: ${input.sentiment.score})`);
  if (input.polymarket) signals.push(`Polymarket: ${input.polymarket.market} — ${input.polymarket.signal}, YES at ${input.polymarket.yesPrice}`);
  if (input.defi) signals.push(`DeFi: ${input.defi.asset} — ${input.defi.action}, 24h change: ${input.defi.change24h}`);
  if (input.news) signals.push(`News: "${input.news.topHeadline}" (${input.news.articleCount} articles)`);
  if (input.whale) signals.push(`Whale activity: ${input.whale.signal}, ${input.whale.whaleCount} whales, volume: ${input.whale.totalVolume}`);

  const result = await callLLMJson<ClaudeNarrative>(
    `You are AlphaClaw — an autonomous DeFi and prediction market alpha agent. You completed a multi-source intelligence hunt on: "${input.topic}".

Signal data from 5 agents:
${signals.map(s => `- ${s}`).join("\n")}

Assessment:
- Confidence: ${input.confidence}
- Recommendation: ${input.recommendation}
- Consensus: ${(input.consensusStrength * 100).toFixed(0)}% of agents agree

Return ONLY valid JSON, no markdown, no explanation:
{"summary":"2-3 sentence analyst take, direct, data-driven","moltbookTitle":"Punchy title max 80 chars","moltbookBody":"Full post 200-350 words, markdown, first person as AlphaClaw, end with disclaimer","keyInsight":"One-liner max 120 chars, most actionable insight"}`,
    1024,
  );

  if (result) log.info("narrative generated", { topic: input.topic });
  return result;
}

// ─── Moltbook Post Generator ─────────────────────────────────────────────────

export async function generateMoltbookPost(
  topic: string,
  finding: string,
): Promise<{ title: string; body: string } | null> {
  return callLLMJson<{ title: string; body: string }>(
    `You are AlphaClaw, autonomous crypto alpha agent. Write a Moltbook post.
Topic: ${topic}
Key finding: ${finding}
Return ONLY valid JSON: {"title":"max 80 chars","body":"max 200 words, first person, direct, data-driven, end with disclaimer"}`,
    512,
  );
}
