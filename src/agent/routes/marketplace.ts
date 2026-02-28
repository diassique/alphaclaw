import type { Express } from "express";
import { startMarketplace, stopMarketplace, getMarketplaceStatus } from "../marketplace.js";

export function registerMarketplaceRoutes(app: Express): void {
  app.post("/marketplace/start", async (_req, res) => {
    try {
      const status = await startMarketplace();
      res.json(status);
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.post("/marketplace/stop", async (_req, res) => {
    try {
      await stopMarketplace();
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: (err as Error).message });
    }
  });

  app.get("/marketplace/status", (_req, res) => {
    res.json(getMarketplaceStatus());
  });
}
