import type { Application } from "express";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(__dirname, "..", "pages");

// Read all files once at startup
const sharedCss = readFileSync(join(pagesDir, "shared.css"), "utf-8");
const sharedJs = readFileSync(join(pagesDir, "shared.js"), "utf-8");
const logoSvg = readFileSync(join(__dirname, "../../../claw.svg"));
const dashboardHtml = readFileSync(join(pagesDir, "dashboard.html"), "utf-8");
const huntHtml = readFileSync(join(pagesDir, "hunt.html"), "utf-8");
const autopilotHtml = readFileSync(join(pagesDir, "autopilot.html"), "utf-8");
const reputationHtml = readFileSync(join(pagesDir, "reputation.html"), "utf-8");
const memoryHtml = readFileSync(join(pagesDir, "memory.html"), "utf-8");
const networkHtml = readFileSync(join(pagesDir, "network.html"), "utf-8");
const reportsHtml = readFileSync(join(pagesDir, "reports.html"), "utf-8");
const telegramHtml = readFileSync(join(pagesDir, "telegram.html"), "utf-8");

export function registerPageRoutes(app: Application): void {
  // Static assets
  app.get("/dashboard.css", (_req, res) => {
    res.setHeader("Content-Type", "text/css");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(sharedCss);
  });

  app.get("/dashboard.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(sharedJs);
  });

  app.get("/logo.svg", (_req, res) => {
    res.setHeader("Content-Type", "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(logoSvg);
  });

  // Pages
  const html = (content: string) => (_req: any, res: any) => {
    res.setHeader("Content-Type", "text/html");
    res.send(content);
  };

  app.get("/", html(dashboardHtml));
  app.get("/hunt-page", html(huntHtml));
  app.get("/autopilot-page", html(autopilotHtml));
  app.get("/reputation-page", html(reputationHtml));
  app.get("/memory-page", html(memoryHtml));
  app.get("/network-page", html(networkHtml));
  app.get("/reports-page", html(reportsHtml));
  app.get("/telegram-page", html(telegramHtml));
}
