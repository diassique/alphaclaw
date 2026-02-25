/**
 * Fetch wrapper with retry + exponential backoff.
 * Retries on network errors, timeout, 429, 5xx. Does not retry other 4xx.
 */

export interface FetchRetryOpts {
  /** Max retries (default 2) */
  retries?: number;
  /** Timeout per request in ms (default 8000) */
  timeoutMs?: number;
  /** Base delay in ms (doubles each retry, default 500) */
  baseDelayMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || status >= 500;
}

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  opts?: FetchRetryOpts,
): Promise<Response> {
  const maxRetries = opts?.retries ?? 2;
  const timeoutMs = opts?.timeoutMs ?? 8000;
  const baseDelay = opts?.baseDelayMs ?? 500;

  let lastError: Error | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);

      if (res.ok || !isRetryable(res.status)) {
        return res;
      }
      // Retryable HTTP status — fall through to retry
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      clearTimeout(timer);
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < maxRetries) {
      await sleep(baseDelay * Math.pow(2, attempt));
    }
  }

  throw lastError ?? new Error("fetchWithRetry: exhausted retries");
}
