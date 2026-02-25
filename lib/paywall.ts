/**
 * Conditional x402 paywall + CORS for browser dashboard health checks.
 * If WALLET_ADDRESS is a valid 0x address, applies the paywall.
 * If not, runs in demo mode (no paywall, logs a warning).
 */
import { paymentMiddleware } from "x402-express";
import type { Application, Request, Response, NextFunction } from "express";

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export interface RouteConfig {
  price: string;
  network?: string;
  description: string;
}

// Allow browser dashboard to call service health endpoints cross-origin
function applyCors(app: Application): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
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
  // CORS always enabled (browser dashboard needs cross-origin health checks)
  applyCors(app);

  const valid = walletAddress && EVM_ADDRESS.test(walletAddress);

  if (!valid) {
    console.warn(
      "[paywall] WALLET_ADDRESS not set or invalid — running WITHOUT x402 paywall (demo mode).\n" +
      "          Set WALLET_ADDRESS=0x... in .env to enforce real micropayments."
    );
    return;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(paymentMiddleware(walletAddress as `0x${string}`, routes as any, { url: facilitatorUrl as any }));
  console.log(`[paywall] x402 active — receiver: ${walletAddress}`);
}
