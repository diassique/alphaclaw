import { createHash } from "crypto";
import type { CachedReport } from "../types/index.js";

const REPORT_TTL = 30 * 60_000; // 30 min
const MAX_CACHED_REPORTS = 10;

export const reportCache = new Map<string, CachedReport>();

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
    const oldest = reportCache.keys().next().value;
    if (oldest) reportCache.delete(oldest);
  }
  reportCache.set(report.id, report);
}

export function isReportExpired(report: CachedReport): boolean {
  return Date.now() - report.createdAt > REPORT_TTL;
}
