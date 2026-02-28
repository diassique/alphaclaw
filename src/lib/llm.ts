/**
 * Shared LLM utility — Groq (free, fast inference via OpenAI-compatible API).
 * Any service or agent module can import this for AI post-processing.
 */

import { config } from "../config/env.js";
import { createLogger } from "./logger.js";

const log = createLogger("llm");

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const TIMEOUT_MS = 8_000;

export function isLLMEnabled(): boolean {
  return config.groq.apiKey.length > 0;
}

/**
 * Call the LLM and return raw text response.
 * Returns null on any failure — callers should always have a fallback.
 */
export async function callLLM(prompt: string, maxTokens = 512): Promise<string | null> {
  if (!config.groq.apiKey) return null;

  try {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.groq.apiKey}`,
      },
      body: JSON.stringify({
        model: config.groq.model,
        max_tokens: maxTokens,
        temperature: 0.4,
        messages: [{ role: "user", content: prompt }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!res.ok) {
      log.warn("groq error", { status: res.status });
      return null;
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    log.warn("groq unreachable", { error: (err as Error).message });
    return null;
  }
}

/**
 * Call LLM and parse a JSON response. Returns null on failure.
 * Extracts the first {...} block from the response to handle markdown wrapping.
 */
export async function callLLMJson<T>(prompt: string, maxTokens = 512): Promise<T | null> {
  const text = await callLLM(prompt, maxTokens);
  if (!text) return null;

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn("llm: no JSON in response", { preview: text.slice(0, 100) });
      return null;
    }
    return JSON.parse(jsonMatch[0]) as T;
  } catch (err) {
    log.warn("llm: JSON parse failed", { error: (err as Error).message });
    return null;
  }
}
