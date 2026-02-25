import type { Application } from "express";
import { validateString } from "../../lib/validate.js";
import { createLogger } from "../../lib/logger.js";
import { walletClient } from "../wallet.js";
import { callAllServices } from "../orchestrator.js";
import { synthesizeAlpha } from "../synthesis.js";
import { generateReportId, cacheReport } from "../report-cache.js";
import type { SentimentResult, PolymarketResult, DefiResult, NewsResult, WhaleResult, PaymentLog, CachedReport } from "../../types/index.js";

const log = createLogger("coordinator");

export function registerHuntRoutes(app: Application): void {
  app.post("/hunt", async (req, res) => {
    const topic = validateString(req, res, "topic", { maxLen: 200, defaultVal: "crypto market" });
    if (topic === null) return;

    const ts = new Date().toISOString();
    const { news, sentiment, polymarket, defi, whale, warnings } = await callAllServices(topic);

    log.info("hunt", { topic, warnings: warnings.length > 0 ? warnings : undefined });

    const alpha = synthesizeAlpha({
      sentimentResult:  sentiment?.data as { result?: SentimentResult } | null,
      polymarketResult: polymarket?.data as { result?: PolymarketResult } | null,
      defiResult:       defi?.data as { result?: DefiResult } | null,
      newsResult:       news?.data as { result?: NewsResult } | null,
      whaleResult:      whale?.data as { result?: WhaleResult } | null,
      warnings,
    });

    const paymentLog: PaymentLog = {
      totalPaid: walletClient ? "$0.039 USDC to 5 sub-agents" : "demo mode — no wallet",
      breakdown: [
        { service: "news-agent",                price: "$0.001", paid: news?.paid ?? false,       txHash: news?.txHash },
        { service: "crypto-sentiment",          price: "$0.001", paid: sentiment?.paid ?? false,  txHash: sentiment?.txHash },
        { service: "polymarket-alpha-scanner",  price: "$0.020", paid: polymarket?.paid ?? false, txHash: polymarket?.txHash },
        { service: "defi-alpha-scanner",        price: "$0.015", paid: defi?.paid ?? false,       txHash: defi?.txHash },
        { service: "whale-agent",               price: "$0.002", paid: whale?.paid ?? false,      txHash: whale?.txHash },
      ],
    };

    const reportId = generateReportId(topic, ts);
    const report: CachedReport = {
      id: reportId,
      topic,
      timestamp: ts,
      createdAt: Date.now(),
      alpha,
      agentPayments: paymentLog,
      preview: `${alpha.recommendation} | Confidence: ${alpha.confidence}`,
    };
    cacheReport(report);

    res.json({
      service: "alphaclaw-coordinator",
      timestamp: ts,
      topic,
      alpha,
      agentPayments: paymentLog,
      cachedReport: { id: reportId, availableAt: `/report/${reportId}`, price: "$0.01" },
      economicCycle: {
        bought: "$0.039 from 5 agents",
        sold: "$0.050 to client",
        margin: "$0.011 per hunt",
      },
    });
  });
}
