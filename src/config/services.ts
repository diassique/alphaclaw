import { config } from "./env.js";
import type { ServiceKey, DynamicPrice } from "../types/index.js";

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
  sentiment2: {
    key: "sentiment2",
    logName: "sentiment-v2",
    displayName: "crypto-sentiment-v2",
    port: config.ports.sentiment2,
    endpoint: "/analyze",
    method: "POST",
    price: "$0.001",
    description: "Conservative crypto sentiment analysis — competing agent with bearish bias",
    entryFile: "src/services/sentiment-v2/index.ts",
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

// Lazy import to avoid circular dependency (reputation imports types, services imports config)
let _getRepScore: ((key: ServiceKey) => number) | null = null;

export function setReputationProvider(fn: (key: ServiceKey) => number): void {
  _getRepScore = fn;
}

function parsePrice(p: string): number {
  return parseFloat(p.replace("$", ""));
}

export function getEffectivePrice(key: ServiceKey): DynamicPrice {
  const def = SERVICE_DEFS[key];
  const baseNum = def ? parsePrice(def.price) : 0;
  const rep = _getRepScore ? _getRepScore(key) : 0.5;
  const multiplier = parseFloat((0.5 + rep).toFixed(3));
  const effective = parseFloat((baseNum * multiplier).toFixed(4));
  return {
    service: key,
    basePrice: def?.price ?? "$0",
    effectivePrice: `$${effective}`,
    multiplier,
    reputation: parseFloat(rep.toFixed(3)),
  };
}

export function getAllDynamicPrices(): DynamicPrice[] {
  const keys: ServiceKey[] = ["sentiment", "sentiment2", "polymarket", "defi", "news", "whale"];
  return keys.map(getEffectivePrice);
}
