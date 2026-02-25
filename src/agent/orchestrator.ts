import { x402Fetch } from "./wallet.js";
import { serviceUrl } from "../config/services.js";
import { createLogger } from "../lib/logger.js";
import type { ServiceResponse, SettledResult } from "../types/index.js";

const log = createLogger("coordinator");

const SUB_CALL_TIMEOUT = 15_000;

const SENTIMENT_URL  = serviceUrl("sentiment");
const POLYMARKET_URL = serviceUrl("polymarket");
const DEFI_URL       = serviceUrl("defi");
const NEWS_URL       = serviceUrl("news");
const WHALE_URL      = serviceUrl("whale");

export async function callSentiment(text: string): Promise<ServiceResponse> {
  return x402Fetch(`${SENTIMENT_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }) as Promise<ServiceResponse>;
}

export async function callPolymarket(filter: string | null): Promise<ServiceResponse> {
  return x402Fetch(`${POLYMARKET_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter, limit: 5 }),
  }) as Promise<ServiceResponse>;
}

export async function callDefi(asset: string | null): Promise<ServiceResponse> {
  return x402Fetch(`${DEFI_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset, limit: 5 }),
  }) as Promise<ServiceResponse>;
}

export async function callNews(topic: string): Promise<ServiceResponse> {
  return x402Fetch(`${NEWS_URL}/news`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, limit: 5 }),
  }) as Promise<ServiceResponse>;
}

export async function callWhale(address?: string): Promise<ServiceResponse> {
  return x402Fetch(`${WHALE_URL}/whale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, limit: 10 }),
  }) as Promise<ServiceResponse>;
}

export async function callAllServices(topic: string): Promise<SettledResult> {
  const warnings: string[] = [];

  const [newsR, sentimentR, polymarketR, defiR, whaleR] = await Promise.allSettled([
    callNews(topic),
    callSentiment(topic),
    callPolymarket(topic),
    callDefi(topic),
    callWhale(),
  ]);

  function unwrap(r: PromiseSettledResult<ServiceResponse>, name: string): ServiceResponse | null {
    if (r.status === "fulfilled") return r.value;
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    const warning = reason.includes("abort") ? `${name}: timeout after ${SUB_CALL_TIMEOUT / 1000}s` : `${name}: ${reason}`;
    warnings.push(warning);
    log.warn("sub-service failed", { service: name, error: reason });
    return null;
  }

  return {
    news: unwrap(newsR, "news"),
    sentiment: unwrap(sentimentR, "sentiment"),
    polymarket: unwrap(polymarketR, "polymarket"),
    defi: unwrap(defiR, "defi"),
    whale: unwrap(whaleR, "whale"),
    warnings,
  };
}
