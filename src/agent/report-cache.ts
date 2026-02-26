import { createHash } from "crypto";
import { createStore } from "../lib/store.js";
import type { CachedReport } from "../types/index.js";

const REPORT_TTL = 30 * 60_000; // 30 min
const MAX_CACHED_REPORTS = 10;
const CLEANUP_INTERVAL = 60_000; // 1 min

// ─── Persistence ────────────────────────────────────────────────────────────

interface ReportData {
  reports: Array<CachedReport & { lastAccessed?: number }>;
}

const store = createStore<ReportData>({
  filename: "reports.json",
  defaultValue: { reports: [] },
  debounceMs: 10_000,
});

function saveToStore(): void {
  const reports: Array<CachedReport & { lastAccessed?: number }> = [];
  for (const r of reportCache.values()) reports.push(r as CachedReport & { lastAccessed?: number });
  store.set({ reports });
}

// ─── State ──────────────────────────────────────────────────────────────────

export const reportCache = new Map<string, CachedReport>();

// Periodic cleanup — don't keep process alive just for this
const cleanupTimer = setInterval(() => evictExpired(), CLEANUP_INTERVAL);
cleanupTimer.unref();

/** Load persisted reports from disk. Skips TTL-expired entries. */
export function loadReports(): void {
  store.load();
  const data = store.get();
  const now = Date.now();
  for (const r of data.reports) {
    if (now - r.createdAt <= REPORT_TTL) {
      reportCache.set(r.id, r);
    }
  }
}

export function generateReportId(topic: string, timestamp: string): string {
  return createHash("sha256").update(`${topic}:${timestamp}`).digest("hex").slice(0, 12);
}

export function evictExpired(): void {
  const now = Date.now();
  let evicted = false;
  for (const [id, report] of reportCache) {
    if (now - report.createdAt > REPORT_TTL) {
      reportCache.delete(id);
      evicted = true;
    }
  }
  if (evicted) saveToStore();
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
  saveToStore();
}

/** Mark report as recently accessed (LRU tracking). */
export function touchReport(report: CachedReport): void {
  (report as CachedReport & { lastAccessed: number }).lastAccessed = Date.now();
  saveToStore();
}

export function isReportExpired(report: CachedReport): boolean {
  return Date.now() - report.createdAt > REPORT_TTL;
}
