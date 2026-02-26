import { x402Fetch } from "./wallet.js";
import { serviceUrl, getEffectivePrice } from "../config/services.js";
import { getReputation } from "./reputation.js";
import { getOnlineExternalAgents } from "./registry.js";
import { createLogger } from "../lib/logger.js";
import { guardedCall } from "./circuit-breaker.js";
import type { ServiceResponse, SettledResult, CompetitionResult } from "../types/index.js";

const log = createLogger("coordinator");

const SUB_CALL_TIMEOUT = 15_000;

const SENTIMENT_URL   = serviceUrl("sentiment");
const SENTIMENT2_URL  = serviceUrl("sentiment2");
const POLYMARKET_URL  = serviceUrl("polymarket");
const DEFI_URL        = serviceUrl("defi");
const NEWS_URL        = serviceUrl("news");
const WHALE_URL       = serviceUrl("whale");

export async function callSentiment(text: string, signal?: AbortSignal): Promise<ServiceResponse> {
  return x402Fetch(`${SENTIMENT_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }, SUB_CALL_TIMEOUT, signal) as Promise<ServiceResponse>;
}

export async function callSentiment2(text: string, signal?: AbortSignal): Promise<ServiceResponse> {
  return x402Fetch(`${SENTIMENT2_URL}/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  }, SUB_CALL_TIMEOUT, signal) as Promise<ServiceResponse>;
}

export async function callPolymarket(filter: string | null, signal?: AbortSignal): Promise<ServiceResponse> {
  return x402Fetch(`${POLYMARKET_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filter, limit: 5 }),
  }, SUB_CALL_TIMEOUT, signal) as Promise<ServiceResponse>;
}

export async function callDefi(asset: string | null, signal?: AbortSignal): Promise<ServiceResponse> {
  return x402Fetch(`${DEFI_URL}/scan`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset, limit: 5 }),
  }, SUB_CALL_TIMEOUT, signal) as Promise<ServiceResponse>;
}

export async function callNews(topic: string, signal?: AbortSignal): Promise<ServiceResponse> {
  return x402Fetch(`${NEWS_URL}/news`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, limit: 5 }),
  }, SUB_CALL_TIMEOUT, signal) as Promise<ServiceResponse>;
}

export async function callWhale(address?: string, signal?: AbortSignal): Promise<ServiceResponse> {
  return x402Fetch(`${WHALE_URL}/whale`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address, limit: 10 }),
  }, SUB_CALL_TIMEOUT, signal) as Promise<ServiceResponse>;
}

export async function callExternalAgent(
  key: string,
  url: string,
  endpoint: string,
  topic: string,
  signal?: AbortSignal,
): Promise<ServiceResponse> {
  return x402Fetch(`${url}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic }),
  }, SUB_CALL_TIMEOUT, signal) as Promise<ServiceResponse>;
}

export async function callAllServices(topic: string, signal?: AbortSignal): Promise<SettledResult> {
  const warnings: string[] = [];

  const [newsR, sentimentR, sentiment2R, polymarketR, defiR, whaleR] = await Promise.allSettled([
    guardedCall("news", () => callNews(topic, signal)),
    guardedCall("sentiment", () => callSentiment(topic, signal)),
    guardedCall("sentiment2", () => callSentiment2(topic, signal)),
    guardedCall("polymarket", () => callPolymarket(topic, signal)),
    guardedCall("defi", () => callDefi(topic, signal)),
    guardedCall("whale", () => callWhale(undefined, signal)),
  ]);

  function unwrap(r: PromiseSettledResult<ServiceResponse | null>, name: string): ServiceResponse | null {
    if (r.status === "fulfilled") return r.value;
    const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
    const warning = reason.includes("abort") ? `${name}: timeout after ${SUB_CALL_TIMEOUT / 1000}s` : `${name}: ${reason}`;
    warnings.push(warning);
    log.warn("sub-service failed", { service: name, error: reason });
    return null;
  }

  const sent1 = unwrap(sentimentR, "sentiment");
  const sent2 = unwrap(sentiment2R, "sentiment2");

  // Competition: pick winner by reputation / effectivePrice ratio
  let competitionResult: CompetitionResult | undefined;
  let winnerSentiment = sent1;

  const rep1 = getReputation("sentiment").score;
  const rep2 = getReputation("sentiment2").score;
  const price1 = parseFloat(getEffectivePrice("sentiment").effectivePrice.replace("$", "")) || 0.001;
  const price2 = parseFloat(getEffectivePrice("sentiment2").effectivePrice.replace("$", "")) || 0.001;
  const ratio1 = rep1 / price1;
  const ratio2 = rep2 / price2;

  if (sent1 && sent2) {
    if (ratio2 > ratio1) {
      winnerSentiment = sent2;
      competitionResult = {
        winner: "sentiment2",
        loser: "sentiment",
        winnerRatio: parseFloat(ratio2.toFixed(1)),
        loserRatio: parseFloat(ratio1.toFixed(1)),
        reason: `sentiment-v2 (conservative) wins: ${ratio2.toFixed(1)} vs ${ratio1.toFixed(1)} rep/price ratio`,
      };
      log.info("competition", { winner: "sentiment2", ratio2: ratio2.toFixed(1), ratio1: ratio1.toFixed(1) });
    } else {
      competitionResult = {
        winner: "sentiment",
        loser: "sentiment2",
        winnerRatio: parseFloat(ratio1.toFixed(1)),
        loserRatio: parseFloat(ratio2.toFixed(1)),
        reason: `sentiment-v1 wins: ${ratio1.toFixed(1)} vs ${ratio2.toFixed(1)} rep/price ratio`,
      };
      log.info("competition", { winner: "sentiment", ratio1: ratio1.toFixed(1), ratio2: ratio2.toFixed(1) });
    }
  } else if (sent2 && !sent1) {
    winnerSentiment = sent2;
    competitionResult = {
      winner: "sentiment2", loser: "sentiment",
      winnerRatio: parseFloat(ratio2.toFixed(1)), loserRatio: 0,
      reason: "sentiment-v1 offline — sentiment-v2 wins by default",
    };
  }

  // ─── External agents ──────────────────────────────────────────────────────
  const externalAgents = getOnlineExternalAgents();
  const external: Record<string, ServiceResponse | null> = {};

  if (externalAgents.length > 0) {
    const extResults = await Promise.allSettled(
      externalAgents.map(a =>
        guardedCall(a.key, () => callExternalAgent(a.key, a.url, a.endpoint, topic, signal)),
      ),
    );

    for (let i = 0; i < externalAgents.length; i++) {
      const agent = externalAgents[i]!;
      external[agent.key] = unwrap(extResults[i]!, agent.key);
    }
  }

  return {
    news: unwrap(newsR, "news"),
    sentiment: winnerSentiment,
    polymarket: unwrap(polymarketR, "polymarket"),
    defi: unwrap(defiR, "defi"),
    whale: unwrap(whaleR, "whale"),
    external,
    warnings,
    competitionResult,
  };
}
