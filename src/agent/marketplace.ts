/**
 * Marketplace Simulator — 3 mock external agents as in-process HTTP servers.
 *
 * Each mock agent runs on a dynamic port (0 = OS-assigned), registers itself
 * in the agent registry, responds to hunt calls with plausible alpha data,
 * and participates in ACP rounds with X-ACP-* response headers.
 */

import express from "express";
import type { Server } from "http";
import { createLogger } from "../lib/logger.js";
import { registerAgent, unregisterAgent } from "./registry.js";
import { ACP_HEADERS, ACP_VERSION } from "../types/index.js";
import type { AgentCategory, Direction, ExternalAgentResponse } from "../types/index.js";

const log = createLogger("marketplace");

// ─── Deterministic hash for stable mock data ────────────────────────────────

function hashTopic(topic: string): number {
  let h = 0;
  for (let i = 0; i < topic.length; i++) {
    h = ((h << 5) - h + topic.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

// ─── Mock agent definitions ─────────────────────────────────────────────────

interface MockAgentDef {
  key: string;
  displayName: string;
  endpoint: string;
  category: AgentCategory;
  description: string;
  price: string;
  handler: (topic: string) => ExternalAgentResponse;
}

const MOCK_AGENTS: MockAgentDef[] = [
  {
    key: "technical-analysis",
    displayName: "Technical Analysis",
    endpoint: "/analyze",
    category: "prediction",
    description: "RSI/MACD technical indicators — bullish/bearish signals based on momentum analysis",
    price: "$0.003",
    handler(topic: string): ExternalAgentResponse {
      const h = hashTopic(topic);
      const rsi = 20 + seededRandom(h) * 60;           // 20–80
      const macd = seededRandom(h + 1) * 2 - 1;        // -1 to 1
      const ema = seededRandom(h + 2) > 0.5;

      const direction: Direction = rsi > 60 ? "bullish" : rsi < 35 ? "bearish" : "neutral";
      const confidence = 0.4 + seededRandom(h + 3) * 0.5;  // 0.4–0.9

      const signals: string[] = [
        `RSI: ${rsi.toFixed(1)} (${rsi > 60 ? "overbought zone" : rsi < 35 ? "oversold zone" : "neutral"})`,
        `MACD: ${macd > 0 ? "bullish crossover" : "bearish divergence"} (${macd.toFixed(3)})`,
        ema ? "price above 200 EMA" : "price below 200 EMA",
      ];

      return {
        service: "Technical Analysis",
        timestamp: new Date().toISOString(),
        result: { direction, confidenceScore: parseFloat(confidence.toFixed(3)), confidenceBasis: "RSI + MACD + EMA indicators", signals },
      };
    },
  },
  {
    key: "social-buzz",
    displayName: "Social Buzz Tracker",
    endpoint: "/scan",
    category: "sentiment",
    description: "Social media volume and trending analysis for crypto sentiment detection",
    price: "$0.002",
    handler(topic: string): ExternalAgentResponse {
      const h = hashTopic(topic);
      const volume = Math.floor(1000 + seededRandom(h + 10) * 50000);
      const sentiment = seededRandom(h + 11) * 2 - 1;   // -1 to 1
      const trending = seededRandom(h + 12) > 0.4;

      const direction: Direction = sentiment > 0.3 ? "bullish" : sentiment < -0.3 ? "bearish" : "neutral";
      const confidence = 0.3 + seededRandom(h + 13) * 0.5;  // 0.3–0.8

      const signals: string[] = [
        `social volume: ${volume.toLocaleString()} mentions/24h`,
        `sentiment ratio: ${(sentiment > 0 ? "+" : "")}${(sentiment * 100).toFixed(1)}%`,
        trending ? "trending on crypto Twitter" : "not trending",
        seededRandom(h + 14) > 0.6 ? "whale accounts active" : "retail-dominated discussion",
      ];

      return {
        service: "Social Buzz Tracker",
        timestamp: new Date().toISOString(),
        result: { direction, confidenceScore: parseFloat(confidence.toFixed(3)), confidenceBasis: "social volume + sentiment ratio + trending status", signals },
      };
    },
  },
  {
    key: "fear-greed",
    displayName: "Fear & Greed Index",
    endpoint: "/index",
    category: "other",
    description: "Composite fear/greed index combining volatility, momentum, and social signals",
    price: "$0.001",
    handler(topic: string): ExternalAgentResponse {
      const h = hashTopic(topic);
      const index = Math.floor(seededRandom(h + 20) * 100);  // 0–100
      const volatility = seededRandom(h + 21) * 50;          // 0–50%

      const label = index > 75 ? "Extreme Greed" : index > 55 ? "Greed" : index > 45 ? "Neutral" : index > 25 ? "Fear" : "Extreme Fear";
      const direction: Direction = index > 60 ? "bullish" : index < 40 ? "bearish" : "neutral";
      const confidence = 0.35 + seededRandom(h + 22) * 0.45; // 0.35–0.8

      const signals: string[] = [
        `fear & greed index: ${index}/100 (${label})`,
        `market volatility: ${volatility.toFixed(1)}%`,
        index > 75 ? "caution: extreme greed often precedes corrections" : index < 25 ? "opportunity: extreme fear often precedes recoveries" : "market sentiment balanced",
        seededRandom(h + 23) > 0.5 ? "BTC dominance rising" : "altcoin season indicator active",
      ];

      return {
        service: "Fear & Greed Index",
        timestamp: new Date().toISOString(),
        result: { direction, confidenceScore: parseFloat(confidence.toFixed(3)), confidenceBasis: "composite fear/greed index + volatility + market dominance", signals },
      };
    },
  },
];

// ─── State ──────────────────────────────────────────────────────────────────

interface RunningAgent {
  key: string;
  displayName: string;
  port: number;
  url: string;
  server: Server;
}

let running: RunningAgent[] = [];

export interface MarketplaceAgent {
  key: string;
  displayName: string;
  port: number;
  url: string;
}

export interface MarketplaceStatus {
  running: boolean;
  agents: MarketplaceAgent[];
}

// ─── Start / Stop ───────────────────────────────────────────────────────────

export async function startMarketplace(): Promise<MarketplaceStatus> {
  if (running.length > 0) {
    return getMarketplaceStatus();
  }

  const started: RunningAgent[] = [];

  for (const def of MOCK_AGENTS) {
    const app = express();
    app.use(express.json());

    // Health endpoint
    app.get("/health", (_req, res) => {
      res.json({ service: def.displayName, status: "ok", timestamp: new Date().toISOString() });
    });

    // Main endpoint
    app.post(def.endpoint, (req, res) => {
      const topic = (req.body as { topic?: string })?.topic ?? "bitcoin";
      const result = def.handler(topic);

      // Set ACP protocol headers
      res.set(ACP_HEADERS.version, String(ACP_VERSION));
      res.set(ACP_HEADERS.direction, result.result.direction);
      res.set(ACP_HEADERS.confidence, String(result.result.confidenceScore));
      res.set(ACP_HEADERS.stake, String(Math.round(result.result.confidenceScore * 100)));

      res.json(result);
    });

    // Listen on dynamic port
    const server = await new Promise<Server>((resolve, reject) => {
      const srv = app.listen(0, "127.0.0.1", () => resolve(srv));
      srv.on("error", reject);
    });

    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const url = `http://127.0.0.1:${port}`;

    started.push({ key: def.key, displayName: def.displayName, port, url, server });

    // Register in the agent registry
    registerAgent({
      key: def.key,
      displayName: def.displayName,
      url,
      endpoint: def.endpoint,
      price: def.price,
      description: def.description,
      category: def.category,
    });

    log.info("mock agent started", { key: def.key, port, url });
  }

  running = started;
  log.info("marketplace started", { agents: started.length });
  return getMarketplaceStatus();
}

export async function stopMarketplace(): Promise<void> {
  for (const agent of running) {
    // Unregister from registry
    try {
      unregisterAgent(agent.key);
    } catch {
      // may already be removed
    }

    // Close HTTP server
    await new Promise<void>((resolve) => {
      agent.server.close(() => resolve());
    });

    log.info("mock agent stopped", { key: agent.key, port: agent.port });
  }

  running = [];
  log.info("marketplace stopped");
}

export function getMarketplaceStatus(): MarketplaceStatus {
  return {
    running: running.length > 0,
    agents: running.map(a => ({
      key: a.key,
      displayName: a.displayName,
      port: a.port,
      url: a.url,
    })),
  };
}
