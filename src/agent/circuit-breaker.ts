import { createLogger } from "../lib/logger.js";
import type { ServiceKey, CircuitState, CircuitBreakerEntry, CircuitBreakerStatus } from "../types/index.js";

const log = createLogger("circuit-breaker");

const FAILURE_THRESHOLD = 3;
const OPEN_DURATION_MS = 2 * 60_000; // 2 minutes

interface InternalCircuit {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  openedAt: number;
}

const circuits = new Map<ServiceKey, InternalCircuit>();

function getOrCreate(key: ServiceKey): InternalCircuit {
  let c = circuits.get(key);
  if (!c) {
    c = { state: "closed", failures: 0, lastFailure: 0, lastSuccess: 0, openedAt: 0 };
    circuits.set(key, c);
  }
  return c;
}

export function isServiceAvailable(key: ServiceKey): boolean {
  const c = getOrCreate(key);

  if (c.state === "closed") return true;

  if (c.state === "open") {
    // Check if enough time passed → transition to half-open
    if (Date.now() - c.openedAt >= OPEN_DURATION_MS) {
      c.state = "half-open";
      log.info("circuit half-open (probing)", { service: key });
      return true; // allow one probe request
    }
    return false;
  }

  // half-open: allow one probe
  return true;
}

export function recordSuccess(key: ServiceKey): void {
  const c = getOrCreate(key);
  c.lastSuccess = Date.now();

  if (c.state === "half-open") {
    c.state = "closed";
    c.failures = 0;
    log.info("circuit closed (recovered)", { service: key });
  } else if (c.state === "closed") {
    c.failures = 0;
  }
}

export function recordFailure(key: ServiceKey): void {
  const c = getOrCreate(key);
  c.failures++;
  c.lastFailure = Date.now();

  if (c.state === "half-open") {
    // Probe failed → back to open
    c.state = "open";
    c.openedAt = Date.now();
    log.warn("circuit re-opened (probe failed)", { service: key });
    return;
  }

  if (c.state === "closed" && c.failures >= FAILURE_THRESHOLD) {
    c.state = "open";
    c.openedAt = Date.now();
    log.warn("circuit opened", { service: key, failures: c.failures });
  }
}

export function getCircuitSnapshot(): CircuitBreakerStatus {
  const snapshot: CircuitBreakerStatus = {};
  for (const [key, c] of circuits) {
    snapshot[key] = { ...c };
  }
  return snapshot;
}

export function getCircuitEntry(key: ServiceKey): CircuitBreakerEntry {
  const c = getOrCreate(key);
  // Re-check open→half-open transition for accurate reporting
  if (c.state === "open" && Date.now() - c.openedAt >= OPEN_DURATION_MS) {
    c.state = "half-open";
  }
  return { ...c };
}

/**
 * Wrap a service call with circuit breaker protection.
 * Returns null if circuit is open (service skipped).
 */
export async function guardedCall<T>(
  key: ServiceKey,
  fn: () => Promise<T>,
): Promise<T | null> {
  if (!isServiceAvailable(key)) {
    log.info("circuit open — skipping service", { service: key });
    return null;
  }

  try {
    const result = await fn();
    recordSuccess(key);
    return result;
  } catch (err) {
    recordFailure(key);
    throw err;
  }
}
