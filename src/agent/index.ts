import express from "express";
import compression from "compression";
import helmet from "helmet";
import { networkInterfaces } from "os";
import { conditionalPaywall } from "../lib/paywall.js";
import { createLogger } from "../lib/logger.js";
import { config } from "../config/env.js";
import { walletClient } from "./wallet.js";
import { registerHuntRoutes } from "./routes/hunt.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerStatusRoutes } from "./routes/status.js";
import { registerReputationRoutes } from "./routes/reputation.js";
import { registerAutopilotRoutes } from "./routes/autopilot.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerTelegramRoutes } from "./routes/telegram.js";
import { registerPageRoutes } from "./routes/pages.js";
import { getReputation, loadReputation } from "./reputation.js";
import { setReputationProvider } from "../config/services.js";
import { loadMemory } from "./memory.js";
import { loadCircuits } from "./circuit-breaker.js";
import { loadReports } from "./report-cache.js";
import { loadAutopilot, stopAutopilot } from "./autopilot.js";
import { flushAllStores, destroyAllStores } from "../lib/store.js";
import { initTelegram } from "./telegram.js";

const log = createLogger("coordinator");
const port = config.ports.agent;

const app = express();

// Security & performance middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.json({ limit: "10kb" }));

// ─── Paywall ─────────────────────────────────────────────────────────────────

conditionalPaywall(app, config.walletAddress, {
  "POST /hunt": {
    price: "$0.05",
    network: config.network,
    description: "AlphaClaw full alpha hunt — 5-source synthesis: news + sentiment + polymarket + DeFi + whale",
  },
  "GET /report": {
    price: "$0.01",
    network: config.network,
    description: "AlphaClaw cached alpha report — synthesized intelligence from 5 data sources",
  },
}, config.facilitatorUrl);

// ─── Pages (dashboard, hunt, autopilot, etc.) ───────────────────────────────

registerPageRoutes(app);

// ─── Load persistent state (order matters: reputation before setReputationProvider) ─

loadMemory();
loadReputation();
loadCircuits();
loadReports();
loadAutopilot();
setReputationProvider((key) => getReputation(key).score);

// ─── Routes ──────────────────────────────────────────────────────────────────

registerHuntRoutes(app);
registerStreamRoutes(app);
registerReportRoutes(app);
registerStatusRoutes(app);
registerReputationRoutes(app);
registerAutopilotRoutes(app);
registerMemoryRoutes(app);
registerTelegramRoutes(app);

// ─── Health ──────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({ service: "alphaclaw-coordinator", timestamp: new Date().toISOString(), status: "ok", port, walletConnected: !!walletClient });
});

// ─── Start ───────────────────────────────────────────────────────────────────

function getLocalIP(): string | null {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) return iface.address;
    }
  }
  return null;
}

const SHUTDOWN_TIMEOUT = 10_000;

const server = app.listen(port, "0.0.0.0", () => {
  const ip = getLocalIP();
  log.info("AlphaClaw Network Coordinator started", {
    port,
    localUrl: `http://localhost:${port}`,
    networkUrl: ip ? `http://${ip}:${port}` : undefined,
    buyCost: "$0.039",
    sellPrice: "$0.050",
  });
  initTelegram();
});

// Graceful shutdown
const shutdown = (signal: string) => {
  log.info(`${signal} received — shutting down coordinator`);
  stopAutopilot();
  flushAllStores();
  destroyAllStores();
  log.info("all stores flushed");
  server.close(() => {
    log.info("coordinator server closed");
    process.exit(0);
  });
  setTimeout(() => {
    log.warn("graceful shutdown timed out — forcing exit");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT).unref();
};

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
