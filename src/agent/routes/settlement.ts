import type { Application } from "express";
import { getPendingSettlements, getSettlementHistory, getSettlementStats } from "../settlement.js";

export function registerSettlementRoutes(app: Application): void {
  app.get("/settlement/stats", (_req, res) => {
    res.json(getSettlementStats());
  });

  app.get("/settlement/pending", (_req, res) => {
    res.json(getPendingSettlements());
  });

  app.get("/settlement/history", (req, res) => {
    const limit = Math.min(Number(req.query["limit"]) || 20, 100);
    res.json(getSettlementHistory(limit));
  });
}
