import { readFileSync, existsSync, renameSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createLogger } from "../lib/logger.js";
import { createStore } from "../lib/store.js";
import type { MemoryEntry, SignalCombination, MemoryInsight, MemoryStats } from "../types/index.js";

const log = createLogger("memory");

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, "../../data");
const OLD_MEMORY_FILE = join(DATA_DIR, "memory.json");
const MAX_ENTRIES = 500;
const MIN_OCCURRENCES_FOR_ACTIVE = 3;

// ─── Persistence ────────────────────────────────────────────────────────────

interface EntriesData {
  entries: MemoryEntry[];
}

interface PatternsData {
  patterns: Record<string, SignalCombination>;
}

const entriesStore = createStore<EntriesData>({
  filename: "memory-entries.json",
  defaultValue: { entries: [] },
  debounceMs: 5000,
});

const patternsStore = createStore<PatternsData>({
  filename: "memory-patterns.json",
  defaultValue: { patterns: {} },
  debounceMs: 5000,
});

// ─── In-memory state ────────────────────────────────────────────────────────

interface MemoryState {
  entries: MemoryEntry[];
  patterns: Map<string, SignalCombination>;
}

const state: MemoryState = { entries: [], patterns: new Map() };

function saveEntries(): void {
  entriesStore.set({ entries: state.entries });
}

function savePatterns(): void {
  patternsStore.set({ patterns: Object.fromEntries(state.patterns) });
}

// ─── Migration from old memory.json ─────────────────────────────────────────

function migrateOldMemory(): void {
  try {
    if (!existsSync(OLD_MEMORY_FILE)) return;

    // Only migrate if new files don't exist yet
    const entriesPath = join(DATA_DIR, "memory-entries.json");
    const patternsPath = join(DATA_DIR, "memory-patterns.json");
    if (existsSync(entriesPath) || existsSync(patternsPath)) return;

    const raw = JSON.parse(readFileSync(OLD_MEMORY_FILE, "utf-8")) as {
      entries?: MemoryEntry[];
      patterns?: Record<string, SignalCombination>;
    };

    state.entries = raw.entries ?? [];
    state.patterns = new Map(Object.entries(raw.patterns ?? {}));

    // Save to new stores
    saveEntries();
    savePatterns();
    entriesStore.flush();
    patternsStore.flush();

    // Rename old file
    renameSync(OLD_MEMORY_FILE, OLD_MEMORY_FILE + ".migrated");
    log.info("migrated old memory.json", { entries: state.entries.length, patterns: state.patterns.size });
  } catch (err) {
    log.warn("memory migration failed", { error: (err as Error).message });
  }
}

// ─── Load ───────────────────────────────────────────────────────────────────

export function loadMemory(): void {
  // Run migration first (no-op if already migrated)
  migrateOldMemory();

  entriesStore.load();
  patternsStore.load();

  const entriesData = entriesStore.get();
  const patternsData = patternsStore.get();

  state.entries = entriesData.entries ?? [];
  state.patterns = new Map(Object.entries(patternsData.patterns ?? {}));

  log.info("memory loaded", { entries: state.entries.length, patterns: state.patterns.size });
}

// ─── Helpers ────────────────────────────────────────────────────────────────

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
  state.entries.push(full);

  // Trim old entries
  if (state.entries.length > MAX_ENTRIES) {
    state.entries = state.entries.slice(-MAX_ENTRIES);
  }

  // Update pattern occurrences
  const combos = signalCombos(entry.signals);
  for (const combo of combos) {
    const existing = state.patterns.get(combo);
    if (existing) {
      existing.occurrences++;
      existing.lastSeen = entry.timestamp;
    } else {
      state.patterns.set(combo, {
        combo,
        occurrences: 1,
        correctCount: 0,
        accuracy: 0,
        lastSeen: entry.timestamp,
      });
    }
  }

  saveEntries();
  savePatterns();
  return full;
}

export function verifyEntry(id: string, outcome: "correct" | "incorrect"): boolean {
  const entry = state.entries.find(e => e.id === id);
  if (!entry || entry.verified) return false;

  entry.verified = true;
  entry.outcome = outcome;

  // Update pattern accuracy
  const combos = signalCombos(entry.signals);
  for (const combo of combos) {
    const p = state.patterns.get(combo);
    if (p) {
      if (outcome === "correct") p.correctCount++;
      // Recalculate accuracy from all verified entries matching this combo
      const verified = state.entries.filter(e => e.verified && signalCombos(e.signals).includes(combo));
      const correct = verified.filter(e => e.outcome === "correct").length;
      p.accuracy = verified.length > 0 ? correct / verified.length : 0;
    }
  }

  saveEntries();
  savePatterns();
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
    const p = state.patterns.get(combo);
    if (!p || p.occurrences < MIN_OCCURRENCES_FOR_ACTIVE) continue;

    // Only patterns with verified outcomes contribute
    const verifiedEntries = state.entries.filter(e => e.verified && signalCombos(e.signals).includes(combo));
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
  const activePatterns = [...state.patterns.values()].filter(p => p.occurrences >= MIN_OCCURRENCES_FOR_ACTIVE);

  const toInsight = (p: SignalCombination): MemoryInsight => ({
    combo: p.combo,
    accuracy: parseFloat(p.accuracy.toFixed(2)),
    occurrences: p.occurrences,
    adjustment: p.accuracy >= 0.7 ? Math.round((p.accuracy - 0.5) * 30) : p.accuracy <= 0.3 ? -Math.round((0.5 - p.accuracy) * 30) : 0,
  });

  const sorted = activePatterns.sort((a, b) => b.accuracy - a.accuracy);

  return {
    totalEntries: state.entries.length,
    verifiedEntries: state.entries.filter(e => e.verified).length,
    patterns: state.patterns.size,
    activePatterns: activePatterns.length,
    topPatterns: sorted.slice(0, 5).map(toInsight),
    weakPatterns: sorted.slice(-5).reverse().map(toInsight),
  };
}

export function getEntries(limit = 20): MemoryEntry[] {
  return state.entries.slice(-limit).reverse();
}
