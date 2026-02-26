import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../lib/logger.js";
import type { MemoryEntry, SignalCombination, MemoryInsight, MemoryStats } from "../types/index.js";

const log = createLogger("memory");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const MEMORY_FILE = join(DATA_DIR, "memory.json");
const MAX_ENTRIES = 500;
const MIN_OCCURRENCES_FOR_ACTIVE = 3;

interface MemoryStore {
  entries: MemoryEntry[];
  patterns: Map<string, SignalCombination>;
}

const store: MemoryStore = { entries: [], patterns: new Map() };

export function loadMemory(): void {
  try {
    if (existsSync(MEMORY_FILE)) {
      const raw = JSON.parse(readFileSync(MEMORY_FILE, "utf-8")) as {
        entries?: MemoryEntry[];
        patterns?: Record<string, SignalCombination>;
      };
      store.entries = raw.entries ?? [];
      store.patterns = new Map(Object.entries(raw.patterns ?? {}));
      log.info("memory loaded", { entries: store.entries.length, patterns: store.patterns.size });
    }
  } catch (err) {
    log.warn("failed to load memory", { error: (err as Error).message });
  }
}

function persist(): void {
  try {
    if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
    const data = {
      entries: store.entries,
      patterns: Object.fromEntries(store.patterns),
    };
    writeFileSync(MEMORY_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    log.warn("failed to persist memory", { error: (err as Error).message });
  }
}

function buildComboKey(signals: string[]): string {
  return [...signals].sort().join("+");
}

/** Generate all 2- and 3-signal combinations from a signal list. */
function signalCombos(signals: string[]): string[] {
  const sorted = [...signals].sort();
  const combos: string[] = [];

  // 2-combos
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      combos.push(`${sorted[i]}+${sorted[j]}`);
    }
  }

  // 3-combos
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      for (let k = j + 1; k < sorted.length; k++) {
        combos.push(`${sorted[i]}+${sorted[j]}+${sorted[k]}`);
      }
    }
  }

  return combos;
}

export function recordHunt(entry: Omit<MemoryEntry, "id">): MemoryEntry {
  const id = `mem-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const full: MemoryEntry = { id, ...entry };
  store.entries.push(full);

  // Trim old entries
  if (store.entries.length > MAX_ENTRIES) {
    store.entries = store.entries.slice(-MAX_ENTRIES);
  }

  // Update pattern occurrences
  const combos = signalCombos(entry.signals);
  for (const combo of combos) {
    const existing = store.patterns.get(combo);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = entry.timestamp;
    } else {
      store.patterns.set(combo, {
        combo,
        occurrences: 1,
        correctCount: 0,
        accuracy: 0,
        lastSeen: entry.timestamp,
      });
    }
  }

  persist();
  return full;
}

export function verifyEntry(id: string, outcome: "correct" | "incorrect"): boolean {
  const entry = store.entries.find(e => e.id === id);
  if (!entry || entry.verified) return false;

  entry.verified = true;
  entry.outcome = outcome;

  // Update pattern accuracy
  const combos = signalCombos(entry.signals);
  for (const combo of combos) {
    const p = store.patterns.get(combo);
    if (p) {
      if (outcome === "correct") p.correctCount++;
      // Recalculate accuracy from all verified entries matching this combo
      const verified = store.entries.filter(e => e.verified && signalCombos(e.signals).includes(combo));
      const correct = verified.filter(e => e.outcome === "correct").length;
      p.accuracy = verified.length > 0 ? correct / verified.length : 0;
    }
  }

  persist();
  return true;
}

/**
 * Compute a confidence adjustment based on learned patterns.
 * Returns a value between -15 and +15 to add to weighted confidence.
 */
export function getConfidenceAdjustment(signals: string[]): { adjustment: number; reason: string } {
  const combos = signalCombos(signals);
  let totalAdjustment = 0;
  let matchCount = 0;
  const reasons: string[] = [];

  for (const combo of combos) {
    const p = store.patterns.get(combo);
    if (!p || p.occurrences < MIN_OCCURRENCES_FOR_ACTIVE) continue;

    // Only patterns with verified outcomes contribute
    const verifiedEntries = store.entries.filter(e => e.verified && signalCombos(e.signals).includes(combo));
    if (verifiedEntries.length < 2) continue;

    matchCount++;

    if (p.accuracy >= 0.7) {
      // High accuracy → boost
      const boost = Math.round((p.accuracy - 0.5) * 30); // up to +15
      totalAdjustment += boost;
      reasons.push(`${combo} (${(p.accuracy * 100).toFixed(0)}% acc) +${boost}`);
    } else if (p.accuracy <= 0.3) {
      // Low accuracy → dampen
      const dampen = -Math.round((0.5 - p.accuracy) * 30); // down to -15
      totalAdjustment += dampen;
      reasons.push(`${combo} (${(p.accuracy * 100).toFixed(0)}% acc) ${dampen}`);
    }
  }

  // Average if multiple matches, clamp to [-15, +15]
  const adjustment = matchCount > 0
    ? Math.max(-15, Math.min(15, Math.round(totalAdjustment / matchCount)))
    : 0;

  return {
    adjustment,
    reason: reasons.length > 0 ? `memory: ${reasons.join(", ")}` : "memory: no active patterns",
  };
}

export function getStats(): MemoryStats {
  const activePatterns = [...store.patterns.values()].filter(p => p.occurrences >= MIN_OCCURRENCES_FOR_ACTIVE);

  const toInsight = (p: SignalCombination): MemoryInsight => ({
    combo: p.combo,
    accuracy: parseFloat(p.accuracy.toFixed(2)),
    occurrences: p.occurrences,
    adjustment: p.accuracy >= 0.7 ? Math.round((p.accuracy - 0.5) * 30) : p.accuracy <= 0.3 ? -Math.round((0.5 - p.accuracy) * 30) : 0,
  });

  const sorted = activePatterns.sort((a, b) => b.accuracy - a.accuracy);

  return {
    totalEntries: store.entries.length,
    verifiedEntries: store.entries.filter(e => e.verified).length,
    patterns: store.patterns.size,
    activePatterns: activePatterns.length,
    topPatterns: sorted.slice(0, 5).map(toInsight),
    weakPatterns: sorted.slice(-5).reverse().map(toInsight),
  };
}

export function getEntries(limit = 20): MemoryEntry[] {
  return store.entries.slice(-limit).reverse();
}
