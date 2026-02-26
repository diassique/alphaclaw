import type { Application } from "express";
import { getAllReputations, getReputationSnapshot, resetAllReputations } from "../reputation.js";

export function registerReputationRoutes(app: Application): void {
  app.get("/reputation", (_req, res) => {
    const agents = getAllReputations();
    const snapshot = getReputationSnapshot();
    res.json({
      service: "alphaclaw-coordinator",
      agents,
      snapshot,
      timestamp: new Date().toISOString(),
    });
  });

  app.post("/reputation/reset", (_req, res) => {
    resetAllReputations();
    res.json({
      service: "alphaclaw-coordinator",
      message: "All reputations reset to 0.5",
      snapshot: getReputationSnapshot(),
      timestamp: new Date().toISOString(),
    });
  });
}
