# AlphaClaw

> **Autonomous AI agent network** that hunts alpha on Polymarket & DeFi 24/7.
> Agents pay each other for analytics via **x402 micropayments** on Base Sepolia.
> Built for **SURGE x OpenClaw Hackathon 2026**.

---

## The Idea

Traditional alpha is siloed and expensive. AlphaClaw is an **open marketplace of AI agents** where:

- **6 specialized microservices** sell data streams via x402 micropayments
- **One autonomous coordinator** buys from all agents, synthesizes alpha, and resells premium signals
- **Every data hop is a micropayment** — no API keys, no subscriptions, no gatekeepers
- **Any external AI agent** can register and participate in the network
- **ACP (Alpha Consensus Protocol)** — stake-weighted voting with slashing/rewards ensures honest agents thrive

```
You ──[$0.05]──> AlphaClaw Coordinator
                   |──[$0.001]──> News Agent (CryptoPanic)
                   |──[$0.001]──> Crypto Sentiment (NLP)
                   |──[$0.020]──> Polymarket Scanner
                   |──[$0.015]──> DeFi Scanner (CoinGecko)
                   |──[$0.002]──> Whale Tracker (Base RPC)
                   v
             Synthesized Alpha + ACP Consensus
```

---

## Architecture

| Service | Port | Endpoint | Price | Data Source |
|---------|------|----------|-------|-------------|
| `crypto-sentiment` | 4001 | `POST /analyze` | $0.001 | Lexicon-based NLP |
| `crypto-sentiment-v2` | 4006 | `POST /analyze` | $0.001 | Conservative variant (competing) |
| `polymarket-alpha-scanner` | 4002 | `POST /scan` | $0.02 | Polymarket Gamma API |
| `defi-alpha-scanner` | 4003 | `POST /scan` | $0.015 | CoinGecko API |
| `news-agent` | 4004 | `POST /news` | $0.001 | CryptoPanic API |
| `whale-agent` | 4005 | `POST /whale` | $0.002 | Base Sepolia RPC |
| `alphaclaw-coordinator` | 5000 | `POST /hunt` | $0.05 | Orchestrates all agents |

Free endpoints: `GET /health` on all services, plus `GET /ping`, `GET /stream` (SSE), `GET /reports`, `GET /report/:id` on the coordinator.

---

## Key Features

### Agent-to-Agent Payments (x402)
Every service call is a real x402 micropayment. The coordinator pays 5+ agents per hunt, synthesizes results, and resells at a margin. The entire payment chain is transparent and verifiable on Base Sepolia.

### Alpha Consensus Protocol (ACP)
Custom protocol for multi-agent consensus:
- Agents declare direction (bullish/bearish/neutral), confidence, and stake via `X-ACP-*` headers
- Stake-weighted voting determines consensus direction
- Agents that disagree with consensus get **slashed** (50% stake * confidence)
- Agents that agree get **rewarded** (+30% stake * confidence)
- High-confidence wrong bets incur extra penalties; high-confidence correct bets get bonuses
- Full leaderboard with P&L tracking, streaks, and agreement rates

### Settlement Oracle
Predictions are verified against real market prices (CoinGecko) after a delay. Agent reputation is updated based on actual accuracy, not just consensus agreement.

### Adaptive Autopilot
Autonomous hunting with dynamic interval adjustment:
- High confidence signals -> slower hunting (save money)
- Low confidence -> faster hunting (seek more data)
- Topic rotation across configurable watchlist
- Circuit breakers prevent calling failed services

### Agent Memory & Pattern Learning
The coordinator learns signal combinations that historically predict well:
- Tracks 2- and 3-signal patterns across hunts
- Adjusts confidence based on historical pattern accuracy
- Verifies patterns against settlement outcomes

### Dynamic Pricing
Service prices adjust by reputation: `effectivePrice = basePrice * (0.5 + reputation)`. High-reputation agents earn premium pricing; unreliable agents get discounted.

### Open Agent Registry
External AI agents can register via `POST /registry/register` and participate in hunts. The marketplace simulator can spin up mock agents for testing.

### Real-Time Dashboard
10-page React SPA with SSE streaming:
- **Dashboard** — overview, quick hunt, stats
- **Hunt** — full hunt with live payment stream, ACP consensus, signal breakdown
- **Autopilot** — start/stop, live timeline, topic rotation
- **Reputation** — agent scores, sparklines, P&L
- **ACP** — consensus rounds, leaderboard, slash/reward log
- **Memory** — learned patterns, accuracy distribution
- **Network** — health, latency, circuit breakers, agent registry
- **Reports** — cached hunt reports
- **Telegram** — bot alerts configuration
- **Live** — wallet identity, payment flow, transaction feed

### Claude AI Narratives
Optional integration with Claude for human-readable alpha narratives on top of structured data.

### Telegram Bot
`/hunt <topic>` from Telegram, automatic alerts on high-confidence signals, autopilot control.

---

## Agent Economics

| Flow | Amount |
|------|--------|
| Client pays Coordinator | $0.050 |
| Coordinator pays News | $0.001 |
| Coordinator pays Sentiment | $0.001 |
| Coordinator pays Polymarket | $0.020 |
| Coordinator pays DeFi | $0.015 |
| Coordinator pays Whale | $0.002 |
| **Coordinator margin** | **$0.011 per hunt** |

Prices are dynamically adjusted by agent reputation (0.5x to 1.5x).

---

## Quick Start

### 1. Install & configure

```bash
git clone https://github.com/alphaclaw/alphaclaw-services.git
cd alphaclaw-services
npm install
cp .env.example .env
# Edit .env with your wallet address (optional — runs in demo mode without it)
```

### 2. Build the frontend

```bash
npm run web:build
```

### 3. Start all services

```bash
npm start
```

This starts all 7 services (6 data + coordinator) with health checking, auto-restart, and graceful shutdown.

### 4. Open the dashboard

Navigate to `http://localhost:5000` in your browser.

### 5. Run a hunt

From the dashboard Hunt page, or via CLI:

```bash
npm run demo                    # Full interactive demo
npm run demo:health             # Health check all services
```

Or directly via API:

```bash
curl -X POST http://localhost:5000/hunt \
  -H "Content-Type: application/json" \
  -d '{"topic": "bitcoin"}'
```

---

## x402 Payment Flow

```
1. Client -> POST /hunt (no payment)
   <- 402 Payment Required
      { x402Version: 1, accepts: [{ scheme: "exact", network: "base-sepolia", ... }] }

2. Client creates USDC payment on Base Sepolia via x402 facilitator

3. Client -> POST /hunt (with X-PAYMENT header)
   <- 200 OK { alpha, acpRound, agentPayments, dynamicPricing }
```

The coordinator does the same internally for each sub-service call. Every data hop is a real x402 micropayment.

---

## SSE Streaming

`GET /stream?topic=bitcoin` streams hunt progress in real-time:

| Event | Data |
|-------|------|
| `start` | Hunt ID, agent count |
| `paying` | Service name, amount, reputation multiplier |
| `result` | Service response, tx hash, timing |
| `competition` | Sentiment v1 vs v2 winner |
| `alpha` | Synthesized alpha signal |
| `staking` | Staking results per agent |
| `acp:consensus` | Consensus direction, strength, unanimity |
| `acp:settle` | Slash/reward settlement |
| `acp:votes` | Individual agent votes |
| `reputation` | Updated reputation scores |
| `settlement` | Price verification scheduled |
| `cached` | Report ID |
| `done` | Hunt complete |

---

## Tech Stack

- **Runtime**: Node.js 22+ (ESM, built-in `fetch`)
- **Language**: TypeScript (strict, `tsx` runner — no compile step)
- **Framework**: Express 5
- **Payments**: `x402-express` (server), `x402/client` (agent)
- **Wallet**: viem + `privateKeyToAccount`
- **Network**: Base Sepolia testnet (USDC)
- **Frontend**: React 19 + Vite + TypeScript
- **Data**: Polymarket Gamma API, CoinGecko API, CryptoPanic API, Base Sepolia RPC
- **AI**: Claude API (optional, for alpha narratives)

---

## Commands

```bash
npm start                 # Start all services (supervisor with auto-restart)
npm run demo              # Interactive CLI demo
npm run demo:health       # Health check all services
npm run typecheck         # tsc --noEmit
npm run hunter            # Start coordinator only
npm run sentiment         # Start sentiment only
npm run web:dev           # Vite dev server for frontend
npm run web:build         # Build frontend for production
```

---

## Demo Mode

- If `WALLET_ADDRESS` is not a valid `0x...` address, services skip the x402 paywall
- If `AGENT_PRIVATE_KEY` is not set, the coordinator logs payments but doesn't execute on-chain
- Full functionality works in demo mode — ideal for testing and judging

---

## Environment Variables

See `.env.example` for all configuration options including:
- Wallet & x402 payment config
- Service ports
- Claude AI integration
- Telegram bot alerts
- Autopilot tuning
- Moltbook integration
- Cloudflare tunnel

---

## Project Structure

```
src/
  config/env.ts              — Single dotenv.config(), frozen AppConfig
  config/services.ts         — SERVICE_DEFS registry, serviceUrl(), dynamic pricing
  types/index.ts             — All shared domain types (ACP, x402, services)
  lib/                       — cache, fetch-retry, logger, validate, paywall, service-factory, store
  services/
    sentiment/               — Lexicon-based NLP (v1)
    sentiment-v2/            — Conservative variant (competing with v1)
    polymarket/              — Polymarket Gamma API scanner
    defi/                    — CoinGecko momentum scanner
    news/                    — CryptoPanic news aggregator
    whale/                   — Base Sepolia whale tracker
  agent/
    index.ts                 — Coordinator entry (factory + route wiring)
    wallet.ts                — x402 payment client
    orchestrator.ts          — Parallel service calls with circuit breakers
    synthesis.ts             — Alpha synthesis (pure function)
    acp.ts                   — Alpha Consensus Protocol (voting, slashing, rewards)
    autopilot.ts             — Adaptive autonomous hunting
    memory.ts                — Pattern learning across hunts
    reputation.ts            — Agent reputation + staking
    settlement.ts            — Settlement oracle (CoinGecko price verification)
    claude.ts                — Claude AI narrative bridge
    telegram.ts              — Telegram bot integration
    moltbook.ts              — Moltbook posting integration
    routes/                  — Express route handlers (hunt, stream, acp, etc.)
  start-all.ts               — Process supervisor (health checks, auto-restart)
web/
  src/pages/                 — 10 React pages (Dashboard, Hunt, ACP, etc.)
  src/hooks/                 — usePolling, useHuntStream (SSE)
  src/api/                   — API client + types
```
