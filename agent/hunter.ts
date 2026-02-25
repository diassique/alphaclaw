/**
 * AlphaClaw Hunter — Autonomous AI agent that hunts for alpha on Polymarket & DeFi.
 *
 * Payment flow:
 *   Client → [pays $0.05] → /hunt
 *   Hunter → [pays $0.01] → sentiment service
 *   Hunter → [pays $0.02] → polymarket service
 *   Hunter → [pays $0.015] → defi service
 *   Hunter synthesizes → returns alpha
 */

import express from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { networkInterfaces } from "os";
import { conditionalPaywall } from "../lib/paywall.js";
import { createPaymentHeader, selectPaymentRequirements } from "x402/client";
import { createWalletClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import dotenv from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));

dotenv.config();

const app = express();
app.use(express.json());

const {
  WALLET_ADDRESS,
  FACILITATOR_URL,
  NETWORK,
  PORT_AGENT,
  AGENT_PRIVATE_KEY,
  PORT_SENTIMENT,
  PORT_POLYMARKET,
  PORT_DEFI,
} = process.env;

const port = PORT_AGENT ?? "5000";
const SENTIMENT_URL  = `http://localhost:${PORT_SENTIMENT  ?? 4001}`;
const POLYMARKET_URL = `http://localhost:${PORT_POLYMARKET ?? 4002}`;
const DEFI_URL       = `http://localhost:${PORT_DEFI       ?? 4003}`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface X402Body {
  accepts: Array<{
    maxAmountRequired?: string;
    description?: string;
    scheme?: string;
    network?: string;
  }>;
  x402Version?: number;
}

interface X402FetchResult {
  ok: boolean;
  status: number;
  data: unknown;
  paid: boolean;
  demoMode?: boolean;
  paymentRequired?: { description?: string; amount: string };
}

interface SentimentResult {
  label: string;
  score: number;
  confidence: string;
}

interface PolymarketResult {
  topSignal: string;
  opportunities?: Array<{ question: string; alphaSignal: string; yesPrice: number }>;
}

interface DefiOpportunity {
  symbol: string;
  alphaLevel: string;
  suggestedAction: string;
  change24h: number;
}

interface DefiResult {
  topOpportunity?: DefiOpportunity;
}

interface ServiceResponse {
  ok: boolean;
  data: { result?: SentimentResult | PolymarketResult | DefiResult } | null;
  paid: boolean;
  demoMode?: boolean;
  paymentRequired?: { description?: string; amount: string };
}

interface AlphaBreakdown {
  sentiment: Pick<SentimentResult, "label" | "score" | "confidence"> | null;
  polymarket: { market: string; signal: string; yesPrice: number } | null;
  defi: { asset: string; action: string; change24h: string } | null;
}

interface AlphaSynthesis {
  confidence: string;
  recommendation: string;
  signals: string[];
  breakdown: AlphaBreakdown;
}

// ─── Wallet setup ─────────────────────────────────────────────────────────────

type WalletClientInstance = ReturnType<typeof createWalletClient>;
let walletClient: WalletClientInstance | null = null;

if (AGENT_PRIVATE_KEY) {
  try {
    const key = (AGENT_PRIVATE_KEY.startsWith("0x") ? AGENT_PRIVATE_KEY : `0x${AGENT_PRIVATE_KEY}`) as `0x${string}`;
    const account = privateKeyToAccount(key);
    walletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http("https://sepolia.base.org"),
    });
    console.log(`[hunter] Wallet loaded: ${account.address}`);
  } catch (err) {
    console.warn(`[hunter] Failed to load wallet: ${(err as Error).message}. Running in demo mode.`);
  }
} else {
  console.log("[hunter] No AGENT_PRIVATE_KEY set — running in DEMO mode (no real payments)");
}

// ─── x402-aware fetch ─────────────────────────────────────────────────────────

async function x402Fetch(url: string, options: RequestInit = {}): Promise<X402FetchResult> {
  const res = await fetch(url, options);

  if (res.status !== 402) {
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data, paid: false };
  }

  const body = await res.json() as X402Body;

  // No wallet → demo mode
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

  const paid = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers as Record<string, string>),
      "X-PAYMENT": paymentHeader,
      "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
    },
  });

  const data = await paid.json().catch(() => null);
  return { ok: paid.ok, status: paid.status, data, paid: true };
}

// ─── Sub-agent calls ──────────────────────────────────────────────────────────

async function callSentiment(text: string): Promise<ServiceResponse> {
  return x402Fetch(`${SENTIMENT_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }) as Promise<ServiceResponse>;
}

async function callPolymarket(filter: string | null): Promise<ServiceResponse> {
  return x402Fetch(`${POLYMARKET_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter, limit: 5 }),
  }) as Promise<ServiceResponse>;
}

async function callDefi(asset: string | null): Promise<ServiceResponse> {
  return x402Fetch(`${DEFI_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset, limit: 5 }),
  }) as Promise<ServiceResponse>;
}

// ─── Alpha synthesis ──────────────────────────────────────────────────────────

function synthesizeAlpha({
  topic,
  sentimentResult,
  polymarketResult,
  defiResult,
}: {
  topic?: string;
  sentimentResult: { result?: SentimentResult } | null;
  polymarketResult: { result?: PolymarketResult } | null;
  defiResult: { result?: DefiResult } | null;
}): AlphaSynthesis {
  const sentiment  = sentimentResult?.result as SentimentResult | undefined;
  const polymarket = polymarketResult?.result as PolymarketResult | undefined;
  const defi       = defiResult?.result as DefiResult | undefined;

  let confidence = 0;
  const signals: string[] = [];

  if (sentiment) {
    const s = sentiment.label;
    if (s === "strongly_bullish") { confidence += 35; signals.push("sentiment:strongly_bullish"); }
    else if (s === "bullish")     { confidence += 22; signals.push("sentiment:bullish"); }
    else if (s === "neutral")     { confidence += 10; signals.push("sentiment:neutral"); }
    else if (s === "bearish")     { confidence +=  5; signals.push("sentiment:bearish"); }
  }

  if (polymarket) {
    if (polymarket.topSignal === "HIGH")   { confidence += 35; signals.push("polymarket:HIGH_ALPHA"); }
    if (polymarket.topSignal === "MEDIUM") { confidence += 18; signals.push("polymarket:MEDIUM_ALPHA"); }
  }

  if (defi) {
    if (defi.topOpportunity?.alphaLevel === "HOT")  { confidence += 30; signals.push(`defi:HOT(${defi.topOpportunity.symbol})`); }
    if (defi.topOpportunity?.alphaLevel === "WARM") { confidence += 15; signals.push(`defi:WARM(${defi.topOpportunity.symbol})`); }
  }

  const recommendation =
    confidence >= 75 ? "🚀 STRONG BUY SIGNAL — multiple confirming indicators" :
    confidence >= 50 ? "📈 MODERATE OPPORTUNITY — proceed with position sizing" :
    confidence >= 30 ? "👀 WATCH CLOSELY — early signals forming" :
                       "⏳ WAIT — insufficient signal strength";

  const topDefi = defi?.topOpportunity;
  const topPoly = polymarket?.opportunities?.[0];

  return {
    confidence: `${Math.min(confidence, 100)}%`,
    recommendation,
    signals,
    breakdown: {
      sentiment: sentiment
        ? { label: sentiment.label, score: sentiment.score, confidence: sentiment.confidence }
        : null,
      polymarket: topPoly
        ? { market: topPoly.question, signal: topPoly.alphaSignal, yesPrice: topPoly.yesPrice }
        : null,
      defi: topDefi
        ? { asset: topDefi.symbol, action: topDefi.suggestedAction, change24h: `${topDefi.change24h}%` }
        : null,
    },
  };
}

// ─── Express paywall ──────────────────────────────────────────────────────────

conditionalPaywall(app, WALLET_ADDRESS, {
  "POST /hunt": {
    price: "$0.05",
    network: NETWORK,
    description: "AlphaClaw premium alpha hunt — synthesized Polymarket + DeFi + Sentiment signals",
  },
}, FACILITATOR_URL);

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(readFileSync(join(__dirname, "dashboard.html")));
});

// SSE stream: real-time agent-to-agent payment flow for the dashboard
app.get("/stream", async (req, res) => {
  const topic = String(req.query["topic"] ?? "ethereum DeFi bullish");

  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.status(200);

  (req.socket as import("net").Socket & { setNoDelay?: (v: boolean) => void }).setNoDelay?.(true);
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).flush?.();
  };

  const TIMEOUT_MS = 25_000;
  const abort = setTimeout(() => {
    send("error", { message: "Stream timed out" });
    send("done", {});
    res.end();
  }, TIMEOUT_MS);

  req.on("close", () => clearTimeout(abort));

  try {
    send("start", { topic, timestamp: new Date().toISOString() });

    send("paying", { service: "crypto-sentiment", amount: "$0.01" });
    const sentimentRes = await callSentiment(topic);
    send("result", { service: "crypto-sentiment", data: sentimentRes.data });

    send("paying", { service: "polymarket-alpha-scanner", amount: "$0.02" });
    const polymarketRes = await callPolymarket(null);
    send("result", { service: "polymarket-alpha-scanner", data: polymarketRes.data });

    send("paying", { service: "defi-alpha-scanner", amount: "$0.015" });
    const defiRes = await callDefi(null);
    send("result", { service: "defi-alpha-scanner", data: defiRes.data });

    const alpha = synthesizeAlpha({
      topic,
      sentimentResult:  sentimentRes.data as { result?: SentimentResult } | null,
      polymarketResult: polymarketRes.data as { result?: PolymarketResult } | null,
      defiResult:       defiRes.data as { result?: DefiResult } | null,
    });

    send("alpha", alpha);
  } catch (err) {
    send("error", { message: (err as Error).message });
  } finally {
    clearTimeout(abort);
    send("done", {});
    res.end();
  }
});

// Premium: full alpha hunt (x402 paywalled at $0.05)
app.post("/hunt", async (req, res) => {
  const { topic } = req.body as { topic?: string };

  const [sentimentRes, polymarketRes, defiRes] = await Promise.all([
    callSentiment(topic ?? "crypto market bullish rally pump ethereum solana breakout momentum"),
    callPolymarket(topic ?? null),
    callDefi(topic ?? null),
  ]);

  const alpha = synthesizeAlpha({
    topic,
    sentimentResult:  sentimentRes.data as { result?: SentimentResult } | null,
    polymarketResult: polymarketRes.data as { result?: PolymarketResult } | null,
    defiResult:       defiRes.data as { result?: DefiResult } | null,
  });

  const paymentLog = {
    totalPaid: walletClient ? "$0.045 USDC to 3 sub-agents" : "demo mode — no wallet",
    breakdown: [
      { service: "crypto-sentiment",        price: "$0.010", paid: sentimentRes.paid  },
      { service: "polymarket-alpha-scanner", price: "$0.020", paid: polymarketRes.paid },
      { service: "defi-alpha-scanner",       price: "$0.015", paid: defiRes.paid       },
    ],
  };

  res.json({
    service: "alphaclaw-hunter",
    timestamp: new Date().toISOString(),
    topic: topic ?? "general",
    alpha,
    agentPayments: paymentLog,
    rawInputs: {
      sentiment:  sentimentRes.data  ?? sentimentRes.paymentRequired,
      polymarket: polymarketRes.data ?? polymarketRes.paymentRequired,
      defi:       defiRes.data       ?? defiRes.paymentRequired,
    },
  });
});

app.get("/ping", (_req, res) => {
  res.json({
    service: "alphaclaw-hunter",
    status: "hunting",
    walletConnected: !!walletClient,
    message: "AlphaClaw is live. POST /hunt with $0.05 USDC to get premium alpha signals.",
    agentPays: {
      "crypto-sentiment":         `${SENTIMENT_URL}/analyze  → $0.01`,
      "polymarket-alpha-scanner": `${POLYMARKET_URL}/scan    → $0.02`,
      "defi-alpha-scanner":       `${DEFI_URL}/scan          → $0.015`,
    },
    totalSubAgentCost: "$0.045 per hunt",
    sellingAt: "$0.05 per hunt (margin: $0.005 USDC)",
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "alphaclaw-hunter", port, walletConnected: !!walletClient });
});

app.get("/health-all", async (_req, res) => {
  interface ServiceProbeResult {
    name: string;
    status: "ok" | "error" | "offline";
    port?: number;
  }

  async function probe(name: string, url: string): Promise<ServiceProbeResult> {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
      const body = await r.json().catch(() => ({})) as { port?: number };
      return { name, status: r.ok ? "ok" : "error", ...(body.port ? { port: body.port } : {}) };
    } catch {
      return { name, status: "offline" };
    }
  }

  const results = await Promise.all([
    probe("alphaclaw-hunter",         `http://localhost:${port}/health`),
    probe("crypto-sentiment",         `${SENTIMENT_URL}/health`),
    probe("polymarket-alpha-scanner", `${POLYMARKET_URL}/health`),
    probe("defi-alpha-scanner",       `${DEFI_URL}/health`),
  ]);

  const all = results.every((r) => r.status === "ok");
  res.json({ ok: all, services: results });
});

function getLocalIP(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

app.listen(parseInt(port), "0.0.0.0", () => {
  const ip = getLocalIP();
  console.log(`[agent/hunter] AlphaClaw Hunter`);
  console.log(`  Local:     http://localhost:${port}`);
  if (ip) console.log(`  Network:   http://${ip}:${port}  ← open this on your laptop`);
  console.log(`  Dashboard: http://${ip ?? "localhost"}:${port}/`);
});
