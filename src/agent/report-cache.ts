import { createHash } from "crypto";
import { createStore } from "../lib/store.js";
import type { CachedReport } from "../types/index.js";

const MAX_CACHED_REPORTS = 200;
const SAVE_DEBOUNCE = 10_000;

// ─── Persistence ────────────────────────────────────────────────────────────

interface ReportData {
  reports: Array<CachedReport & { lastAccessed?: number }>;
}

const store = createStore<ReportData>({
  filename: "reports.json",
  defaultValue: { reports: [] },
  debounceMs: SAVE_DEBOUNCE,
});

function saveToStore(): void {
  const reports: Array<CachedReport & { lastAccessed?: number }> = [];
  for (const r of reportCache.values()) reports.push(r as CachedReport & { lastAccessed?: number });
  store.set({ reports });
}

// ─── State ──────────────────────────────────────────────────────────────────

export const reportCache = new Map<string, CachedReport>();

/** Load persisted reports from disk. All reports survive restarts. */
export function loadReports(): void {
  store.load();
  const data = store.get();
  for (const r of data.reports) {
    reportCache.set(r.id, r);
  }
}

export function generateReportId(topic: string, timestamp: string): string {
  return createHash("sha256").update(`${topic}:${timestamp}`).digest("hex").slice(0, 12);
}

export function cacheReport(report: CachedReport): void {
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

export function isReportExpired(_report: CachedReport): boolean {
  return false; // reports persist indefinitely
}
