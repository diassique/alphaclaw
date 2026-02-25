import type { Application } from "express";
import { reportCache, evictExpired, isReportExpired } from "../report-cache.js";

export function registerReportRoutes(app: Application): void {
  app.get("/report/:id", (req, res) => {
    const { id } = req.params;
    const report = reportCache.get(id);

    if (!report) {
      res.status(404).json({ error: "Report not found or expired", cached: reportCache.size });
      return;
    }

    if (isReportExpired(report)) {
      reportCache.delete(id);
      res.status(404).json({ error: "Report expired", cached: reportCache.size });
      return;
    }

    res.json({
      service: "alphaclaw-coordinator",
      reportId: id,
      ...report,
    });
  });

  app.get("/reports", (_req, res) => {
    evictExpired();
    const list = Array.from(reportCache.values()).map(r => ({
      id: r.id,
      topic: r.topic,
      timestamp: r.timestamp,
      preview: r.preview,
      price: "$0.01",
      url: `/report/${r.id}`,
    }));
    res.json({ reports: list, count: list.length });
  });
}
