/**
 * Generic persistent store with atomic writes, backup/recovery, and debounced I/O.
 *
 * - Atomic: writeFileSync(tmp) + renameSync(tmp, path) — atomic on Linux
 * - Backup: copies main → .prev on load; falls back to .prev if main corrupt
 * - Debounced: markDirty() + unref'd interval flushes when dirty
 * - Global registry: flushAllStores() / destroyAllStores() for shutdown
 */

import { readFileSync, writeFileSync, renameSync, copyFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "./logger.js";

const log = createLogger("store");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");

// ─── Global Registry ────────────────────────────────────────────────────────

const allStores: Store<unknown>[] = [];

/** Synchronously flush every dirty store. Safe to call during SIGTERM. */
export function flushAllStores(): void {
  for (const s of allStores) s.flush();
}

/** Clear all debounce timers. Call after flushAllStores() during shutdown. */
export function destroyAllStores(): void {
  for (const s of allStores) s.destroy();
}

// ─── Store ──────────────────────────────────────────────────────────────────

export interface StoreOptions<T> {
  filename: string;
  defaultValue: T;
  validate?: (raw: unknown) => T;
  debounceMs?: number;             // default 5000
}

export interface Store<T> {
  get(): T;
  set(value: T): void;
  markDirty(): void;
  flush(): void;
  load(): void;
  destroy(): void;
}

export function createStore<T>(opts: StoreOptions<T>): Store<T> {
  const { filename, defaultValue, validate, debounceMs = 5000 } = opts;
  const filePath = join(DATA_DIR, filename);
  const prevPath = filePath + ".prev";
  const tmpPath = filePath + ".tmp";

  let value: T = structuredClone(defaultValue);
  let dirty = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  function ensureDir(): void {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
  }

  /** Try to parse and optionally validate JSON from a file path. Returns null on failure. */
  function tryRead(path: string): T | null {
    try {
      if (!existsSync(path)) return null;
      const raw = JSON.parse(readFileSync(path, "utf-8"));
      return validate ? validate(raw) : raw as T;
    } catch {
      return null;
    }
  }

  /** Atomically write value to disk: write tmp → rename over target. */
  function atomicWrite(): void {
    ensureDir();
    writeFileSync(tmpPath, JSON.stringify(value, null, 2));
    renameSync(tmpPath, filePath);
  }

  function load(): void {
    ensureDir();

    // Try main file first
    const main = tryRead(filePath);
    if (main !== null) {
      value = main;
      // Backup main → .prev
      try { copyFileSync(filePath, prevPath); } catch { /* best effort */ }
      log.info("store loaded", { file: filename });
      return;
    }

    // Main missing or corrupt — try .prev
    const prev = tryRead(prevPath);
    if (prev !== null) {
      value = prev;
      log.warn("store recovered from backup", { file: filename });
      // Re-write main from recovered data
      try { atomicWrite(); } catch { /* best effort */ }
      return;
    }

    // Both missing/corrupt — use default
    value = structuredClone(defaultValue);
    log.info("store initialized with defaults", { file: filename });
  }

  function flush(): void {
    if (!dirty) return;
    try {
      atomicWrite();
      dirty = false;
    } catch (err) {
      log.warn("store flush failed", { file: filename, error: (err as Error).message });
    }
  }

  function destroy(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  // Start debounce timer (unref'd so it doesn't keep process alive)
  timer = setInterval(() => flush(), debounceMs);
  timer.unref();

  const store: Store<T> = {
    get: () => value,
    set: (v: T) => { value = v; dirty = true; },
    markDirty: () => { dirty = true; },
    flush,
    load,
    destroy,
  };

  allStores.push(store as Store<unknown>);

  return store;
}
