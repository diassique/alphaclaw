/**
 * Structured JSON logging — zero dependencies, async buffered writes.
 * Each service creates its own logger: `createLogger("sentiment")`.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogEntry {
  ts: string;
  level: LogLevel;
  service: string;
  msg: string;
  [key: string]: unknown;
}

// ─── Async write buffer ──────────────────────────────────────────────────────

const FLUSH_INTERVAL = 50; // ms
const MAX_BUFFER = 100;

let stdoutBuf: string[] = [];
let stderrBuf: string[] = [];

function flushStdout(): void {
  if (stdoutBuf.length === 0) return;
  const batch = stdoutBuf.join("");
  stdoutBuf = [];
  process.stdout.write(batch);
}

function flushStderr(): void {
  if (stderrBuf.length === 0) return;
  const batch = stderrBuf.join("");
  stderrBuf = [];
  process.stderr.write(batch);
}

const stdoutTimer = setInterval(flushStdout, FLUSH_INTERVAL);
const stderrTimer = setInterval(flushStderr, FLUSH_INTERVAL);
stdoutTimer.unref();
stderrTimer.unref();

// Flush on exit
process.on("beforeExit", () => { flushStdout(); flushStderr(); });

function emit(level: LogLevel, service: string, msg: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, service, msg, ...meta };
  const line = JSON.stringify(entry) + "\n";
  if (level === "error" || level === "warn") {
    stderrBuf.push(line);
    if (stderrBuf.length >= MAX_BUFFER) flushStderr();
  } else {
    stdoutBuf.push(line);
    if (stdoutBuf.length >= MAX_BUFFER) flushStdout();
  }
}

export interface Logger {
  debug: (msg: string, meta?: Record<string, unknown>) => void;
  info:  (msg: string, meta?: Record<string, unknown>) => void;
  warn:  (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

export function createLogger(service: string): Logger {
  return {
    debug: (msg, meta) => emit("debug", service, msg, meta),
    info:  (msg, meta) => emit("info",  service, msg, meta),
    warn:  (msg, meta) => emit("warn",  service, msg, meta),
    error: (msg, meta) => emit("error", service, msg, meta),
  };
}
