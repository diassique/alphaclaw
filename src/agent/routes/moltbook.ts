import type { Application } from "express";
import {
  getMoltbookStatus,
  setMoltbookConfig,
  postReportToMoltbook,
  getMoltbookHistory,
} from "../moltbook.js";

export function registerMoltbookRoutes(app: Application): void {
  app.get("/moltbook/status", (_req, res) => {
    res.json(getMoltbookStatus());
  });

  app.post("/moltbook/config", (req, res) => {
    const { apiKey, submolt, autoPost, minConfidence } = req.body ?? {};
    const patch: Record<string, unknown> = {};
    if (typeof apiKey === "string") patch.apiKey = apiKey;
    if (typeof submolt === "string") patch.submolt = submolt;
    if (typeof autoPost === "boolean") patch.autoPost = autoPost;
    if (typeof minConfidence === "number" && Number.isFinite(minConfidence)) patch.minConfidence = minConfidence;

    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: "provide at least one of: apiKey, submolt, autoPost, minConfidence" });
      return;
    }

    setMoltbookConfig(patch as Parameters<typeof setMoltbookConfig>[0]);
    res.json({ ok: true, ...getMoltbookStatus() });
  });

  app.post("/moltbook/post-hunt", async (req, res) => {
    const reportId = req.body?.reportId;
    if (typeof reportId !== "string" || !reportId) {
      res.status(400).json({ error: "reportId is required" });
      return;
    }

    const result = await postReportToMoltbook(reportId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.get("/moltbook/history", (_req, res) => {
    res.json({ posts: getMoltbookHistory() });
  });
}
