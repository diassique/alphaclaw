import { randomUUID } from "crypto";
import type { Application } from "express";
import { createLogger } from "../../lib/logger.js";
import { config } from "../../config/env.js";
import { callNews, callSentiment, callSentiment2, callPolymarket, callDefi, callWhale } from "../orchestrator.js";
import { getReputation } from "../reputation.js";
import { synthesizeAlpha } from "../synthesis.js";
import { generateReportId, cacheReport } from "../report-cache.js";
import { getEffectivePrice } from "../../config/services.js";
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
      send("start", { topic, huntId, timestamp: new Date().toISOString(), services: 5 });

      const signal = streamAbort.signal;

      const dp = (k: ServiceKey) => getEffectivePrice(k);

      const newsP = dp("news");
      send("paying", { service: "news-agent", amount: newsP.effectivePrice, baseAmount: newsP.basePrice, multiplier: newsP.multiplier, port: 4004 });
      let newsRes: ServiceResponse | null = null;
      try { newsRes = await callNews(topic, signal); } catch (err) { if (!closed) log.warn("stream: news failed", { error: (err as Error).message }); }
      send("result", { service: "news-agent", data: newsRes?.data ?? null, txHash: newsRes?.txHash, paid: newsRes?.paid ?? false });

      // Sentiment competition: call both in parallel
      const sentP = dp("sentiment");
      const sent2P = dp("sentiment2");
      send("paying", { service: "crypto-sentiment", amount: sentP.effectivePrice, baseAmount: sentP.basePrice, multiplier: sentP.multiplier, port: 4001 });
      send("paying", { service: "crypto-sentiment-v2", amount: sent2P.effectivePrice, baseAmount: sent2P.basePrice, multiplier: sent2P.multiplier, port: 4006 });

      let sent1Res: ServiceResponse | null = null;
      let sent2Res: ServiceResponse | null = null;
      const [s1, s2] = await Promise.allSettled([callSentiment(topic, signal), callSentiment2(topic, signal)]);
      if (s1.status === "fulfilled") sent1Res = s1.value; else if (!closed) log.warn("stream: sentiment failed", { error: (s1 as PromiseRejectedResult).reason });
      if (s2.status === "fulfilled") sent2Res = s2.value; else if (!closed) log.warn("stream: sentiment2 failed", { error: (s2 as PromiseRejectedResult).reason });

      send("result", { service: "crypto-sentiment", data: sent1Res?.data ?? null, txHash: sent1Res?.txHash, paid: sent1Res?.paid ?? false });
      send("result", { service: "crypto-sentiment-v2", data: sent2Res?.data ?? null, txHash: sent2Res?.txHash, paid: sent2Res?.paid ?? false });

      // Pick winner
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

      const polyP = dp("polymarket");
      send("paying", { service: "polymarket-alpha-scanner", amount: polyP.effectivePrice, baseAmount: polyP.basePrice, multiplier: polyP.multiplier, port: 4002 });
      let polymarketRes: ServiceResponse | null = null;
      try { polymarketRes = await callPolymarket(null, signal); } catch (err) { if (!closed) log.warn("stream: polymarket failed", { error: (err as Error).message }); }
      send("result", { service: "polymarket-alpha-scanner", data: polymarketRes?.data ?? null, txHash: polymarketRes?.txHash, paid: polymarketRes?.paid ?? false });

      const defiP = dp("defi");
      send("paying", { service: "defi-alpha-scanner", amount: defiP.effectivePrice, baseAmount: defiP.basePrice, multiplier: defiP.multiplier, port: 4003 });
      let defiRes: ServiceResponse | null = null;
      try { defiRes = await callDefi(null, signal); } catch (err) { if (!closed) log.warn("stream: defi failed", { error: (err as Error).message }); }
      send("result", { service: "defi-alpha-scanner", data: defiRes?.data ?? null, txHash: defiRes?.txHash, paid: defiRes?.paid ?? false });

      const whaleP = dp("whale");
      send("paying", { service: "whale-agent", amount: whaleP.effectivePrice, baseAmount: whaleP.basePrice, multiplier: whaleP.multiplier, port: 4005 });
      let whaleRes: ServiceResponse | null = null;
      try { whaleRes = await callWhale(undefined, signal); } catch (err) { if (!closed) log.warn("stream: whale failed", { error: (err as Error).message }); }
      send("result", { service: "whale-agent", data: whaleRes?.data ?? null, txHash: whaleRes?.txHash, paid: whaleRes?.paid ?? false });

      const alpha = synthesizeAlpha({
        huntId,
        sentimentResult:  sentimentRes?.data as { result?: SentimentResult } | null,
        polymarketResult: polymarketRes?.data as { result?: PolymarketResult } | null,
        defiResult:       defiRes?.data as { result?: DefiResult } | null,
        newsResult:       newsRes?.data as { result?: NewsResult } | null,
        whaleResult:      whaleRes?.data as { result?: WhaleResult } | null,
        competitionResult,
      });

      send("alpha", alpha);
      send("staking", alpha.stakingSummary);
      send("reputation", alpha.reputationSnapshot);

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

    } catch (err) {
      send("error", { message: (err as Error).message });
    } finally {
      cleanup();
      send("done", {});
      if (!res.writableEnded) res.end();
    }
  });
}
