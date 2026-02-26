import { randomUUID } from "crypto";
import type { Application } from "express";
import { validateString } from "../../lib/validate.js";
import { createLogger } from "../../lib/logger.js";
import { walletClient } from "../wallet.js";
import { callAllServices } from "../orchestrator.js";
import { synthesizeAlpha } from "../synthesis.js";
import { generateReportId, cacheReport } from "../report-cache.js";
import { getEffectivePrice } from "../../config/services.js";
import type { SentimentResult, PolymarketResult, DefiResult, NewsResult, WhaleResult, PaymentLog, CachedReport } from "../../types/index.js";

const log = createLogger("coordinator");

export function registerHuntRoutes(app: Application): void {
  app.post("/hunt", async (req, res) => {
    const topic = validateString(req, res, "topic", { maxLen: 200, defaultVal: "crypto market" });
    if (topic === null) return;

    const huntId = randomUUID().slice(0, 12);
    const ts = new Date().toISOString();
    const { news, sentiment, polymarket, defi, whale, warnings, competitionResult } = await callAllServices(topic);

    log.info("hunt", { huntId, topic, warnings: warnings.length > 0 ? warnings : undefined });

    const alpha = synthesizeAlpha({
      huntId,
      sentimentResult:  sentiment?.data as { result?: SentimentResult } | null,
      polymarketResult: polymarket?.data as { result?: PolymarketResult } | null,
      defiResult:       defi?.data as { result?: DefiResult } | null,
      newsResult:       news?.data as { result?: NewsResult } | null,
      whaleResult:      whale?.data as { result?: WhaleResult } | null,
      warnings,
      competitionResult,
    });

    const dp = alpha.dynamicPricing;
    const priceOf = (svc: string) => dp.find(p => p.service === svc)?.effectivePrice ?? "?";

    const paymentLog: PaymentLog = {
      totalPaid: walletClient ? `${dp.reduce((s, p) => s + parseFloat(p.effectivePrice.replace("$", "")), 0).toFixed(4)} USDC to 5 sub-agents (dynamic)` : "demo mode — no wallet",
      breakdown: [
        { service: "news-agent",                price: priceOf("news"),       paid: news?.paid ?? false,       txHash: news?.txHash },
        { service: "crypto-sentiment",          price: priceOf("sentiment"),  paid: sentiment?.paid ?? false,  txHash: sentiment?.txHash },
        { service: "polymarket-alpha-scanner",  price: priceOf("polymarket"), paid: polymarket?.paid ?? false, txHash: polymarket?.txHash },
        { service: "defi-alpha-scanner",        price: priceOf("defi"),       paid: defi?.paid ?? false,       txHash: defi?.txHash },
        { service: "whale-agent",               price: priceOf("whale"),      paid: whale?.paid ?? false,      txHash: whale?.txHash },
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
      stakingSummary: alpha.stakingSummary,
      preview: `${alpha.recommendation} | Confidence: ${alpha.confidence}`,
    };
    cacheReport(report);

    res.json({
      service: "alphaclaw-coordinator",
      timestamp: ts,
      topic,
      huntId,
      alpha,
      agentPayments: paymentLog,
      cachedReport: { id: reportId, availableAt: `/report/${reportId}`, price: "$0.01" },
      dynamicPricing: alpha.dynamicPricing,
      economicCycle: {
        bought: `$${dp.reduce((s, p) => s + parseFloat(p.effectivePrice.replace("$", "")), 0).toFixed(4)} from 5 agents (reputation-adjusted)`,
        sold: "$0.050 to client",
        margin: `$${(0.05 - dp.reduce((s, p) => s + parseFloat(p.effectivePrice.replace("$", "")), 0)).toFixed(4)} per hunt`,
      },
    });
  });
}
