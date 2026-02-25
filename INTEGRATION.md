# AlphaClaw + OpenClaw Integration Guide

How to connect alphaclaw-services (this backend) with OpenClaw so that any OpenClaw agent can consume our alpha signals via x402 micropayments.

---

## Overview

There are **three integration paths**, from simplest to deepest:

| Approach | Effort | What it gives you |
|----------|--------|-------------------|
| **1. Skill (SKILL.md)** | ~30 min | Any OpenClaw agent can `/hunt` alpha via natural language |
| **2. Plugin (`registerTool`)** | ~2 hours | Deep integration: streaming, wallet management, report caching |
| **3. MCP Server** | ~1 hour | Expose alphaclaw as an MCP tool server for any MCP-capable agent |

**Recommended for hackathon**: Approach 1 (Skill) — fastest, zero code, works immediately.

---

## Approach 1: OpenClaw Skill (Recommended)

A skill is a SKILL.md file that teaches OpenClaw's agent how to call our endpoints. No TypeScript needed — the agent reads the instructions and executes curl commands.

### Directory structure

```
~/.openclaw/skills/alphaclaw/
  SKILL.md
```

### SKILL.md

```markdown
---
name: alphaclaw
description: Hunt crypto alpha signals — sentiment, prediction markets, DeFi, whale movements. Pays via x402 micropayments.
requires:
  bins:
    - curl
    - jq
---

# AlphaClaw Alpha Hunter

You can query the AlphaClaw network for synthesized crypto trading signals.
The service runs at the URL stored in the ALPHACLAW_URL environment variable (default: http://localhost:5000).

## Full Alpha Hunt ($0.05 via x402)

When the user asks for alpha, trading signals, or market analysis on a topic:

```bash
curl -s -X POST "${ALPHACLAW_URL:-http://localhost:5000}/hunt" \
  -H "Content-Type: application/json" \
  -d "{\"topic\": \"USER_TOPIC_HERE\"}" | jq .
```

If the response is HTTP 402, explain that x402 payment is required ($0.05 USDC on Base Sepolia) and show the payment details from the response body.

If the response is HTTP 200, present the results:
- **Recommendation**: `.alpha.recommendation`
- **Confidence**: `.alpha.confidence`
- **Signals**: `.alpha.signals[]`
- **Breakdown**: sentiment, polymarket, defi, news, whale from `.alpha.breakdown`
- **Payment ledger**: `.agentPayments`

## Cached Reports (free list)

To see previously generated reports:

```bash
curl -s "${ALPHACLAW_URL:-http://localhost:5000}/reports" | jq .
```

## Service Health

Check if all AlphaClaw services are running:

```bash
curl -s "${ALPHACLAW_URL:-http://localhost:5000}/health-all" | jq .
```

## Individual Services

For targeted queries:

- **Sentiment** ($0.001): `curl -s -X POST http://localhost:4001/analyze -H "Content-Type: application/json" -d '{"text": "TOPIC"}' | jq .`
- **Polymarket** ($0.02): `curl -s -X POST http://localhost:4002/scan -H "Content-Type: application/json" -d '{"filter": "TOPIC", "limit": 5}' | jq .`
- **DeFi** ($0.015): `curl -s -X POST http://localhost:4003/scan -H "Content-Type: application/json" -d '{"asset": "TOPIC", "limit": 5}' | jq .`
- **News** ($0.001): `curl -s -X POST http://localhost:4004/news -H "Content-Type: application/json" -d '{"topic": "TOPIC", "limit": 5}' | jq .`
- **Whale** ($0.002): `curl -s -X POST http://localhost:4005/whale -H "Content-Type: application/json" -d '{"limit": 10}' | jq .`

## Pricing

| Endpoint | Price | What |
|----------|-------|------|
| POST /hunt | $0.05 | Full 5-source alpha synthesis |
| GET /report/:id | $0.01 | Cached report |
| POST /analyze | $0.001 | Sentiment only |
| POST /scan (4002) | $0.02 | Polymarket only |
| POST /scan (4003) | $0.015 | DeFi only |
| POST /news | $0.001 | News only |
| POST /whale | $0.002 | Whale movements only |
```

### Installation

```bash
# Create the skill directory
mkdir -p ~/.openclaw/skills/alphaclaw

# Copy the SKILL.md (or create manually from the template above)
cp INTEGRATION_SKILL.md ~/.openclaw/skills/alphaclaw/SKILL.md
```

Then in OpenClaw config (`~/.openclaw/openclaw.json`):

```json5
{
  skills: {
    entries: {
      alphaclaw: {
        enabled: true,
        env: {
          ALPHACLAW_URL: "http://localhost:5000"  // or your deployed URL
        }
      }
    }
  }
}
```

### Usage in OpenClaw

Once installed, users can say things like:
- "Hunt alpha on ethereum"
- "What are the trading signals for solana?"
- "Check DeFi momentum"
- "Are all AlphaClaw services healthy?"

The agent reads SKILL.md, constructs the right curl command, and presents results.

---

## Approach 2: OpenClaw Plugin (Deep Integration)

For richer features — streaming SSE updates into chat, automatic x402 payment handling, wallet management — build a proper plugin.

### Directory structure

```
alphaclaw-plugin/
  package.json
  openclaw.plugin.json
  src/
    index.ts
```

### package.json

```json
{
  "name": "@alphaclaw/openclaw-plugin",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./src/index.ts"]
  },
  "dependencies": {
    "eventsource": "^3.0.0"
  }
}
```

### openclaw.plugin.json

```json
{
  "id": "alphaclaw",
  "configSchema": {
    "type": "object",
    "properties": {
      "baseUrl": { "type": "string", "default": "http://localhost:5000" }
    }
  },
  "uiHints": {
    "baseUrl": { "label": "AlphaClaw URL", "placeholder": "http://localhost:5000" }
  }
}
```

### src/index.ts

```ts
export default function register(api: any) {
  const baseUrl = api.config?.baseUrl ?? "http://localhost:5000";

  // Tool: hunt alpha
  api.registerTool({
    name: "alphaclaw_hunt",
    description: "Hunt crypto alpha signals from 5 data sources (sentiment, polymarket, defi, news, whale). Costs $0.05 USDC via x402.",
    inputSchema: {
      type: "object",
      properties: {
        topic: { type: "string", description: "Crypto topic to analyze (e.g. 'ethereum', 'solana DeFi')" }
      },
      required: ["topic"]
    },
    handler: async ({ topic }: { topic: string }) => {
      const res = await fetch(`${baseUrl}/hunt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic }),
      });
      return await res.json();
    }
  });

  // Tool: check service health
  api.registerTool({
    name: "alphaclaw_health",
    description: "Check health status of all AlphaClaw network services",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const res = await fetch(`${baseUrl}/health-all`);
      return await res.json();
    }
  });

  // Tool: list cached reports
  api.registerTool({
    name: "alphaclaw_reports",
    description: "List available cached alpha reports (free, no payment)",
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      const res = await fetch(`${baseUrl}/reports`);
      return await res.json();
    }
  });
}
```

### Installation

```bash
cd alphaclaw-plugin && npm install
```

In `~/.openclaw/openclaw.json`:

```json5
{
  plugins: {
    load: { paths: ["/path/to/alphaclaw-plugin"] },
    entries: {
      alphaclaw: { enabled: true, config: { baseUrl: "http://localhost:5000" } }
    }
  }
}
```

---

## Approach 3: MCP Server

Expose alphaclaw as a [Model Context Protocol](https://modelcontextprotocol.io/) server. This works with OpenClaw's [MCP plugin](https://github.com/lunarpulse/openclaw-mcp-plugin) and any other MCP-capable client (Claude Desktop, VS Code, etc.).

### Minimal MCP server (add to alphaclaw-services)

Create `src/mcp-server.ts`:

```ts
import { config } from "./config/env.js";

const port = config.ports.agent;
const BASE = `http://localhost:${port}`;

// Streamable HTTP MCP server
const tools = [
  {
    name: "alphaclaw_hunt",
    description: "Hunt crypto alpha signals ($0.05 USDC via x402). Returns sentiment, polymarket, defi, news, and whale analysis.",
    inputSchema: {
      type: "object" as const,
      properties: { topic: { type: "string", description: "Crypto topic" } },
      required: ["topic"],
    },
  },
  {
    name: "alphaclaw_health",
    description: "Check health of all AlphaClaw services",
    inputSchema: { type: "object" as const, properties: {} },
  },
  {
    name: "alphaclaw_reports",
    description: "List cached alpha reports",
    inputSchema: { type: "object" as const, properties: {} },
  },
];

async function handleToolCall(name: string, args: Record<string, unknown>) {
  switch (name) {
    case "alphaclaw_hunt": {
      const res = await fetch(`${BASE}/hunt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: args.topic ?? "crypto market" }),
      });
      return await res.json();
    }
    case "alphaclaw_health": {
      const res = await fetch(`${BASE}/health-all`);
      return await res.json();
    }
    case "alphaclaw_reports": {
      const res = await fetch(`${BASE}/reports`);
      return await res.json();
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
```

Then register in OpenClaw's MCP config:

```json5
{
  mcp: {
    servers: {
      alphaclaw: {
        url: "http://localhost:5000/mcp"  // if you add the MCP endpoint
      }
    }
  }
}
```

---

## Deployment for Production

For the hackathon demo or production, alphaclaw-services needs to be reachable from wherever OpenClaw runs.

### Option A: Same machine (localhost)

Both OpenClaw and alphaclaw run on the same VPS. Just use `http://localhost:5000`. This is the simplest setup.

```bash
# Terminal 1: alphaclaw
cd alphaclaw-services && npm start

# Terminal 2: openclaw
openclaw
```

### Option B: Cloudflare Tunnel (remote access)

Expose alphaclaw publicly with HTTPS so remote OpenClaw instances can reach it:

```bash
npm run tunnel
# → https://random-name.trycloudflare.com
```

Then set `ALPHACLAW_URL=https://random-name.trycloudflare.com` in OpenClaw's skill config.

### Option C: Tailscale (private network)

If both machines are on the same Tailscale network:

```bash
# On alphaclaw machine
tailscale serve 5000
```

---

## x402 Payment Handling

### Demo mode (no wallet)

When `WALLET_ADDRESS` is not set, all endpoints work without payment. This is ideal for development and demos.

### With x402 enabled

When x402 is active, every paid endpoint returns HTTP 402 with:

```json
{
  "x402Version": 1,
  "accepts": [{
    "scheme": "exact",
    "network": "base-sepolia",
    "maxAmountRequired": "50000",
    "resource": "...",
    "payTo": "0x...",
    "extra": { "facilitator": "https://x402.org/facilitator" }
  }]
}
```

**For OpenClaw agents to pay automatically**, they need:
1. A funded Base Sepolia wallet (USDC)
2. The x402 client library (`x402/client`) or the x402-Layer skill
3. Logic to handle 402 → sign payment → retry with `X-PAYMENT` header

The Skill approach (Approach 1) delegates this to the user — the agent shows the 402 response and the user can decide to pay. The Plugin approach (Approach 2) can handle payment automatically if the agent has wallet access.

---

## Quick Start Checklist

1. [ ] Start alphaclaw-services: `npm start`
2. [ ] Verify health: `curl localhost:5000/health-all`
3. [ ] Copy SKILL.md to `~/.openclaw/skills/alphaclaw/SKILL.md`
4. [ ] Enable in openclaw.json: `skills.entries.alphaclaw.enabled = true`
5. [ ] Test: ask your OpenClaw agent "hunt alpha on ethereum"
