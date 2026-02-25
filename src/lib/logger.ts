/**
 * Structured JSON logging — zero dependencies.
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

function emit(level: LogLevel, service: string, msg: string, meta?: Record<string, unknown>): void {
  const entry: LogEntry = { ts: new Date().toISOString(), level, service, msg, ...meta };
  const line = JSON.stringify(entry);
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
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
