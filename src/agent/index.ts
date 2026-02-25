import express from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { networkInterfaces } from "os";
import { conditionalPaywall } from "../lib/paywall.js";
import { createLogger } from "../lib/logger.js";
import { config } from "../config/env.js";
import { walletClient } from "./wallet.js";
import { registerHuntRoutes } from "./routes/hunt.js";
import { registerStreamRoutes } from "./routes/stream.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerStatusRoutes } from "./routes/status.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const log = createLogger("coordinator");
const port = config.ports.agent;

const app = express();
app.use(express.json());

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

// ─── Dashboard ───────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.send(readFileSync(join(__dirname, "dashboard.html")));
});

// ─── Routes ──────────────────────────────────────────────────────────────────

registerHuntRoutes(app);
registerStreamRoutes(app);
registerReportRoutes(app);
registerStatusRoutes(app);

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

app.listen(port, "0.0.0.0", () => {
  const ip = getLocalIP();
  log.info("AlphaClaw Network Coordinator started", {
    port,
    localUrl: `http://localhost:${port}`,
    networkUrl: ip ? `http://${ip}:${port}` : undefined,
    buyCost: "$0.039",
    sellPrice: "$0.050",
  });
});
