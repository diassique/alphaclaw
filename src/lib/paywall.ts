/**
 * Conditional x402 paywall + CORS for browser dashboard health checks.
 * If WALLET_ADDRESS is a valid 0x address, applies the paywall.
 * If not, runs in demo mode (no paywall, logs a warning).
 */
import { paymentMiddleware } from "x402-express";
import type { Application, Request, Response, NextFunction } from "express";
import { createLogger } from "./logger.js";
import { config } from "../config/env.js";

const log = createLogger("paywall");
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface RouteConfig {
  price: string;
  network?: string;
  description: string;
}

function applyCors(app: Application): void {
  const origins = config.corsOrigins;
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", origins);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-PAYMENT, Access-Control-Expose-Headers");
    if (req.method === "OPTIONS") { res.sendStatus(204); return; }
    next();
  });
}

export function conditionalPaywall(
  app: Application,
  walletAddress: string | undefined,
  routes: Record<string, RouteConfig>,
  facilitatorUrl: string | undefined,
): void {
  applyCors(app);

  const valid = walletAddress && EVM_ADDRESS.test(walletAddress);

  if (!valid) {
    log.warn("WALLET_ADDRESS not set or invalid — running WITHOUT x402 paywall (demo mode)");
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(paymentMiddleware(walletAddress as `0x${string}`, routes as any, { url: facilitatorUrl as any }));
  log.info("x402 paywall active", { receiver: walletAddress, routes: Object.keys(routes) });
}
