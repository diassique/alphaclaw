import type { Application } from "express";
import { config } from "../../config/env.js";
import { walletClient } from "../wallet.js";
import { getRecentTxs } from "../tx-log.js";
import { fetchWithRetry } from "../../lib/fetch-retry.js";
import { serviceUrl } from "../../config/services.js";
import { createLogger } from "../../lib/logger.js";

const log = createLogger("live");

const BASE_SEPOLIA_EXPLORER = "https://sepolia.basescan.org";
const BASE_MAINNET_EXPLORER = "https://basescan.org";
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const USDC_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function registerLiveRoutes(app: Application): void {
  // Wallet config + explorer links
  app.get("/live/config", (_req, res) => {
    const senderAddr = walletClient?.account?.address ?? null;
    res.json({
      sender: senderAddr,
      receiver: config.walletAddress || null,
      network: config.network,
      explorer: BASE_SEPOLIA_EXPLORER,
      usdcContract: USDC_SEPOLIA,
      whaleNetwork: "base-mainnet",
      whaleExplorer: BASE_MAINNET_EXPLORER,
      usdcMainnet: USDC_MAINNET,
      walletConnected: !!walletClient,
    });
  });

  // Recent transaction feed
  app.get("/live/feed", (req, res) => {
    const limit = Math.min(Number(req.query["limit"]) || 20, 50);
    res.json(getRecentTxs(limit));
  });

  // Whale movements (internal call to whale service, no x402)
  app.get("/live/whales", async (_req, res) => {
    try {
      const whaleUrl = serviceUrl("whale");
      const r = await fetchWithRetry(`${whaleUrl}/whale`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 15 }),
      }, { timeoutMs: 10_000, retries: 1 });

      if (!r.ok) {
        res.status(502).json({ error: "Whale service unavailable", status: r.status });
        return;
      }

      const data = await r.json();
      res.json(data);
    } catch (err) {
      log.warn("whale fetch failed", { error: (err as Error).message });
      res.status(502).json({ error: "Whale service unreachable" });
    }
  });
}
