import { createHash } from "crypto";
import type { CachedReport } from "../types/index.js";

const REPORT_TTL = 30 * 60_000; // 30 min
const MAX_CACHED_REPORTS = 10;
const CLEANUP_INTERVAL = 60_000; // 1 min

export const reportCache = new Map<string, CachedReport>();

// Periodic cleanup — don't keep process alive just for this
const cleanupTimer = setInterval(() => evictExpired(), CLEANUP_INTERVAL);
cleanupTimer.unref();

export function generateReportId(topic: string, timestamp: string): string {
  return createHash("sha256").update(`${topic}:${timestamp}`).digest("hex").slice(0, 12);
}

export function evictExpired(): void {
  const now = Date.now();
  for (const [id, report] of reportCache) {
    if (now - report.createdAt > REPORT_TTL) {
      reportCache.delete(id);
    }
  }
}

export function cacheReport(report: CachedReport): void {
  evictExpired();
  if (reportCache.size >= MAX_CACHED_REPORTS) {
    // LRU eviction: remove the entry with oldest lastAccessed (or createdAt as fallback)
    let oldestId: string | undefined;
    let oldestTime = Infinity;
    for (const [id, r] of reportCache) {
      const accessed = (r as CachedReport & { lastAccessed?: number }).lastAccessed ?? r.createdAt;
      if (accessed < oldestTime) {
        oldestTime = accessed;
        oldestId = id;
      }
    }
    if (oldestId) reportCache.delete(oldestId);
  }
  (report as CachedReport & { lastAccessed: number }).lastAccessed = Date.now();
  reportCache.set(report.id, report);
}

/** Mark report as recently accessed (LRU tracking). */
export function touchReport(report: CachedReport): void {
  (report as CachedReport & { lastAccessed: number }).lastAccessed = Date.now();
}

export function isReportExpired(report: CachedReport): boolean {
  return Date.now() - report.createdAt > REPORT_TTL;
}
