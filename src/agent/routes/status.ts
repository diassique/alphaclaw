import type { Application } from "express";
import { walletClient } from "../wallet.js";
import { reportCache } from "../report-cache.js";
import { serviceUrl, SERVICE_DEFS, getAllDynamicPrices } from "../../config/services.js";
import { config } from "../../config/env.js";
import { getCircuitSnapshot } from "../circuit-breaker.js";

export function registerStatusRoutes(app: Application): void {
  app.get("/circuits", (_req, res) => {
    res.json(getCircuitSnapshot());
  });

  app.get("/ping", (_req, res) => {
    const dp = getAllDynamicPrices();
    const totalBuy = dp.reduce((s, p) => s + parseFloat(p.effectivePrice.replace("$", "")), 0);

    res.json({
      service: "alphaclaw-coordinator",
      status: "hunting",
      walletConnected: !!walletClient,
      role: "BUYER + SELLER (full x402 cycle)",
      buysFrom: [
        { service: "news-agent",               url: `${serviceUrl("news")}/news`,              price: dp.find(p => p.service === "news")?.effectivePrice },
        { service: "crypto-sentiment",         url: `${serviceUrl("sentiment")}/analyze`,       price: dp.find(p => p.service === "sentiment")?.effectivePrice },
        { service: "polymarket-alpha-scanner", url: `${serviceUrl("polymarket")}/scan`,         price: dp.find(p => p.service === "polymarket")?.effectivePrice },
        { service: "defi-alpha-scanner",       url: `${serviceUrl("defi")}/scan`,               price: dp.find(p => p.service === "defi")?.effectivePrice },
        { service: "whale-agent",              url: `${serviceUrl("whale")}/whale`,              price: dp.find(p => p.service === "whale")?.effectivePrice },
      ],
      dynamicPricing: dp,
      sellsAt: [
        { endpoint: "POST /hunt",       price: "$0.050", description: "Full 5-source alpha hunt" },
        { endpoint: "GET /report/:id",  price: "$0.010", description: "Cached synthesized report" },
      ],
      totalBuyCost: `$${totalBuy.toFixed(4)}`,
      sellPriceFull: "$0.050",
      margin: `$${(0.05 - totalBuy).toFixed(4)} per hunt`,
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
      probe("crypto-sentiment-v2",        `${serviceUrl("sentiment2")}/health`,  config.ports.sentiment2,  SERVICE_DEFS["sentiment2"]!.price),
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
      networkStatus: onlineCount === totalCount ? "FULLY OPERATIONAL" : onlineCount > 0 ? "DEGRADED" : "OFFLINE",
      checkedAt: new Date().toISOString(),
    });
  });
}
