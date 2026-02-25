/**
 * Express app factory — eliminates boilerplate across all services.
 *
 * Usage:
 *   const { app, log, start } = createService({ name: "sentiment", port: 4001, ... });
 *   app.post("/analyze", handler);
 *   start();
 */

import express, { type Application } from "express";
import { conditionalPaywall, type RouteConfig } from "./paywall.js";
import { createLogger, type Logger } from "./logger.js";
import { config } from "../config/env.js";

export interface ServiceOpts {
  /** Logger / service name */
  name: string;
  /** Display name in health responses */
  displayName: string;
  /** Port number */
  port: number;
  /** x402 paywall routes (e.g. { "POST /analyze": { price, description } }) */
  routes: Record<string, RouteConfig>;
  /** Extra health data to merge into GET /health response */
  healthExtra?: () => Record<string, unknown>;
}

export interface ServiceInstance {
  app: Application;
  log: Logger;
  start: () => void;
}

export function createService(opts: ServiceOpts): ServiceInstance {
  const app = express();
  app.use(express.json());

  const log = createLogger(opts.name);

  // Apply network (from config) to all route defs
  const routes: Record<string, RouteConfig> = {};
  for (const [key, val] of Object.entries(opts.routes)) {
    routes[key] = { ...val, network: val.network ?? config.network };
  }

  conditionalPaywall(app, config.walletAddress, routes, config.facilitatorUrl);

  app.get("/health", (_req, res) => {
    res.json({
      service: opts.displayName,
      timestamp: new Date().toISOString(),
      status: "ok",
      port: opts.port,
      ...opts.healthExtra?.(),
    });
  });

  function start(): void {
    app.listen(opts.port, () => {
      log.info(`listening on http://localhost:${opts.port}`);
    });
  }

  return { app, log, start };
}
