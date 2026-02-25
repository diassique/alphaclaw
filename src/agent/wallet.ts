import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";
import { createLogger } from "../lib/logger.js";
import { config } from "../config/env.js";
import type { X402Body, X402FetchResult } from "../types/index.js";

const log = createLogger("coordinator");

const SUB_CALL_TIMEOUT = 15_000;

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

// ─── x402-aware fetch with timeout ──────────────────────────────────────────

export async function x402Fetch(
  url: string,
  options: RequestInit = {},
  timeoutMs = SUB_CALL_TIMEOUT,
  signal?: AbortSignal,
): Promise<X402FetchResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // If an external signal is provided, abort our controller when it fires
  const onExternalAbort = () => controller.abort();
  signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);

    if (res.status !== 402) {
      const data = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, data, paid: false };
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const selected = selectPaymentRequirements(body.accepts as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const paymentHeader = await createPaymentHeader(walletClient as any, body.x402Version ?? 1, selected);

    // Second fetch with payment — also protected by AbortController + timeout
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
    } catch (err) {
      clearTimeout(payTimer);
      throw err;
    }
  } catch (err) {
    clearTimeout(timer);
    throw err;
  } finally {
    signal?.removeEventListener("abort", onExternalAbort);
  }
}
