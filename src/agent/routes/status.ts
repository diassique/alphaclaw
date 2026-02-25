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
      port: number;
      status: "ok" | "error" | "offline";
      latencyMs: number;
      price?: string;
    }

    async function probe(name: string, url: string, port: number, price?: string): Promise<ServiceProbeResult> {
      const start = performance.now();
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2500) });
        const latencyMs = Math.round(performance.now() - start);
        const body = await r.json().catch(() => ({})) as { price?: string };
        return { name, url, port, status: r.ok ? "ok" : "error", latencyMs, price: price ?? body.price };
      } catch {
        const latencyMs = Math.round(performance.now() - start);
        return { name, url, port, status: "offline", latencyMs, price };
      }
    }

    const port = config.ports.agent;
    const results = await Promise.all([
      probe("alphaclaw-coordinator",      `http://localhost:${port}/health`,              port),
      probe("news-agent",                 `${serviceUrl("news")}/health`,        config.ports.news,        SERVICE_DEFS["news"]!.price),
      probe("crypto-sentiment",           `${serviceUrl("sentiment")}/health`,   config.ports.sentiment,   SERVICE_DEFS["sentiment"]!.price),
      probe("polymarket-alpha-scanner",   `${serviceUrl("polymarket")}/health`,  config.ports.polymarket,  SERVICE_DEFS["polymarket"]!.price),
      probe("defi-alpha-scanner",         `${serviceUrl("defi")}/health`,        config.ports.defi,        SERVICE_DEFS["defi"]!.price),
      probe("whale-agent",                `${serviceUrl("whale")}/health`,       config.ports.whale,       SERVICE_DEFS["whale"]!.price),
    ]);

    const onlineCount = results.filter(r => r.status === "ok").length;
    const totalCount = results.length;
    const avgLatency = Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / totalCount);

    res.json({
      ok: onlineCount === totalCount,
      onlineCount,
      totalCount,
      avgLatencyMs: avgLatency,
      services: results,
      marketplaceStatus: onlineCount === totalCount ? "FULLY OPERATIONAL" : onlineCount > 0 ? "DEGRADED" : "OFFLINE",
      checkedAt: new Date().toISOString(),
    });
  });
}
