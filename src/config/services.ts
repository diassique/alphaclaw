import { config } from "./env.js";

export interface ServiceDef {
  key: string;
  logName: string;
  displayName: string;
  port: number;
  endpoint: string;
  method: "POST" | "GET";
  price: string;
  description: string;
  entryFile: string;
}

export const SERVICE_DEFS: Record<string, ServiceDef> = {
  sentiment: {
    key: "sentiment",
    logName: "sentiment",
    displayName: "crypto-sentiment",
    port: config.ports.sentiment,
    endpoint: "/analyze",
    method: "POST",
    price: "$0.001",
    description: "Crypto market sentiment analysis — bullish/bearish signals from text",
    entryFile: "src/services/sentiment/index.ts",
  },
  polymarket: {
    key: "polymarket",
    logName: "polymarket",
    displayName: "polymarket-alpha-scanner",
    port: config.ports.polymarket,
    endpoint: "/scan",
    method: "POST",
    price: "$0.02",
    description: "Scan Polymarket for mispriced prediction markets — alpha opportunities",
    entryFile: "src/services/polymarket/index.ts",
  },
  defi: {
    key: "defi",
    logName: "defi",
    displayName: "defi-alpha-scanner",
    port: config.ports.defi,
    endpoint: "/scan",
    method: "POST",
    price: "$0.015",
    description: "Scan DeFi markets for alpha — momentum, yield, and arbitrage signals",
    entryFile: "src/services/defi/index.ts",
  },
  news: {
    key: "news",
    logName: "news",
    displayName: "news-agent",
    port: config.ports.news,
    endpoint: "/news",
    method: "POST",
    price: "$0.001",
    description: "Fresh news articles for a prediction market topic",
    entryFile: "src/services/news/index.ts",
  },
  whale: {
    key: "whale",
    logName: "whale",
    displayName: "whale-agent",
    port: config.ports.whale,
    endpoint: "/whale",
    method: "POST",
    price: "$0.002",
    description: "Whale wallet movements — large on-chain flows on Base Sepolia",
    entryFile: "src/services/whale/index.ts",
  },
  hunter: {
    key: "hunter",
    logName: "coordinator",
    displayName: "alphaclaw-coordinator",
    port: config.ports.agent,
    endpoint: "/hunt",
    method: "POST",
    price: "$0.05",
    description: "AlphaClaw full alpha hunt — 5-source synthesis",
    entryFile: "src/agent/index.ts",
  },
};

export function serviceUrl(key: string): string {
  const def = SERVICE_DEFS[key];
  if (!def) throw new Error(`Unknown service: ${key}`);
  return `http://localhost:${def.port}`;
}
