import type { Application } from "express";
import { getStats, getEntries, verifyEntry } from "../memory.js";

export function registerMemoryRoutes(app: Application): void {
  app.get("/memory/stats", (_req, res) => {
    res.json(getStats());
  });

  app.get("/memory/entries", (req, res) => {
    const limit = Math.min(Number(req.query["limit"]) || 20, 100);
    res.json(getEntries(limit));
  });

  app.post("/memory/verify", (req, res) => {
    const { id, outcome } = req.body as { id?: string; outcome?: string };
    if (!id || !outcome || (outcome !== "correct" && outcome !== "incorrect")) {
      res.status(400).json({ error: "id and outcome (correct|incorrect) required" });
      return;
    }
    const ok = verifyEntry(id, outcome);
    if (!ok) {
      res.status(404).json({ error: "entry not found or already verified" });
      return;
    }
    res.json({ ok: true, id, outcome });
  });
}
