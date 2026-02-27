/**
 * AlphaClaw Claude integration
 * Routes requests through the local claude-bridge (port 5010)
 * which uses the claude CLI under the hood — no separate API key needed.
 */

import { createLogger } from "../lib/logger.js";

const log = createLogger("claude");

const BRIDGE_URL = "http://localhost:5010/v1/messages";
const MODEL = "claude-sonnet-4-6";
const BRIDGE_TIMEOUT_MS = 60_000;

export function isClaudeEnabled(): boolean {
  return true; // Always enabled via bridge
}

// ─── Core fetch ─────────────────────────────────────────────────────────────

async function callClaude(prompt: string, maxTokens = 1024): Promise<string | null> {
  try {
    const res = await fetch(BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(BRIDGE_TIMEOUT_MS),
    });

    if (!res.ok) {
      log.warn("claude bridge error", { status: res.status });
      return null;
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    return data.content?.[0]?.text ?? null;
  } catch (err) {
    log.warn("claude bridge unreachable", { error: (err as Error).message });
    return null;
  }
}

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

  const prompt = `You are AlphaClaw — an autonomous DeFi and prediction market alpha agent. You completed a multi-source intelligence hunt on: "${input.topic}".

Signal data from 5 agents:
${signals.map(s => `- ${s}`).join("\n")}

Assessment:
- Confidence: ${input.confidence}
- Recommendation: ${input.recommendation}
- Consensus: ${(input.consensusStrength * 100).toFixed(0)}% of agents agree

Return ONLY valid JSON, no markdown, no explanation:
{"summary":"2-3 sentence analyst take, direct, data-driven","moltbookTitle":"Punchy title max 80 chars","moltbookBody":"Full post 200-350 words, markdown, first person as AlphaClaw, end with disclaimer","keyInsight":"One-liner max 120 chars, most actionable insight"}`;

  const text = await callClaude(prompt, 1024);
  if (!text) return null;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn("claude: no JSON in response", { preview: text.slice(0, 100) });
      return null;
    }
    const parsed = JSON.parse(jsonMatch[0]) as ClaudeNarrative;
    log.info("claude narrative generated", { topic: input.topic });
    return parsed;
  } catch (err) {
    log.warn("claude: JSON parse failed", { error: (err as Error).message });
    return null;
  }
}

// ─── Moltbook Post Generator ─────────────────────────────────────────────────

export async function generateMoltbookPost(
  topic: string,
  finding: string,
): Promise<{ title: string; body: string } | null> {
  const prompt = `You are AlphaClaw, autonomous crypto alpha agent. Write a Moltbook post.
Topic: ${topic}
Key finding: ${finding}
Return ONLY valid JSON: {"title":"max 80 chars","body":"max 200 words, first person, direct, data-driven, end with disclaimer"}`;

  const text = await callClaude(prompt, 512);
  if (!text) return null;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]) as { title: string; body: string };
  } catch {
    return null;
  }
}
