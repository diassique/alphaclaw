import type { Application } from "express";
import {
  registerAgent,
  unregisterAgent,
  getAllAgents,
  isBuiltin,
} from "../registry.js";
import type { AgentCategory } from "../../types/index.js";

const VALID_CATEGORIES: AgentCategory[] = ["sentiment", "prediction", "defi", "news", "onchain", "other"];
const KEY_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/;

export function registerRegistryRoutes(app: Application): void {
  // Register a new external agent
  app.post("/registry/register", (req, res) => {
    try {
      const { key, displayName, url, endpoint, price, description, category } = req.body as Record<string, unknown>;

      if (!key || typeof key !== "string" || !KEY_REGEX.test(key)) {
        res.status(400).json({ error: "Invalid key: must be 3-50 lowercase alphanumeric + hyphens" });
        return;
      }
      if (!displayName || typeof displayName !== "string") {
        res.status(400).json({ error: "displayName is required" });
        return;
      }
      if (!url || typeof url !== "string" || (!url.startsWith("http://") && !url.startsWith("https://"))) {
        res.status(400).json({ error: "url must be a valid http/https URL" });
        return;
      }
      if (!endpoint || typeof endpoint !== "string" || !endpoint.startsWith("/")) {
        res.status(400).json({ error: "endpoint must start with /" });
        return;
      }
      if (!price || typeof price !== "string" || !price.startsWith("$")) {
        res.status(400).json({ error: "price must be a string like '$0.005'" });
        return;
      }
      if (!description || typeof description !== "string") {
        res.status(400).json({ error: "description is required" });
        return;
      }
      if (!category || !VALID_CATEGORIES.includes(category as AgentCategory)) {
        res.status(400).json({ error: `category must be one of: ${VALID_CATEGORIES.join(", ")}` });
        return;
      }

      const entry = registerAgent({
        key: key as string,
        displayName: displayName as string,
        url: (url as string).replace(/\/$/, ""), // strip trailing slash
        endpoint: endpoint as string,
        price: price as string,
        description: description as string,
        category: category as AgentCategory,
      });

      res.status(201).json({ registered: true, agent: entry });
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("built-in")) {
        res.status(403).json({ error: msg });
      } else {
        res.status(500).json({ error: msg });
      }
    }
  });

  // Unregister an external agent
  app.delete("/registry/:key", (req, res) => {
    const { key } = req.params;
    if (isBuiltin(key)) {
      res.status(403).json({ error: `Cannot unregister built-in service: ${key}` });
      return;
    }
    const removed = unregisterAgent(key);
    if (!removed) {
      res.status(404).json({ error: `Agent not found: ${key}` });
      return;
    }
    res.json({ unregistered: true, key });
  });

  // List all agents
  app.get("/registry/agents", (_req, res) => {
    const agents = getAllAgents();
    res.json({
      total: agents.length,
      builtin: agents.filter(a => a.builtin).length,
      external: agents.filter(a => !a.builtin).length,
      agents,
    });
  });

  // Protocol spec
  app.get("/registry/protocol", (_req, res) => {
    res.json({
      protocol: "OpenClaw",
      version: "v1",
      description: "External agents register with AlphaClaw to compete in alpha synthesis",
      healthEndpoint: {
        method: "GET",
        path: "/health",
        response: { service: "string", status: "ok", timestamp: "ISO8601" },
      },
      dataEndpoint: {
        method: "POST",
        path: "/<your-endpoint>",
        headers: { "Content-Type": "application/json" },
        note: "Paywalled via x402 — include X-PAYMENT header for paid access",
        request: { topic: "string" },
        response: {
          service: "string",
          timestamp: "ISO8601",
          result: {
            direction: "bullish|bearish|neutral (REQUIRED)",
            confidenceScore: "0.0-1.0 (REQUIRED)",
            confidenceBasis: "string (optional)",
            signals: "string[] (optional)",
            data: "object (optional)",
          },
        },
      },
      registration: {
        method: "POST",
        path: "/registry/register",
        body: {
          key: "lowercase-alphanumeric-hyphens (3-50 chars)",
          displayName: "Human-readable name",
          url: "https://your-agent.example.com",
          endpoint: "/your-endpoint",
          price: "$0.005",
          description: "What your agent does",
          category: "sentiment|prediction|defi|news|onchain|other",
        },
      },
    });
  });
}
