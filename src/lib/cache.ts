/**
 * In-memory TTL cache with max size, LRU eviction, and periodic cleanup.
 * Pattern: fresh cache -> return; stale -> try API -> update; API fail -> return stale + warning; no cache -> 502.
 */

interface CacheEntry<T> {
  data: T;
  storedAt: number;
  ttlMs: number;
  lastAccessed: number;
}

const DEFAULT_MAX_SIZE = 500;
const CLEANUP_INTERVAL = 60_000; // 1 min

export class ApiCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  private readonly maxSize: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize;
    this.cleanupTimer = setInterval(() => this.evictExpired(), CLEANUP_INTERVAL);
    this.cleanupTimer.unref(); // don't keep process alive just for cleanup
  }

  /** Get cached data (returns undefined if key never stored). Marks as recently used. */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    entry.lastAccessed = Date.now();
    return entry.data;
  }

  /** Store data with a TTL. Evicts LRU entry if at capacity. */
  set(key: string, data: T, ttlMs: number): void {
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.evictLRU();
    }
    const now = Date.now();
    this.store.set(key, { data, storedAt: now, ttlMs, lastAccessed: now });
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

  /** Number of entries currently in the cache. */
  get size(): number {
    return this.store.size;
  }

  /** Remove all expired entries. */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now - entry.storedAt >= entry.ttlMs * 2) {
        // Keep stale entries for fallback (1x TTL), remove after 2x TTL
        this.store.delete(key);
      }
    }
  }

  /** Remove least-recently-accessed entry. */
  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.store) {
      if (entry.lastAccessed < oldestAccess) {
        oldestAccess = entry.lastAccessed;
        oldestKey = key;
      }
    }
    if (oldestKey) this.store.delete(oldestKey);
  }

  /** Stop periodic cleanup (for graceful shutdown). */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.store.clear();
  }
}
