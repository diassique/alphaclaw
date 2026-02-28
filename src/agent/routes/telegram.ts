import type { Application } from "express";
import { getTelegramStatus, setAlertThreshold, handleUpdate } from "../telegram.js";
import { callAllServices } from "../orchestrator.js";
import { synthesizeAlpha } from "../synthesis.js";
import { getReputationSnapshot } from "../reputation.js";
import { getAutopilotStatus, startAutopilot, stopAutopilot } from "../autopilot.js";
import { getCircuitSnapshot } from "../circuit-breaker.js";
import { walletClient } from "../wallet.js";
import type { SentimentResult, PolymarketResult, DefiResult, NewsResult, WhaleResult } from "../../types/index.js";
import { randomUUID } from "crypto";

export function registerTelegramRoutes(app: Application): void {
  app.get("/telegram/status", (_req, res) => {
    res.json(getTelegramStatus());
  });

  app.post("/telegram/threshold", (req, res) => {
    const threshold = Number(req.body?.threshold);
    if (!Number.isFinite(threshold)) {
      res.status(400).json({ error: "threshold must be a number" });
      return;
    }
    setAlertThreshold(threshold);
    res.json({ ok: true, ...getTelegramStatus() });
  });

  app.post("/telegram/webhook", async (req, res) => {
    res.json({ ok: true }); // Respond immediately

    await handleUpdate(req.body, {
      doHunt: async (topic: string) => {
        const huntId = randomUUID().slice(0, 12);
        const { news, sentiment, polymarket, defi, whale, warnings, competitionResult } = await callAllServices(topic);
        const alpha = await synthesizeAlpha({
          huntId,
          sentimentResult: sentiment?.data as { result?: SentimentResult } | null,
          polymarketResult: polymarket?.data as { result?: PolymarketResult } | null,
          defiResult: defi?.data as { result?: DefiResult } | null,
          newsResult: news?.data as { result?: NewsResult } | null,
          whaleResult: whale?.data as { result?: WhaleResult } | null,
          warnings,
          competitionResult,
        });
        return { alpha };
      },
      getStatus: () => ({
        wallet: !!walletClient,
        circuits: getCircuitSnapshot(),
        autopilot: getAutopilotStatus(),
      }),
      getReputation: () => getReputationSnapshot(),
      getAutopilotStatus,
      startAutopilot,
      stopAutopilot,
    });
  });
}
