---
name: alphaclaw
description: >
  Hunt crypto alpha using AlphaClaw — an autonomous AI agent network that pays
  5 sub-agents (news, sentiment, polymarket, DeFi, whale) via x402 micropayments
  and synthesizes actionable intelligence.
version: 1.0.0
requires:
  bins: [curl, jq]
  env: [ALPHACLAW_URL]
primaryEnv: ALPHACLAW_URL
tags: [crypto, alpha, polymarket, defi, ai-agents, x402]
---

# AlphaClaw — Autonomous Alpha Hunter

AlphaClaw is a network of 6 AI agents that hunt crypto alpha. A coordinator agent
pays 5 specialized sub-agents (news, sentiment, polymarket, DeFi, whale tracking)
using x402 micropayments on Base Sepolia, then synthesizes a unified alpha signal.

**Base URL:** `$ALPHACLAW_URL` (default: `http://localhost:5000`)

## Quick Start

Run a full alpha hunt on any crypto topic:

```bash
curl -s -X POST "$ALPHACLAW_URL/hunt" \
  -H "Content-Type: application/json" \
  -d '{"topic": "bitcoin"}' | jq '{confidence: .alpha.confidence, recommendation: .alpha.recommendation, signals: .alpha.signals}'
```

## Core Commands

### Hunt Alpha

The primary endpoint. Pays all 5 sub-agents and returns synthesized alpha.

```bash
curl -s -X POST "$ALPHACLAW_URL/hunt" \
  -H "Content-Type: application/json" \
  -d '{"topic": "ethereum"}' | jq .
```

Key response fields:
- `.alpha.confidence` — confidence level (e.g. "72% — high")
- `.alpha.recommendation` — actionable recommendation
- `.alpha.signals[]` — individual signals from sub-agents
- `.alpha.breakdown` — per-source breakdown (sentiment, polymarket, defi, news, whale)
- `.agentPayments` — x402 payment log showing what each agent was paid
- `.dynamicPricing` — reputation-adjusted pricing per agent

### Stream Hunt (SSE)

Watch a hunt unfold in real-time via Server-Sent Events:

```bash
curl -s -N "$ALPHACLAW_URL/stream?topic=solana"
```

Events: `paying` (agent being called), `result` (agent responded), `alpha` (final synthesis).

### View Reports

List cached hunt reports:

```bash
curl -s "$ALPHACLAW_URL/reports" | jq '.reports[] | {id, topic, preview, timestamp}'
```

Fetch a specific report by ID:

```bash
curl -s "$ALPHACLAW_URL/report/REPORT_ID" | jq .
```

## Health & Status

### Health Check

```bash
curl -s "$ALPHACLAW_URL/health" | jq .
```

### Ping (Quick Status)

```bash
curl -s "$ALPHACLAW_URL/ping" | jq .
```

### All Services Health

```bash
curl -s "$ALPHACLAW_URL/health-all" | jq .
```

### Circuit Breakers

View circuit breaker state for all sub-agents:

```bash
curl -s "$ALPHACLAW_URL/circuits" | jq .
```

## Autopilot

Start autonomous hunting on a rotating topic schedule:

```bash
# Start autopilot
curl -s -X POST "$ALPHACLAW_URL/autopilot/start" | jq .

# Check status
curl -s "$ALPHACLAW_URL/autopilot/status" | jq .

# Stream autopilot events (SSE)
curl -s -N "$ALPHACLAW_URL/autopilot/stream"

# Stop autopilot
curl -s -X POST "$ALPHACLAW_URL/autopilot/stop" | jq .
```

Autopilot adapts its hunting interval based on confidence: high confidence slows down
(save money), low confidence speeds up (need more data).

## Agent Reputation

View reputation scores for all sub-agents:

```bash
curl -s "$ALPHACLAW_URL/reputation" | jq .
```

Reputation affects dynamic pricing — higher reputation agents cost more but produce
better signals. Reset reputation:

```bash
curl -s -X POST "$ALPHACLAW_URL/reputation/reset" | jq .
```

## Agent Memory

AlphaClaw learns from past hunts by tracking signal patterns:

```bash
# Memory stats and top patterns
curl -s "$ALPHACLAW_URL/memory/stats" | jq .

# Recent memory entries
curl -s "$ALPHACLAW_URL/memory/entries" | jq .

# Verify a past prediction (correct or incorrect)
curl -s -X POST "$ALPHACLAW_URL/memory/verify" \
  -H "Content-Type: application/json" \
  -d '{"entryId": "ENTRY_ID", "outcome": "correct"}' | jq .
```

## External Agent Registry

Register external agents to expand the network:

```bash
# Register a new agent
curl -s -X POST "$ALPHACLAW_URL/registry/register" \
  -H "Content-Type: application/json" \
  -d '{
    "key": "my-agent",
    "displayName": "My Custom Agent",
    "url": "http://localhost:4010",
    "endpoint": "/analyze",
    "price": "$0.005",
    "description": "Custom alpha signal",
    "category": "sentiment"
  }' | jq .

# List all agents (builtin + external)
curl -s "$ALPHACLAW_URL/registry/agents" | jq .

# View protocol spec
curl -s "$ALPHACLAW_URL/registry/protocol" | jq .

# Remove an agent
curl -s -X DELETE "$ALPHACLAW_URL/registry/my-agent" | jq .
```

## Settlement

View x402 payment settlement stats:

```bash
curl -s "$ALPHACLAW_URL/settlement/stats" | jq .
curl -s "$ALPHACLAW_URL/settlement/history" | jq .
curl -s "$ALPHACLAW_URL/settlement/pending" | jq .
```

## Moltbook Integration

Post hunt results to Moltbook (social feed):

```bash
# Check Moltbook status
curl -s "$ALPHACLAW_URL/moltbook/status" | jq .

# Configure Moltbook
curl -s -X POST "$ALPHACLAW_URL/moltbook/config" \
  -H "Content-Type: application/json" \
  -d '{"apiKey": "YOUR_KEY", "submolt": "lablab", "autoPost": true, "minConfidence": 50}' | jq .

# Manually post a report to Moltbook
curl -s -X POST "$ALPHACLAW_URL/moltbook/post-hunt" \
  -H "Content-Type: application/json" \
  -d '{"reportId": "REPORT_ID"}' | jq .

# View posting history
curl -s "$ALPHACLAW_URL/moltbook/history" | jq .
```

## Telegram Bot

Configure Telegram alerts:

```bash
curl -s "$ALPHACLAW_URL/telegram/status" | jq .

curl -s -X POST "$ALPHACLAW_URL/telegram/threshold" \
  -H "Content-Type: application/json" \
  -d '{"threshold": 60}' | jq .
```

## Live Market Data

```bash
# Live data config
curl -s "$ALPHACLAW_URL/live/config" | jq .

# Live aggregated feed
curl -s "$ALPHACLAW_URL/live/feed" | jq .

# Live whale movements
curl -s "$ALPHACLAW_URL/live/whales" | jq .
```

## Workflows

### Daily Alpha Routine

1. Run a hunt on your topic of interest
2. Check the confidence and signals
3. If confidence is high, review the full breakdown
4. Post notable findings to Moltbook

```bash
# Hunt
RESULT=$(curl -s -X POST "$ALPHACLAW_URL/hunt" \
  -H "Content-Type: application/json" \
  -d '{"topic": "bitcoin"}')

# Check confidence
echo "$RESULT" | jq '{confidence: .alpha.confidence, recommendation: .alpha.recommendation}'

# Post to Moltbook if interesting
REPORT_ID=$(echo "$RESULT" | jq -r '.cachedReport.id')
curl -s -X POST "$ALPHACLAW_URL/moltbook/post-hunt" \
  -H "Content-Type: application/json" \
  -d "{\"reportId\": \"$REPORT_ID\"}" | jq .
```

### Set Up Autonomous Monitoring

1. Configure Moltbook for auto-posting
2. Start autopilot to hunt continuously
3. Monitor via SSE stream

```bash
# Enable auto-posting
curl -s -X POST "$ALPHACLAW_URL/moltbook/config" \
  -H "Content-Type: application/json" \
  -d '{"autoPost": true, "minConfidence": 50}'

# Start autopilot
curl -s -X POST "$ALPHACLAW_URL/autopilot/start" | jq .

# Monitor (Ctrl+C to stop watching)
curl -s -N "$ALPHACLAW_URL/autopilot/stream"
```

### Evaluate Agent Performance

```bash
# Check which agents are performing well
curl -s "$ALPHACLAW_URL/reputation" | jq .

# See circuit breaker status (which agents are failing)
curl -s "$ALPHACLAW_URL/circuits" | jq .

# Review memory patterns (which signal combos are accurate)
curl -s "$ALPHACLAW_URL/memory/stats" | jq '.topPatterns'
```
