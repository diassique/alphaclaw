import type { Application } from "express";
import { createLogger } from "../../lib/logger.js";
import { config } from "../../config/env.js";
import { callNews, callSentiment, callPolymarket, callDefi, callWhale } from "../orchestrator.js";
import { synthesizeAlpha } from "../synthesis.js";
import { generateReportId, cacheReport } from "../report-cache.js";
import type { ServiceResponse, SentimentResult, PolymarketResult, DefiResult, NewsResult, WhaleResult, CachedReport } from "../../types/index.js";

const log = createLogger("coordinator");

export function registerStreamRoutes(app: Application): void {
  app.get("/stream", async (req, res) => {
    const topic = String(req.query["topic"] ?? "ethereum DeFi bullish").slice(0, 200) || "crypto market";

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
      send("start", { topic, timestamp: new Date().toISOString(), services: 5 });

      const signal = streamAbort.signal;

      send("paying", { service: "news-agent", amount: "$0.001", port: 4004 });
      let newsRes: ServiceResponse | null = null;
      try { newsRes = await callNews(topic, signal); } catch (err) { if (!closed) log.warn("stream: news failed", { error: (err as Error).message }); }
      send("result", { service: "news-agent", data: newsRes?.data ?? null, txHash: newsRes?.txHash, paid: newsRes?.paid ?? false });

      send("paying", { service: "crypto-sentiment", amount: "$0.001", port: 4001 });
      let sentimentRes: ServiceResponse | null = null;
      try { sentimentRes = await callSentiment(topic, signal); } catch (err) { if (!closed) log.warn("stream: sentiment failed", { error: (err as Error).message }); }
      send("result", { service: "crypto-sentiment", data: sentimentRes?.data ?? null, txHash: sentimentRes?.txHash, paid: sentimentRes?.paid ?? false });

      send("paying", { service: "polymarket-alpha-scanner", amount: "$0.020", port: 4002 });
      let polymarketRes: ServiceResponse | null = null;
      try { polymarketRes = await callPolymarket(null, signal); } catch (err) { if (!closed) log.warn("stream: polymarket failed", { error: (err as Error).message }); }
      send("result", { service: "polymarket-alpha-scanner", data: polymarketRes?.data ?? null, txHash: polymarketRes?.txHash, paid: polymarketRes?.paid ?? false });

      send("paying", { service: "defi-alpha-scanner", amount: "$0.015", port: 4003 });
      let defiRes: ServiceResponse | null = null;
      try { defiRes = await callDefi(null, signal); } catch (err) { if (!closed) log.warn("stream: defi failed", { error: (err as Error).message }); }
      send("result", { service: "defi-alpha-scanner", data: defiRes?.data ?? null, txHash: defiRes?.txHash, paid: defiRes?.paid ?? false });

      send("paying", { service: "whale-agent", amount: "$0.002", port: 4005 });
      let whaleRes: ServiceResponse | null = null;
      try { whaleRes = await callWhale(undefined, signal); } catch (err) { if (!closed) log.warn("stream: whale failed", { error: (err as Error).message }); }
      send("result", { service: "whale-agent", data: whaleRes?.data ?? null, txHash: whaleRes?.txHash, paid: whaleRes?.paid ?? false });

      const alpha = synthesizeAlpha({
        sentimentResult:  sentimentRes?.data as { result?: SentimentResult } | null,
        polymarketResult: polymarketRes?.data as { result?: PolymarketResult } | null,
        defiResult:       defiRes?.data as { result?: DefiResult } | null,
        newsResult:       newsRes?.data as { result?: NewsResult } | null,
        whaleResult:      whaleRes?.data as { result?: WhaleResult } | null,
      });

      send("alpha", alpha);

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
