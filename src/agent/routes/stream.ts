import { randomUUID } from "crypto";
import type { Application } from "express";
import { createLogger } from "../../lib/logger.js";
import { config } from "../../config/env.js";
import { callNews, callSentiment, callSentiment2, callPolymarket, callDefi, callWhale, callExternalAgent } from "../orchestrator.js";
import { getOnlineExternalAgents } from "../registry.js";
import { getReputation } from "../reputation.js";
import { synthesizeAlpha } from "../synthesis.js";
import { generateReportId, cacheReport } from "../report-cache.js";
import { recordHunt } from "../memory.js";
import { scheduleSettlement } from "../settlement.js";
import { extractDirection } from "../reputation.js";
import { getEffectivePrice } from "../../config/services.js";
import { executeACPRound } from "../acp.js";
import { generateAlphaNarrative, isClaudeEnabled } from "../claude.js";
import { walletClient } from "../wallet.js";
import { recordTx } from "../tx-log.js";
import type { ServiceResponse, SentimentResult, PolymarketResult, DefiResult, NewsResult, WhaleResult, CachedReport, ServiceKey } from "../../types/index.js";

const log = createLogger("coordinator");

export function registerStreamRoutes(app: Application): void {
  app.get("/stream", async (req, res) => {
    const topic = String(req.query["topic"] ?? "ethereum DeFi bullish").slice(0, 200) || "crypto market";
    const huntId = randomUUID().slice(0, 12);

    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigins);
    res.status(200);
    res.flushHeaders();

    // Abort controller: cancels in-flight sub-service calls on timeout or client disconnect
    const streamAbort = new AbortController();
    let closed = false;

    const send = (event: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res as any).flush?.();
    };

    const cleanup = () => {
      if (closed) return;
      closed = true;
      streamAbort.abort();
      clearTimeout(timeoutTimer);
    };

    const TIMEOUT_MS = 30_000;
    const timeoutTimer = setTimeout(() => {
      send("error", { message: "Stream timed out" });
      send("done", {});
      cleanup();
      res.end();
    }, TIMEOUT_MS);

    req.on("close", () => {
      log.info("stream: client disconnected");
      cleanup();
    });

    try {
      const fromAddr = walletClient?.account?.address ?? null;
      const toAddr = config.walletAddress || null;

      send("start", { topic, huntId, timestamp: new Date().toISOString(), services: 5, fromAddr, toAddr });

      const signal = streamAbort.signal;

      const dp = (k: ServiceKey) => getEffectivePrice(k);

      // Emit all paying events upfront
      const newsP = dp("news");
      const sentP = dp("sentiment");
      const sent2P = dp("sentiment2");
      const polyP = dp("polymarket");
      const defiP = dp("defi");
      const whaleP = dp("whale");

      send("paying", { service: "news-agent", amount: newsP.effectivePrice, baseAmount: newsP.basePrice, multiplier: newsP.multiplier, port: 4004, fromAddr, toAddr });
      send("paying", { service: "crypto-sentiment", amount: sentP.effectivePrice, baseAmount: sentP.basePrice, multiplier: sentP.multiplier, port: 4001, fromAddr, toAddr });
      send("paying", { service: "crypto-sentiment-v2", amount: sent2P.effectivePrice, baseAmount: sent2P.basePrice, multiplier: sent2P.multiplier, port: 4006, fromAddr, toAddr });
      send("paying", { service: "polymarket-alpha-scanner", amount: polyP.effectivePrice, baseAmount: polyP.basePrice, multiplier: polyP.multiplier, port: 4002, fromAddr, toAddr });
      send("paying", { service: "defi-alpha-scanner", amount: defiP.effectivePrice, baseAmount: defiP.basePrice, multiplier: defiP.multiplier, port: 4003, fromAddr, toAddr });
      send("paying", { service: "whale-agent", amount: whaleP.effectivePrice, baseAmount: whaleP.basePrice, multiplier: whaleP.multiplier, port: 4005, fromAddr, toAddr });

      // Emit paying events for external agents
      const extAgents = getOnlineExternalAgents();
      for (const ext of extAgents) {
        const extDp = dp(ext.key);
        send("paying", { service: ext.displayName, amount: extDp.effectivePrice, baseAmount: extDp.basePrice, multiplier: extDp.multiplier, port: null, url: ext.url, fromAddr, toAddr, external: true });
      }

      // Fire ALL service calls in parallel (built-in + external)
      // Fire built-in and external in parallel
      const builtinSettled = Promise.allSettled([
        callNews(topic, signal),
        callSentiment(topic, signal),
        callSentiment2(topic, signal),
        callPolymarket(null, signal),
        callDefi(null, signal),
        callWhale(undefined, signal),
      ]);
      const extSettledP = Promise.allSettled(
        extAgents.map(a => callExternalAgent(a.key, a.url, a.endpoint, topic, signal)),
      );

      const [builtinResults, extSettled] = await Promise.all([builtinSettled, extSettledP]);
      const [newsS, s1, s2, polyS, defiS, whaleS] = builtinResults;

      function unwrap(r: PromiseSettledResult<ServiceResponse>, name: string): ServiceResponse | null {
        if (r.status === "fulfilled") return r.value;
        if (!closed) log.warn(`stream: ${name} failed`, { error: (r as PromiseRejectedResult).reason?.message ?? r.reason });
        return null;
      }

      const newsRes = unwrap(newsS, "news");
      const sent1Res = unwrap(s1, "sentiment");
      const sent2Res = unwrap(s2, "sentiment2");
      let polymarketRes = unwrap(polyS, "polymarket");
      let defiRes = unwrap(defiS, "defi");
      let whaleRes = unwrap(whaleS, "whale");

      // Stream results as they arrive (already resolved)
      const resultEntries: { service: string; res: ServiceResponse | null; amount: string; port: number }[] = [
        { service: "news-agent", res: newsRes, amount: newsP.effectivePrice, port: 4004 },
        { service: "crypto-sentiment", res: sent1Res, amount: sentP.effectivePrice, port: 4001 },
        { service: "crypto-sentiment-v2", res: sent2Res, amount: sent2P.effectivePrice, port: 4006 },
        { service: "polymarket-alpha-scanner", res: polymarketRes, amount: polyP.effectivePrice, port: 4002 },
        { service: "defi-alpha-scanner", res: defiRes, amount: defiP.effectivePrice, port: 4003 },
        { service: "whale-agent", res: whaleRes, amount: whaleP.effectivePrice, port: 4005 },
      ];

      for (const entry of resultEntries) {
        send("result", { service: entry.service, data: entry.res?.data ?? null, txHash: entry.res?.txHash, paid: entry.res?.paid ?? false, fromAddr, toAddr });
        if (fromAddr && toAddr) {
          recordTx({
            timestamp: new Date().toISOString(),
            service: entry.service,
            fromAddr,
            toAddr,
            amount: entry.amount,
            txHash: entry.res?.txHash,
            network: "base-sepolia",
            status: entry.res?.paid ? "paid" : entry.res?.demoMode ? "demo" : "failed",
          });
        }
      }

      // External agent results
      const externalResults: Record<string, ServiceResponse | null> = {};
      for (let i = 0; i < extAgents.length; i++) {
        const agent = extAgents[i]!;
        const extRes = unwrap(extSettled[i]!, agent.key);
        externalResults[agent.key] = extRes;
        const extDp = dp(agent.key);
        send("result", { service: agent.displayName, data: extRes?.data ?? null, txHash: extRes?.txHash, paid: extRes?.paid ?? false, fromAddr, toAddr, external: true });
        if (fromAddr && toAddr) {
          recordTx({
            timestamp: new Date().toISOString(),
            service: agent.displayName,
            fromAddr,
            toAddr,
            amount: extDp.effectivePrice,
            txHash: extRes?.txHash,
            network: "base-sepolia",
            status: extRes?.paid ? "paid" : extRes?.demoMode ? "demo" : "failed",
          });
        }
      }

      // Pick sentiment winner
      const rep1 = getReputation("sentiment").score;
      const rep2 = getReputation("sentiment2").score;
      const price1 = parseFloat(sentP.effectivePrice.replace("$", "")) || 0.001;
      const price2 = parseFloat(sent2P.effectivePrice.replace("$", "")) || 0.001;
      const ratio1 = rep1 / price1;
      const ratio2 = rep2 / price2;

      let sentimentRes: ServiceResponse | null = sent1Res;
      let competitionResult: import("../../types/index.js").CompetitionResult | undefined;

      if (sent1Res && sent2Res) {
        if (ratio2 > ratio1) {
          sentimentRes = sent2Res;
          competitionResult = { winner: "sentiment2", loser: "sentiment", winnerRatio: parseFloat(ratio2.toFixed(1)), loserRatio: parseFloat(ratio1.toFixed(1)), reason: `v2 wins: ${ratio2.toFixed(1)} vs ${ratio1.toFixed(1)}` };
        } else {
          competitionResult = { winner: "sentiment", loser: "sentiment2", winnerRatio: parseFloat(ratio1.toFixed(1)), loserRatio: parseFloat(ratio2.toFixed(1)), reason: `v1 wins: ${ratio1.toFixed(1)} vs ${ratio2.toFixed(1)}` };
        }
        send("competition", competitionResult);
      } else if (sent2Res && !sent1Res) {
        sentimentRes = sent2Res;
        competitionResult = { winner: "sentiment2", loser: "sentiment", winnerRatio: parseFloat(ratio2.toFixed(1)), loserRatio: 0, reason: "v1 offline" };
        send("competition", competitionResult);
      }

      const alpha = await synthesizeAlpha({
        huntId,
        sentimentResult:  sentimentRes?.data as { result?: SentimentResult } | null,
        polymarketResult: polymarketRes?.data as { result?: PolymarketResult } | null,
        defiResult:       defiRes?.data as { result?: DefiResult } | null,
        newsResult:       newsRes?.data as { result?: NewsResult } | null,
        whaleResult:      whaleRes?.data as { result?: WhaleResult } | null,
        competitionResult,
        externalResults,
      });

      // Generate Claude narrative if enabled
      if (isClaudeEnabled()) {
        try {
          const narrative = await generateAlphaNarrative({
            topic,
            sentiment: alpha.breakdown.sentiment,
            polymarket: alpha.breakdown.polymarket
              ? { ...alpha.breakdown.polymarket, yesPrice: String(alpha.breakdown.polymarket.yesPrice) }
              : null,
            defi: alpha.breakdown.defi,
            news: alpha.breakdown.news,
            whale: alpha.breakdown.whale,
            confidence: alpha.confidence,
            recommendation: alpha.recommendation,
            consensusStrength: alpha.consensusStrength,
          });
          if (narrative) alpha.narrative = narrative;
        } catch { /* skip narrative on error */ }
      }

      send("alpha", alpha);
      send("staking", alpha.stakingSummary);
      send("reputation", alpha.reputationSnapshot);

      // ACP round
      const acpRound = executeACPRound({
        roundId: huntId,
        topic,
        responses: [
          { key: "news", response: newsRes },
          { key: "sentiment", response: sentimentRes },
          { key: "polymarket", response: polymarketRes },
          { key: "defi", response: defiRes },
          { key: "whale", response: whaleRes },
          ...Object.entries(externalResults).map(([key, resp]) => ({ key, response: resp })),
        ],
      });
      send("acp:consensus", acpRound.consensus);
      send("acp:settle", acpRound.settlement);
      send("acp:votes", acpRound.agents);

      const ts = new Date().toISOString();
      const reportId = generateReportId(topic, ts);
      const report: CachedReport = {
        id: reportId,
        topic,
        timestamp: ts,
        createdAt: Date.now(),
        alpha,
        agentPayments: {
          totalPaid: "$0.039",
          breakdown: [
            { service: "news-agent",                price: "$0.001", paid: newsRes?.paid ?? false,      txHash: newsRes?.txHash },
            { service: "crypto-sentiment",          price: "$0.001", paid: sentimentRes?.paid ?? false, txHash: sentimentRes?.txHash },
            { service: "polymarket-alpha-scanner",  price: "$0.020", paid: polymarketRes?.paid ?? false, txHash: polymarketRes?.txHash },
            { service: "defi-alpha-scanner",        price: "$0.015", paid: defiRes?.paid ?? false,       txHash: defiRes?.txHash },
            { service: "whale-agent",               price: "$0.002", paid: whaleRes?.paid ?? false,      txHash: whaleRes?.txHash },
          ],
        },
        stakingSummary: alpha.stakingSummary,
        preview: `${alpha.recommendation} | Confidence: ${alpha.confidence} | Signals: ${alpha.signals.slice(0, 2).join(", ")}`,
      };
      cacheReport(report);
      send("cached", { reportId, sellPrice: "$0.01", url: `/report/${reportId}` });

      // Record in memory + schedule settlement against real price oracle
      const memEntry = recordHunt({
        topic,
        timestamp: ts,
        signals: alpha.signals,
        confidence: alpha.weightedConfidence,
        recommendation: alpha.recommendation,
      });

      const serviceData: { key: ServiceKey; data: unknown }[] = [
        { key: "sentiment", data: sentimentRes?.data },
        { key: "polymarket", data: polymarketRes?.data },
        { key: "defi", data: defiRes?.data },
        { key: "news", data: newsRes?.data },
        { key: "whale", data: whaleRes?.data },
      ];
      for (const [key, resp] of Object.entries(externalResults)) {
        if (resp) serviceData.push({ key, data: resp.data });
      }

      scheduleSettlement({
        huntId,
        topic,
        consensus: alpha.stakingSummary.consensus,
        serviceDirections: serviceData.map(({ key, data }) => ({
          key,
          direction: extractDirection(key, data),
        })),
        memoryEntryId: memEntry.id,
      }).catch(err => log.warn("settlement schedule failed", { error: (err as Error).message }));

      send("settlement", { scheduled: true, settleIn: "10min", memoryEntryId: memEntry.id });

    } catch (err) {
      send("error", { message: (err as Error).message });
    } finally {
      cleanup();
      send("done", {});
      if (!res.writableEnded) res.end();
    }
  });
}
