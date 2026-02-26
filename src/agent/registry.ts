/**
 * Dynamic Agent Registry — external agents register, compete, get health-checked.
 *
 * Built-in services are seeded from SERVICE_DEFS on load.
 * External agents register via POST /registry/register and are
 * health-checked every 60s (offline after 3 consecutive failures).
 */

import { createLogger } from "../lib/logger.js";
import { createStore } from "../lib/store.js";
import { SERVICE_DEFS } from "../config/services.js";
import type { AgentRegistration, AgentEntry, BUILTIN_KEYS } from "../types/index.js";

const log = createLogger("registry");

const HEALTH_INTERVAL_MS = 60_000;
const HEALTH_TIMEOUT_MS = 5_000;
const MAX_FAILURES = 3;

// ─── Persistence ─────────────────────────────────────────────────────────────

interface RegistryData {
  version: number;
  external: AgentRegistration[];
}

const store = createStore<RegistryData>({
  filename: "registry.json",
  defaultValue: { version: 1, external: [] },
  debounceMs: 5000,
});

// ─── State ───────────────────────────────────────────────────────────────────

const agents = new Map<string, AgentEntry>();
let healthTimer: ReturnType<typeof setInterval> | null = null;

// ─── Built-in seeding ────────────────────────────────────────────────────────

const BUILTIN_SERVICE_KEYS = new Set<string>(["sentiment", "sentiment2", "polymarket", "defi", "news", "whale"]);

function seedBuiltins(): void {
  for (const [key, def] of Object.entries(SERVICE_DEFS)) {
    if (!BUILTIN_SERVICE_KEYS.has(key)) continue;
    agents.set(key, {
      key,
      displayName: def.displayName,
      url: `http://localhost:${def.port}`,
      endpoint: def.endpoint,
      price: def.price,
      description: def.description,
      category: key === "news" ? "news" : key === "whale" ? "onchain" : key === "polymarket" ? "prediction" : key === "defi" ? "defi" : "sentiment",
      builtin: true,
      online: true,
      registeredAt: new Date().toISOString(),
      lastHealthCheck: null,
      healthFailures: 0,
    });
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function loadRegistry(): void {
  store.load();
  seedBuiltins();

  // Restore persisted external agents
  const data = store.get();
  for (const reg of data.external) {
    if (BUILTIN_SERVICE_KEYS.has(reg.key)) continue; // don't overwrite built-in
    agents.set(reg.key, {
      ...reg,
      builtin: false,
      online: false, // assume offline until health-checked
      registeredAt: new Date().toISOString(),
      lastHealthCheck: null,
      healthFailures: 0,
    });
  }

  log.info("registry loaded", { builtin: BUILTIN_SERVICE_KEYS.size, external: data.external.length });
}

export function registerAgent(reg: AgentRegistration): AgentEntry {
  if (BUILTIN_SERVICE_KEYS.has(reg.key)) {
    throw new Error(`Cannot overwrite built-in service: ${reg.key}`);
  }

  const entry: AgentEntry = {
    ...reg,
    builtin: false,
    online: false,
    registeredAt: new Date().toISOString(),
    lastHealthCheck: null,
    healthFailures: 0,
  };

  agents.set(reg.key, entry);
  saveExternal();
  log.info("agent registered", { key: reg.key, url: reg.url });

  // Immediately health-check
  checkAgentHealth(entry).catch(() => {});

  return entry;
}

export function unregisterAgent(key: string): boolean {
  if (BUILTIN_SERVICE_KEYS.has(key)) {
    throw new Error(`Cannot unregister built-in service: ${key}`);
  }
  const removed = agents.delete(key);
  if (removed) {
    saveExternal();
    log.info("agent unregistered", { key });
  }
  return removed;
}

export function getAgent(key: string): AgentEntry | undefined {
  return agents.get(key);
}

export function getAllAgents(): AgentEntry[] {
  return Array.from(agents.values());
}

export function getExternalAgents(): AgentEntry[] {
  return Array.from(agents.values()).filter(a => !a.builtin);
}

export function getOnlineExternalAgents(): AgentEntry[] {
  return Array.from(agents.values()).filter(a => !a.builtin && a.online);
}

export function getAllAgentKeys(): string[] {
  return Array.from(agents.keys());
}

export function isBuiltin(key: string): boolean {
  return BUILTIN_SERVICE_KEYS.has(key);
}

// ─── Health Checks ───────────────────────────────────────────────────────────

async function checkAgentHealth(entry: AgentEntry): Promise<void> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);

    const res = await fetch(`${entry.url}/health`, { signal: controller.signal });
    clearTimeout(timer);

    if (res.ok) {
      entry.online = true;
      entry.healthFailures = 0;
      entry.lastHealthCheck = new Date().toISOString();
    } else {
      entry.healthFailures++;
      entry.lastHealthCheck = new Date().toISOString();
      if (entry.healthFailures >= MAX_FAILURES) {
        entry.online = false;
      }
    }
  } catch {
    entry.healthFailures++;
    entry.lastHealthCheck = new Date().toISOString();
    if (entry.healthFailures >= MAX_FAILURES) {
      entry.online = false;
    }
  }
}

async function runHealthChecks(): Promise<void> {
  const external = getExternalAgents();
  if (external.length === 0) return;

  await Promise.allSettled(external.map(a => checkAgentHealth(a)));
  saveExternal();
}

export function startHealthChecks(): void {
  if (healthTimer) return;
  // Run once immediately
  runHealthChecks().catch(() => {});
  healthTimer = setInterval(() => {
    runHealthChecks().catch(() => {});
  }, HEALTH_INTERVAL_MS);
  healthTimer.unref();
  log.info("health checks started", { intervalMs: HEALTH_INTERVAL_MS });
}

export function stopHealthChecks(): void {
  if (healthTimer) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

// ─── Persistence helpers ─────────────────────────────────────────────────────

function saveExternal(): void {
  const external: AgentRegistration[] = getExternalAgents().map(a => ({
    key: a.key,
    displayName: a.displayName,
    url: a.url,
    endpoint: a.endpoint,
    price: a.price,
    description: a.description,
    category: a.category,
  }));
  store.set({ version: 1, external });
}
