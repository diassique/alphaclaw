import type { Application } from "express";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistDir = join(__dirname, "../../../web/dist");
const indexHtmlPath = join(webDistDir, "index.html");
const indexHtml = existsSync(indexHtmlPath) ? readFileSync(indexHtmlPath, "utf-8") : null;

function sendSpa(_req: any, res: any): void {
  if (!indexHtml) {
    res.status(503).json({ error: "Frontend not built. Run: npm run web:build" });
    return;
  }
  res.setHeader("Content-Type", "text/html");
  res.setHeader("Cache-Control", "no-cache");
  res.send(indexHtml);
}

/**
 * Register BEFORE API routes.
 * Handles static assets + content negotiation for SPA paths that
 * overlap with API GET routes (/reputation, /reports).
 */
export function registerPageAssets(app: Application): void {
  // Serve static assets from web/dist/ (skip if not built)
  if (existsSync(webDistDir)) {
    app.use(express.static(webDistDir, { index: false, maxAge: "1h" }));
  }

  // Logo fallback
  app.get("/logo.svg", (_req, res) => {
    const logoSvg = readFileSync(join(__dirname, "../../../claw.svg"));
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(logoSvg);
  });

  // SPA pages that share a path with an API GET handler.
  // Browser navigation (Accept: text/html) → serve SPA.
  // API fetch (Accept: application/json) → fall through to API handler.
  const conflictPaths = ["/reputation", "/reports"];
  for (const path of conflictPaths) {
    app.get(path, (req, res, next) => {
      if (req.accepts(["html", "json"]) === "html") {
        sendSpa(req, res);
      } else {
        next();
      }
    });
  }
}

/**
 * Register AFTER API routes.
 * Catch-all SPA fallback for any GET that didn't match an API route.
 */
export function registerSpaFallback(app: Application): void {
  app.get("/{*splat}", (req, res, next) => {
    // Skip requests with file extensions (e.g. .js, .css, .map)
    if (/\.\w+$/.test(req.path)) return next();
    // If the client explicitly wants JSON, let it 404 naturally
    if (req.accepts(["html", "json"]) === "json") return next();
    sendSpa(req, res);
  });
}
