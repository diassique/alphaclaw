/**
 * Express app factory — eliminates boilerplate across all services.
 *
 * Usage:
 *   const { app, log, start } = createService({ name: "sentiment", port: 4001, ... });
 *   app.post("/analyze", handler);
 *   start();
 */

import express, { type Application } from "express";
import compression from "compression";
import helmet from "helmet";
import { conditionalPaywall, type RouteConfig } from "./paywall.js";
import { createLogger, type Logger } from "./logger.js";
import { config } from "../config/env.js";
import type { Server } from "http";

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
  start: () => Server;
}

const SHUTDOWN_TIMEOUT = 10_000; // 10s max for graceful shutdown

export function createService(opts: ServiceOpts): ServiceInstance {
  const app = express();

  // Security headers
  app.use(helmet({ contentSecurityPolicy: false }));
  // Gzip/brotli compression
  app.use(compression());
  // JSON body with size limit
  app.use(express.json({ limit: "10kb" }));

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

  let shutdownCalled = false;

  function start(): Server {
    const server = app.listen(opts.port, () => {
      log.info(`listening on http://localhost:${opts.port}`);
    });

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        log.error(`port ${opts.port} already in use — exiting`, { code: err.code });
      } else {
        log.error(`server error: ${err.message}`, { code: err.code });
      }
      process.exit(1);
    });

    // Graceful shutdown (idempotent)
    const shutdown = (signal: string) => {
      if (shutdownCalled) return;
      shutdownCalled = true;
      log.info(`${signal} received — shutting down gracefully`);
      server.close(() => {
        log.info("server closed");
        process.exit(0);
      });
      setTimeout(() => {
        log.warn("graceful shutdown timed out — forcing exit");
        process.exit(1);
      }, SHUTDOWN_TIMEOUT).unref();
    };

    process.on("SIGTERM", () => shutdown("SIGTERM"));
    process.on("SIGINT", () => shutdown("SIGINT"));

    process.on("uncaughtException", (err) => {
      log.error(`uncaught exception: ${err.message}`, { stack: err.stack });
      shutdown("uncaughtException");
    });

    process.on("unhandledRejection", (reason) => {
      log.error(`unhandled rejection: ${reason}`);
    });

    return server;
  }

  return { app, log, start };
}
