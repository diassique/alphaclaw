import { randomUUID } from "crypto";
import { createLogger } from "../lib/logger.js";
import { createStore } from "../lib/store.js";
import { config } from "../config/env.js";
import { reportCache } from "./report-cache.js";
import type { CachedReport, MoltbookConfig, MoltbookPostRecord } from "../types/index.js";

const log = createLogger("moltbook");

const MOLTBOOK_API = "https://www.moltbook.com/api/v1";
const RATE_LIMIT_MS = 30 * 60_000; // 1 post per 30 min
const MAX_HISTORY = 50;

// ─── Persistence ────────────────────────────────────────────────────────────

interface MoltbookData {
  posts: MoltbookPostRecord[];
  lastPostAt: number;
  postsToday: number;
  lastDayReset: string;
}

const store = createStore<MoltbookData>({
  filename: "moltbook.json",
  defaultValue: { posts: [], lastPostAt: 0, postsToday: 0, lastDayReset: "" },
  debounceMs: 5000,
});

function saveToStore(): void {
  store.set({
    posts: posts.slice(-MAX_HISTORY),
    lastPostAt,
    postsToday,
    lastDayReset,
  });
}

// ─── State ──────────────────────────────────────────────────────────────────

let moltbookConfig: MoltbookConfig = {
  apiKey: config.moltbook.apiKey,
  submolt: config.moltbook.submolt,
  autoPost: config.moltbook.autoPost,
  minConfidence: config.moltbook.minConfidence,
  enabled: false,
};

let posts: MoltbookPostRecord[] = [];
let lastPostAt = 0;
let postsToday = 0;
let lastDayReset = "";

function resetDailyCountIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (lastDayReset !== today) {
    postsToday = 0;
    lastDayReset = today;
  }
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────

export function loadMoltbook(): void {
  store.load();
  const data = store.get();
  posts = data.posts ?? [];
  lastPostAt = data.lastPostAt ?? 0;
  postsToday = data.postsToday ?? 0;
  lastDayReset = data.lastDayReset ?? "";
  resetDailyCountIfNeeded();
  log.info("moltbook state loaded", { posts: posts.length, postsToday });
}

export function initMoltbook(): void {
  if (!config.moltbook.apiKey) {
    log.info("moltbook disabled (no MOLTBOOK_API_KEY)");
    return;
  }
  moltbookConfig.enabled = true;
  log.info("moltbook enabled", { submolt: moltbookConfig.submolt, autoPost: moltbookConfig.autoPost, minConfidence: moltbookConfig.minConfidence });
}

// ─── Status & Config ────────────────────────────────────────────────────────

export function getMoltbookStatus(): {
  enabled: boolean;
  submolt: string;
  autoPost: boolean;
  minConfidence: number;
  postsToday: number;
  lastPost: string | null;
  rateLimitRemainingMs: number;
} {
  resetDailyCountIfNeeded();
  const now = Date.now();
  const sinceLast = now - lastPostAt;
  return {
    enabled: moltbookConfig.enabled,
    submolt: moltbookConfig.submolt,
    autoPost: moltbookConfig.autoPost,
    minConfidence: moltbookConfig.minConfidence,
    postsToday,
    lastPost: lastPostAt > 0 ? new Date(lastPostAt).toISOString() : null,
    rateLimitRemainingMs: Math.max(0, RATE_LIMIT_MS - sinceLast),
  };
}

export function setMoltbookConfig(partial: Partial<Pick<MoltbookConfig, "apiKey" | "submolt" | "autoPost" | "minConfidence">>): void {
  if (partial.apiKey !== undefined) {
    moltbookConfig.apiKey = partial.apiKey;
    moltbookConfig.enabled = !!partial.apiKey;
  }
  if (partial.submolt !== undefined) moltbookConfig.submolt = partial.submolt;
  if (partial.autoPost !== undefined) moltbookConfig.autoPost = partial.autoPost;
  if (partial.minConfidence !== undefined) moltbookConfig.minConfidence = Math.max(0, Math.min(100, partial.minConfidence));
  log.info("moltbook config updated", { enabled: moltbookConfig.enabled, submolt: moltbookConfig.submolt, autoPost: moltbookConfig.autoPost });
}

export function getMoltbookHistory(): MoltbookPostRecord[] {
  return posts.slice(-20).reverse();
}

// ─── Posting ────────────────────────────────────────────────────────────────

function isRateLimited(): boolean {
  return Date.now() - lastPostAt < RATE_LIMIT_MS;
}

function formatPostBody(report: CachedReport): { title: string; body: string } {
  const { alpha, topic, agentPayments } = report;

  // Use Claude-generated narrative if available
  if (alpha.narrative) {
    return {
      title: alpha.narrative.moltbookTitle,
      body: alpha.narrative.moltbookBody,
    };
  }

  // Fallback: structured template
  const b = alpha.breakdown;
  const rows: string[] = [];
  if (b.sentiment) rows.push(`| Sentiment | ${b.sentiment.label} | ${b.sentiment.confidence} |`);
  if (b.polymarket) rows.push(`| Polymarket | ${b.polymarket.market?.slice(0, 50)} | ${b.polymarket.signal} |`);
  if (b.defi) rows.push(`| DeFi | ${b.defi.asset} ${b.defi.action} | ${b.defi.change24h} |`);
  if (b.news) rows.push(`| News | ${b.news.topHeadline?.slice(0, 50)} | ${b.news.articleCount} articles |`);
  if (b.whale) rows.push(`| Whale | ${b.whale.signal} | ${b.whale.whaleCount} whales |`);

  const title = `AlphaClaw Alpha: ${topic} — ${alpha.confidence} confidence`;

  const body = [
    `**Topic:** ${topic}`,
    `**Confidence:** ${alpha.confidence} (weighted: ${alpha.weightedConfidence}%)`,
    `**Recommendation:** ${alpha.recommendation}`,
    "",
    "**Signals:**",
    ...alpha.signals.map(s => `- ${s}`),
    "",
    "| Source | Finding | Detail |",
    "|--------|---------|--------|",
    ...rows,
    "",
    `**Agent Economy:** ${agentPayments.totalPaid}`,
    `**Consensus Strength:** ${alpha.consensusStrength}%`,
    "",
    "---",
    "*Posted by AlphaClaw — autonomous AI agent network hunting alpha via x402 micropayments*",
  ].join("\n");

  return { title, body };
}

async function postToMoltbook(title: string, body: string): Promise<{ ok: boolean; postId?: string; error?: string }> {
  try {
    const r = await fetch(`${MOLTBOOK_API}/posts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${moltbookConfig.apiKey}`,
      },
      body: JSON.stringify({ title, body, submolt: moltbookConfig.submolt }),
      signal: AbortSignal.timeout(10_000),
    });

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      log.warn("moltbook post failed", { status: r.status, body: text.slice(0, 200) });
      return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 100)}` };
    }

    const data = await r.json() as { id?: string; postId?: string };
    const postId = data.postId ?? data.id ?? randomUUID().slice(0, 8);
    return { ok: true, postId };
  } catch (err) {
    log.warn("moltbook post error", { error: (err as Error).message });
    return { ok: false, error: (err as Error).message };
  }
}

/** Auto-post a hunt result if moltbook is enabled + autoPost on + above minConfidence + not rate-limited. */
export async function notifyMoltbookHuntResult(report: CachedReport): Promise<void> {
  if (!moltbookConfig.enabled || !moltbookConfig.autoPost) return;
  if (report.alpha.weightedConfidence < moltbookConfig.minConfidence) return;
  if (isRateLimited()) {
    log.info("moltbook rate-limited, skipping auto-post", { topic: report.topic });
    return;
  }

  const { title, body } = formatPostBody(report);
  const result = await postToMoltbook(title, body);

  if (result.ok) {
    resetDailyCountIfNeeded();
    lastPostAt = Date.now();
    postsToday++;
    const record: MoltbookPostRecord = {
      postId: result.postId!,
      reportId: report.id,
      topic: report.topic,
      confidence: report.alpha.confidence,
      timestamp: new Date().toISOString(),
    };
    posts.push(record);
    if (posts.length > MAX_HISTORY) posts.splice(0, posts.length - MAX_HISTORY);
    saveToStore();
    log.info("moltbook auto-posted", { postId: result.postId, topic: report.topic });
  }
}

/** Manually post a specific report by ID. Returns result with postId or error. */
export async function postReportToMoltbook(reportId: string): Promise<{ ok: boolean; postId?: string; error?: string }> {
  if (!moltbookConfig.enabled) return { ok: false, error: "moltbook not enabled (set MOLTBOOK_API_KEY)" };

  const report = reportCache.get(reportId);
  if (!report) return { ok: false, error: `report ${reportId} not found in cache` };

  if (isRateLimited()) {
    const remaining = Math.ceil((RATE_LIMIT_MS - (Date.now() - lastPostAt)) / 60_000);
    return { ok: false, error: `rate limited — try again in ${remaining} min` };
  }

  const { title, body } = formatPostBody(report);
  const result = await postToMoltbook(title, body);

  if (result.ok) {
    resetDailyCountIfNeeded();
    lastPostAt = Date.now();
    postsToday++;
    const record: MoltbookPostRecord = {
      postId: result.postId!,
      reportId: report.id,
      topic: report.topic,
      confidence: report.alpha.confidence,
      timestamp: new Date().toISOString(),
    };
    posts.push(record);
    if (posts.length > MAX_HISTORY) posts.splice(0, posts.length - MAX_HISTORY);
    saveToStore();
    log.info("moltbook manual post", { postId: result.postId, reportId });
  }

  return result;
}
