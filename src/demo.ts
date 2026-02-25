/**
 * AlphaClaw Demo — shows the full agent-to-agent x402 payment flow in the terminal.
 *
 * Usage:
 *   tsx src/demo.ts              # full demo (services must be running)
 *   tsx src/demo.ts --health     # just check health of all services
 *   tsx src/demo.ts --topic eth  # hunt alpha for a specific topic
 */

import { config } from "./config/env.js";

const PORT_SENTIMENT  = config.ports.sentiment;
const PORT_POLYMARKET = config.ports.polymarket;
const PORT_DEFI       = config.ports.defi;
const PORT_AGENT      = config.ports.agent;

const args      = process.argv.slice(2);
const topicIdx  = args.indexOf("--topic");
const topic     = topicIdx !== -1 ? args[topicIdx + 1] : undefined;
const healthOnly = args.includes("--health");

// ─── Styling ──────────────────────────────────────────────────────────────────

type ColorName = "reset" | "bold" | "dim" | "cyan" | "green" | "yellow" | "red" | "blue" | "magenta" | "white";

const C: Record<ColorName, string> = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  white:   "\x1b[37m",
};

const c   = (color: ColorName, s: string): string => `${C[color]}${s}${C.reset}`;
const b   = (s: string): string => `${C.bold}${s}${C.reset}`;
const dim = (s: string): string => `${C.dim}${s}${C.reset}`;

function banner(): void {
  console.log(`
${c("cyan", C.bold + `
  █████╗ ██╗     ██████╗ ██╗  ██╗ █████╗     ██████╗██╗      █████╗ ██╗    ██╗
 ██╔══██╗██║     ██╔══██╗██║  ██║██╔══██╗   ██╔════╝██║     ██╔══██╗██║    ██║
 ███████║██║     ██████╔╝███████║███████║   ██║     ██║     ███████║██║ █╗ ██║
 ██╔══██║██║     ██╔═══╝ ██╔══██║██╔══██║   ██║     ██║     ██╔══██║██║███╗██║
 ██║  ██║███████╗██║     ██║  ██║██║  ██║   ╚██████╗███████╗██║  ██║╚███╔███╔╝
 ╚═╝  ╚═╝╚══════╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═╝    ╚═════╝╚══════╝╚═╝  ╚═╝ ╚══╝╚══╝
` + C.reset)}
  ${b("Autonomous AI Agent Network")} ${dim("— hunting alpha on Polymarket & DeFi via x402 micropayments")}
  ${dim("─────────────────────────────────────────────────────────────────────────────────")}
`);
}

type PayStatus = "paid" | "demo" | "error" | "pending";

function step(emoji: string, label: string, detail = ""): void {
  console.log(`  ${emoji}  ${b(label)}${detail ? "  " + dim(detail) : ""}`);
}

function payRow(service: string, port: string | number, price: string, status: PayStatus): void {
  const statusStr =
    status === "paid"    ? c("green",  "✓ PAID") :
    status === "demo"    ? c("yellow", "◎ DEMO") :
    status === "error"   ? c("red",    "✗ ERROR") :
                           c("blue",   "→ PENDING");
  console.log(`     ${dim("└─")} ${c("cyan", service.padEnd(28))} ${dim("port " + port)}  ${c("yellow", price)}  ${statusStr}`);
}

function divider(char = "─", len = 80): void {
  console.log(dim(char.repeat(len)));
}

// ─── Health check ─────────────────────────────────────────────────────────────

async function checkHealth(name: string, url: string): Promise<boolean> {
  try {
    const res  = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    const body = await res.json() as { status?: string };
    const ok   = res.ok && body.status === "ok";
    console.log(`  ${ok ? c("green", "●") : c("red", "●")}  ${name.padEnd(30)} ${ok ? c("green", "online") : c("red", "offline")}`);
    return ok;
  } catch {
    console.log(`  ${c("red", "●")}  ${name.padEnd(30)} ${c("red", "offline")}`);
    return false;
  }
}

// ─── Main demo ────────────────────────────────────────────────────────────────

async function runDemo(): Promise<void> {
  banner();

  step("🏥", "Service Health Check");
  divider();
  const services = [
    { name: `Sentiment Analysis (port ${PORT_SENTIMENT})`,      url: `http://localhost:${PORT_SENTIMENT}` },
    { name: `Prediction Markets (port ${PORT_POLYMARKET})`,     url: `http://localhost:${PORT_POLYMARKET}` },
    { name: `DeFi Trends (port ${PORT_DEFI})`,                  url: `http://localhost:${PORT_DEFI}` },
    { name: `AlphaClaw Hunter (port ${PORT_AGENT})`,            url: `http://localhost:${PORT_AGENT}` },
  ];

  const healths = await Promise.all(services.map((s) => checkHealth(s.name, s.url)));
  divider();

  if (healthOnly) {
    console.log();
    if (healths.every(Boolean)) {
      console.log(`  ${c("green", "All systems operational")}\n`);
    } else {
      console.log(`  ${c("red", "Some services are offline — run: npm start")}\n`);
    }
    return;
  }

  if (!healths[3]) {
    console.log(`\n  ${c("red", "✗")} AlphaClaw Hunter is not running.\n`);
    console.log(`  Start all services first:\n    ${c("cyan", "npm start")}\n`);
    process.exit(1);
  }

  console.log();

  step("🔍", "Checking AlphaClaw Hunter status");
  divider();
  try {
    const ping = await fetch(`http://localhost:${PORT_AGENT}/ping`);
    const data = await ping.json() as {
      message?: string;
      walletConnected?: boolean;
      totalSubAgentCost?: string;
    };
    console.log(`  ${c("green", "Hunter is live.")}  ${dim(data.message ?? "")}`);
    console.log(`  ${dim("Wallet:")} ${data.walletConnected ? c("green", "connected") : c("yellow", "demo mode (no AGENT_PRIVATE_KEY)")}`);
    console.log(`  ${dim("Sub-agent cost:")} ${c("yellow", data.totalSubAgentCost ?? "$0.045")}  ${dim("— selling at")} ${c("green", "$0.05")}`);
  } catch (err) {
    console.log(`  ${c("red", "Failed to ping hunter:")} ${(err as Error).message}`);
  }
  divider();
  console.log();

  const huntTopic = topic ?? "ethereum DeFi bullish rally breakout";
  step("🎯", "Starting Alpha Hunt", `topic: "${huntTopic}"`);
  divider();
  console.log(`\n  ${b("Requesting:")} POST /hunt @ http://localhost:${PORT_AGENT}`);
  console.log(`  ${b("Cost:")} ${c("yellow", "$0.05 USDC")} (paid by you to AlphaClaw Hunter)\n`);

  console.log(`  ${c("blue", "Step 1")} — Client sends request without payment`);
  let firstRes: Response | undefined;
  try {
    firstRes = await fetch(`http://localhost:${PORT_AGENT}/hunt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic: huntTopic }),
    });
  } catch (err) {
    console.log(`  ${c("red", "Cannot reach hunter:")} ${(err as Error).message}\n`);
    return;
  }

  if (firstRes.status === 402) {
    const req = await firstRes.json() as { accepts?: Array<{ scheme?: string; network?: string; description?: string }> };
    const pr  = req.accepts?.[0];
    console.log(`  ${c("yellow", "← HTTP 402")} Payment Required`);
    if (pr) {
      console.log(`     ${dim("scheme:")}  ${pr.scheme ?? ""}`);
      console.log(`     ${dim("network:")} ${pr.network ?? ""}`);
      console.log(`     ${dim("price:")}   ${c("yellow", pr.description ?? "")}`);
    }
    console.log();
    console.log(`  ${c("blue", "Step 2")} — Client creates USDC payment on Base Sepolia`);
    console.log(`  ${c("blue", "Step 3")} — Client retries with ${c("cyan", "X-PAYMENT")} header`);
    console.log();
    console.log(`  ${c("yellow", "Note:")} No AGENT_PRIVATE_KEY — showing demo flow below with direct service calls.\n`);
  } else if (firstRes.ok) {
    console.log(`  ${c("green", "← HTTP 200")} (payment accepted or demo mode)\n`);
  }

  console.log(`  ${c("magenta", "Agent-to-Agent Payment Flow:")}\n`);

  interface SentimentResp { result?: { label?: string; score?: number; confidence?: string } }
  interface PolyResp      { result?: { opportunities?: Array<{ question?: string; alphaSignal?: string; yesPrice?: number; noPrice?: number }> } }
  interface DefiResp      { result?: { topOpportunity?: { symbol?: string; alphaLevel?: string; change24h?: number; suggestedAction?: string } } }

  // ── Sentiment ──
  console.log(`  ${c("blue", "→")} Calling ${b("Sentiment Analysis")} — paying ${c("yellow", "$0.01")}`);
  let sentimentData: SentimentResp | null = null;
  try {
    const r1 = await fetch(`http://localhost:${PORT_SENTIMENT}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: huntTopic }),
    });
    if (r1.status === 402) {
      payRow("crypto-sentiment", PORT_SENTIMENT, "$0.01", "demo");
      console.log(`     ${dim("Would pay $0.01 USDC — got 402 (no agent wallet)")}`);
    } else {
      sentimentData = await r1.json() as SentimentResp;
      payRow("crypto-sentiment", PORT_SENTIMENT, "$0.01", "paid");
      const sr = sentimentData.result;
      if (sr) {
        const labelColor: ColorName = (sr.label ?? "").includes("bull") ? "green" : (sr.label ?? "").includes("bear") ? "red" : "white";
        console.log(`     ${dim("Mood:")} ${c(labelColor, sr.label ?? "")}  score: ${sr.score}  confidence: ${sr.confidence}`);
      }
    }
  } catch (err) {
    payRow("crypto-sentiment", PORT_SENTIMENT, "$0.01", "error");
    console.log(`     ${c("red", (err as Error).message)}`);
  }

  console.log();

  // ── Polymarket ──
  console.log(`  ${c("blue", "→")} Calling ${b("Prediction Markets")} — paying ${c("yellow", "$0.02")}`);
  let polyData: PolyResp | null = null;
  try {
    const r2 = await fetch(`http://localhost:${PORT_POLYMARKET}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 3 }),
    });
    if (r2.status === 402) {
      payRow("polymarket-alpha-scanner", PORT_POLYMARKET, "$0.02", "demo");
      console.log(`     ${dim("Would pay $0.02 USDC — got 402 (no agent wallet)")}`);
    } else {
      polyData = await r2.json() as PolyResp;
      payRow("polymarket-alpha-scanner", PORT_POLYMARKET, "$0.02", "paid");
      const top = polyData.result?.opportunities?.[0];
      if (top) {
        const signalColor: ColorName = top.alphaSignal === "HIGH" ? "green" : top.alphaSignal === "MEDIUM" ? "yellow" : "white";
        console.log(`     ${dim("Top market:")} ${c("white", (top.question ?? "").slice(0, 60))}...`);
        console.log(`     ${dim("Signal:")} ${c(signalColor, top.alphaSignal ?? "")}  yes:${top.yesPrice}  no:${top.noPrice}`);
      }
    }
  } catch (err) {
    payRow("polymarket-alpha-scanner", PORT_POLYMARKET, "$0.02", "error");
    console.log(`     ${c("red", (err as Error).message)}`);
  }

  console.log();

  // ── DeFi ──
  console.log(`  ${c("blue", "→")} Calling ${b("DeFi Trends")} — paying ${c("yellow", "$0.015")}`);
  let defiData: DefiResp | null = null;
  try {
    const r3 = await fetch(`http://localhost:${PORT_DEFI}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 3 }),
    });
    if (r3.status === 402) {
      payRow("defi-alpha-scanner", PORT_DEFI, "$0.015", "demo");
      console.log(`     ${dim("Would pay $0.015 USDC — got 402 (no agent wallet)")}`);
    } else {
      defiData = await r3.json() as DefiResp;
      payRow("defi-alpha-scanner", PORT_DEFI, "$0.015", "paid");
      const top = defiData.result?.topOpportunity;
      if (top) {
        const levelColor: ColorName = top.alphaLevel === "HOT" ? "red" : top.alphaLevel === "WARM" ? "yellow" : "white";
        const changeColor: ColorName = (top.change24h ?? 0) > 0 ? "green" : "red";
        console.log(`     ${dim("Top pick:")} ${c("cyan", top.symbol ?? "")}  ${c(levelColor, top.alphaLevel ?? "")}  24h: ${c(changeColor, (top.change24h ?? 0) + "%")}`);
        console.log(`     ${dim("Action:")} ${top.suggestedAction ?? ""}`);
      }
    }
  } catch (err) {
    payRow("defi-alpha-scanner", PORT_DEFI, "$0.015", "error");
    console.log(`     ${c("red", (err as Error).message)}`);
  }

  divider();
  console.log();

  // ── Synthesis ──
  step("🧠", "Synthesizing Alpha Signals");
  divider();

  let confidence = 0;
  const signals: string[] = [];

  const sr = sentimentData?.result;
  if (sr) {
    if (sr.label === "strongly_bullish") { confidence += 35; signals.push("Strongly bullish market mood"); }
    else if (sr.label === "bullish")     { confidence += 22; signals.push("Bullish market mood"); }
    else if (sr.label === "neutral")     { confidence += 10; }
  }

  const topPoly = polyData?.result?.opportunities?.[0];
  if (topPoly) {
    if (topPoly.alphaSignal === "HIGH")   { confidence += 35; signals.push(`Prediction market HIGH signal: ${(topPoly.question ?? "").slice(0, 40)}...`); }
    if (topPoly.alphaSignal === "MEDIUM") { confidence += 18; signals.push("Prediction market MEDIUM opportunity"); }
  }

  const topDefi = defiData?.result?.topOpportunity;
  if (topDefi) {
    if (topDefi.alphaLevel === "HOT")  { confidence += 30; signals.push(`DeFi HOT: ${topDefi.symbol ?? ""} ${topDefi.change24h ?? 0}%`); }
    if (topDefi.alphaLevel === "WARM") { confidence += 15; signals.push(`DeFi WARM: ${topDefi.symbol ?? ""}`); }
  }

  if (confidence === 0) {
    confidence = 62;
    signals.push("sample data — connect wallet for live alpha");
  }

  confidence = Math.min(confidence, 100);

  const rec =
    confidence >= 75 ? { text: "STRONG BUY SIGNAL",          color: "green"  as ColorName } :
    confidence >= 50 ? { text: "MODERATE OPPORTUNITY",        color: "yellow" as ColorName } :
    confidence >= 30 ? { text: "WATCH CLOSELY",               color: "blue"   as ColorName } :
                       { text: "WAIT — INSUFFICIENT SIGNAL",  color: "white"  as ColorName };

  console.log();
  console.log(`  ${b("Topic:")}       ${c("cyan", huntTopic)}`);
  console.log(`  ${b("Confidence:")}  ${c(rec.color, confidence + "%")}`);
  console.log(`  ${b("Signal:")}      ${c(rec.color, rec.text)}`);
  console.log();

  if (signals.length > 0) {
    console.log(`  ${b("Evidence:")}`);
    for (const s of signals) {
      console.log(`    ${c("green", "✓")} ${s}`);
    }
  }

  console.log();
  divider();
  console.log();

  step("💸", "Payment Ledger");
  console.log();
  console.log(`  ${dim("You paid:")}           ${c("yellow", "$0.05")} USDC → AlphaClaw Hunter`);
  console.log(`  ${dim("Hunter paid:")}        ${c("yellow", "$0.045")} USDC → 3 data services`);
  console.log(`  ${dim("Hunter margin:")}      ${c("green", "$0.005")} USDC per hunt`);
  console.log(`  ${dim("Receiver wallet:")}    ${c("cyan", config.walletAddress || "(not configured)")}`);
  console.log(`  ${dim("Network:")}            Base Sepolia (USDC)`);
  console.log();
  console.log(`  ${dim("To enable real payments, add to .env:")}`);
  console.log(`    ${c("cyan", "AGENT_PRIVATE_KEY=0x...")} (Base Sepolia wallet with USDC)`);
  console.log();
  divider("═");
  console.log(`\n  ${b(c("cyan", "AlphaClaw"))} — Autonomous alpha hunting, powered by x402 agent micropayments.\n`);
}

runDemo().catch((err: unknown) => {
  console.error(c("red", `\nFatal: ${(err as Error).message}\n`));
  process.exit(1);
});
