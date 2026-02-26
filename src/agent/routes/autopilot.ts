import type { Application } from "express";
import { config } from "../../config/env.js";
import { startAutopilot, stopAutopilot, getAutopilotStatus, autopilotEmitter } from "../autopilot.js";

export function registerAutopilotRoutes(app: Application): void {
  app.post("/autopilot/start", (_req, res) => {
    const status = startAutopilot();
    res.json({ ok: true, ...status });
  });

  app.post("/autopilot/stop", (_req, res) => {
    const status = stopAutopilot();
    res.json({ ok: true, ...status });
  });

  app.get("/autopilot/status", (_req, res) => {
    res.json(getAutopilotStatus());
  });

  app.get("/autopilot/stream", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.setHeader("Access-Control-Allow-Origin", config.corsOrigins);
    res.status(200);
    res.flushHeaders();

    let closed = false;

    const send = (event: string, data: unknown) => {
      if (closed) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      (res as any).flush?.();
    };

    // Send current status immediately
    send("status", getAutopilotStatus());

    const events = [
      "autopilot:started", "autopilot:stopped", "autopilot:hunting",
      "autopilot:result", "autopilot:adapted", "autopilot:scheduled",
      "autopilot:error", "autopilot:phase",
    ];

    const handler = (evt: string) => (data: unknown) => send(evt, data);
    const handlers = events.map(e => ({ event: e, fn: handler(e) }));
    for (const { event, fn } of handlers) autopilotEmitter.on(event, fn);

    req.on("close", () => {
      closed = true;
      for (const { event, fn } of handlers) autopilotEmitter.removeListener(event, fn);
    });
  });
}
