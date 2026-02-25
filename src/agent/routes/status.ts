import type { Application } from "express";
import { walletClient } from "../wallet.js";
import { reportCache } from "../report-cache.js";
import { serviceUrl, SERVICE_DEFS } from "../../config/services.js";
import { config } from "../../config/env.js";

export function registerStatusRoutes(app: Application): void {
  app.get("/ping", (_req, res) => {
    res.json({
      service: "alphaclaw-coordinator",
      status: "hunting",
      walletConnected: !!walletClient,
      role: "BUYER + SELLER (full x402 cycle)",
      buysFrom: [
        { service: "news-agent",               url: `${serviceUrl("news")}/news`,              price: "$0.001" },
        { service: "crypto-sentiment",         url: `${serviceUrl("sentiment")}/analyze`,       price: "$0.001" },
        { service: "polymarket-alpha-scanner", url: `${serviceUrl("polymarket")}/scan`,         price: "$0.020" },
        { service: "defi-alpha-scanner",       url: `${serviceUrl("defi")}/scan`,               price: "$0.015" },
        { service: "whale-agent",              url: `${serviceUrl("whale")}/whale`,              price: "$0.002" },
      ],
      sellsAt: [
        { endpoint: "POST /hunt",       price: "$0.050", description: "Full 5-source alpha hunt" },
        { endpoint: "GET /report/:id",  price: "$0.010", description: "Cached synthesized report" },
      ],
      totalBuyCost: "$0.039",
      sellPriceFull: "$0.050",
      margin: "$0.011 per hunt",
      cachedReports: reportCache.size,
    });
  });

  app.get("/health-all", async (_req, res) => {
    interface ServiceProbeResult {
      name: string;
      url: string;
      status: "ok" | "error" | "offline";
      price?: string;
    }

    async function probe(name: string, url: string, price?: string): Promise<ServiceProbeResult> {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
        const body = await r.json().catch(() => ({})) as { price?: string };
        return { name, url, status: r.ok ? "ok" : "error", price: price ?? body.price };
      } catch {
        return { name, url, status: "offline", price };
      }
    }

    const port = config.ports.agent;
    const results = await Promise.all([
      probe("alphaclaw-coordinator",      `http://localhost:${port}/health`),
      probe("news-agent",                 `${serviceUrl("news")}/health`,        SERVICE_DEFS["news"]!.price),
      probe("crypto-sentiment",           `${serviceUrl("sentiment")}/health`,   SERVICE_DEFS["sentiment"]!.price),
      probe("polymarket-alpha-scanner",   `${serviceUrl("polymarket")}/health`,  SERVICE_DEFS["polymarket"]!.price),
      probe("defi-alpha-scanner",         `${serviceUrl("defi")}/health`,        SERVICE_DEFS["defi"]!.price),
      probe("whale-agent",                `${serviceUrl("whale")}/health`,       SERVICE_DEFS["whale"]!.price),
    ]);

    const all = results.every(r => r.status === "ok");
    res.json({ ok: all, services: results, marketplaceStatus: all ? "FULLY OPERATIONAL" : "DEGRADED" });
  });
}
