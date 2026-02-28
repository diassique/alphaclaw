import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";
import { createLogger } from "../lib/logger.js";
import { config } from "../config/env.js";
import type { X402Body, X402FetchResult } from "../types/index.js";

const log = createLogger("coordinator");

const SUB_CALL_TIMEOUT = 15_000;
const X402_MAX_RETRIES = 2;
const X402_RETRY_BASE_MS = 400;

// ─── Wallet setup ─────────────────────────────────────────────────────────────

type WalletClientInstance = ReturnType<typeof createWalletClient>;
export let walletClient: WalletClientInstance | null = null;

if (config.agentPrivateKey) {
  try {
    const key = (config.agentPrivateKey.startsWith("0x") ? config.agentPrivateKey : `0x${config.agentPrivateKey}`) as `0x${string}`;
    const account = privateKeyToAccount(key);
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http("https://sepolia.base.org"),
    });
    log.info("wallet loaded", { address: account.address });
  } catch (err) {
    log.warn("failed to load wallet — demo mode", { error: (err as Error).message });
  }
} else {
  log.info("no AGENT_PRIVATE_KEY — running in DEMO mode (no real payments)");
}

// ─── x402-aware fetch with timeout + retry on transaction_failed ────────────

async function attemptPayment(
  url: string,
  options: RequestInit,
  body: X402Body,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<X402FetchResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const selected = selectPaymentRequirements(body.accepts as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const paymentHeader = await createPaymentHeader(walletClient as any, body.x402Version ?? 1, selected);

  const payController = new AbortController();
  const payTimer = setTimeout(() => payController.abort(), timeoutMs);
  signal?.addEventListener("abort", () => payController.abort(), { once: true });

  try {
    const paid = await fetch(url, {
      ...options,
      signal: payController.signal,
      headers: {
        ...(options.headers as Record<string, string>),
        "X-PAYMENT": paymentHeader,
        "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
      },
    });
    clearTimeout(payTimer);

    const paymentResponse = paid.headers.get("X-PAYMENT-RESPONSE");
    let txHash: string | undefined;
    try {
      if (paymentResponse) {
        const pr = JSON.parse(paymentResponse) as { transaction?: string };
        txHash = pr.transaction;
      }
    } catch { /* ignore */ }

    const data = await paid.json().catch(() => null);
    return { ok: paid.ok, status: paid.status, data, paid: true, txHash };
  } finally {
    clearTimeout(payTimer);
  }
}

export async function x402Fetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = SUB_CALL_TIMEOUT,
  signal?: AbortSignal,
): Promise<X402FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  // Internal localhost bypass: skip x402 paywall for intra-service calls
  const isLocalhost = url.startsWith("http://localhost") || url.startsWith("http://127.0.0.1");

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      ...(isLocalhost ? { headers: { ...(options.headers as Record<string, string>), "X-INTERNAL": "bypass" } } : {}),
    });
    clearTimeout(timer);

    if (res.status !== 402) {
      const data = await res.json().catch(() => null);
      const acpHeaders = extractACPHeaders(res);
      return { ok: res.ok, status: res.status, data, paid: false, ...(acpHeaders ? { acpHeaders } : {}) };
    }

    // If localhost and still getting 402, pass through without payment (demo data)
    if (isLocalhost) {
      log.info("localhost x402 bypass — retrying with internal header", { url: url.split("/").pop() });
      // Re-fetch with X-INTERNAL bypass (handled in paywall.ts before x402 middleware)
      const bypassRes = await fetch(url, {
        ...options,
        headers: { ...(options.headers as Record<string, string>), "X-INTERNAL": "bypass" },
        signal: AbortSignal.timeout(timeoutMs),
      });
      const data = await bypassRes.json().catch(() => null);
      return { ok: bypassRes.ok, status: bypassRes.status, data, paid: false, demoMode: true };
    }

    const body = await res.json() as X402Body;

    if (!walletClient) {
      const req = Array.isArray(body.accepts) ? body.accepts[0] : null;
      const amount = req ? `$${(parseInt(req.maxAmountRequired ?? "0") / 1_000_000).toFixed(3)}` : "?";
      return {
        ok: false,
        status: 402,
        demoMode: true,
        paymentRequired: { description: req?.description, amount },
        data: null,
        paid: false,
      };
    }

    // Attempt payment with retries on transaction_failed
    for (let attempt = 0; attempt <= X402_MAX_RETRIES; attempt++) {
      const result = await attemptPayment(url, options, body, timeoutMs, signal);

      // Check if the response is transaction_failed
      const respData = result.data as Record<string, unknown> | null;
      const isTransactionFailed = respData?.["error"] === "transaction_failed";

      if (!isTransactionFailed || attempt === X402_MAX_RETRIES) {
        if (isTransactionFailed) {
          log.warn("x402 payment failed after retries", { url: url.split("/").pop(), attempts: attempt + 1 });
        }
        return result;
      }

      // Wait with jittered backoff before retry
      const delay = X402_RETRY_BASE_MS * (attempt + 1) + Math.random() * 200;
      log.info("x402 transaction_failed, retrying", { url: url.split("/").pop(), attempt: attempt + 1, delayMs: Math.round(delay) });
      await new Promise(r => setTimeout(r, delay));
    }

    // Should never reach here, but TypeScript needs it
    return { ok: false, status: 500, data: null, paid: false };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  } finally {
    signal?.removeEventListener("abort", onExternalAbort);
  }
}

// ─── ACP header extraction ───────────────────────────────────────────────────

const ACP_HEADER_KEYS = ["x-acp-confidence", "x-acp-stake", "x-acp-direction", "x-acp-version"];

function extractACPHeaders(res: Response): Record<string, string> | null {
  const headers: Record<string, string> = {};
  let found = false;
  for (const key of ACP_HEADER_KEYS) {
    const val = res.headers.get(key);
    if (val) { headers[key] = val; found = true; }
  }
  return found ? headers : null;
}
