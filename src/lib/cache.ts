/**
 * In-memory TTL cache.
 * Pattern: fresh cache -> return; stale -> try API -> update; API fail -> return stale + warning; no cache -> 502.
 */

interface CacheEntry<T> {
  data: T;
  storedAt: number;
  ttlMs: number;
}

export class ApiCache<T> {
  private store = new Map<string, CacheEntry<T>>();

  /** Get cached data (returns undefined if key never stored). */
  get(key: string): T | undefined {
    return this.store.get(key)?.data;
  }

  /** Store data with a TTL. */
  set(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, storedAt: Date.now(), ttlMs });
  }

  /** True if entry exists and is within TTL. */
  isFresh(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    return Date.now() - entry.storedAt < entry.ttlMs;
  }

  /** Age in ms since stored (Infinity if missing). */
  age(key: string): number {
    const entry = this.store.get(key);
    if (!entry) return Infinity;
    return Date.now() - entry.storedAt;
  }

  /** True if key exists at all (even if stale). */
  has(key: string): boolean {
    return this.store.has(key);
  }
}
