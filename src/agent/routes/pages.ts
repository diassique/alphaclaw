import type { Application } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDistDir = join(__dirname, "../../../web/dist");

export function registerPageRoutes(app: Application): void {
  const indexHtml = readFileSync(join(webDistDir, "index.html"), "utf-8");

  // Serve static assets from web/dist/
  app.use(express.static(webDistDir, { index: false, maxAge: "1h" }));

  // Logo fallback
  app.get("/logo.svg", (_req, res) => {
    const logoSvg = readFileSync(join(__dirname, "../../../claw.svg"));
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(logoSvg);
  });

  // SPA fallback: any non-API GET → index.html
  app.get("/{*splat}", (req, res, next) => {
    const apiPrefixes = [
      "/hunt", "/stream", "/health", "/ping", "/reports", "/report/",
      "/reputation", "/autopilot", "/memory", "/telegram", "/circuits",
      "/live", "/settlement", "/registry",
    ];
    if (apiPrefixes.some((p) => req.path.startsWith(p))) {
      return next();
    }
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-cache");
    res.send(indexHtml);
  });
}
