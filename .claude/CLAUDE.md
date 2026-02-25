# alphaclaw-services

Autonomous AI agent network for **AlphaClaw** (SURGE hackathon) — hunts alpha on Polymarket & DeFi via x402 micropayments.

## Project Overview

Four services: three paywalled data microservices + one autonomous hunter agent that pays all three.

| Service                    | Port | Endpoint        | Price   | Description                                   |
|----------------------------|------|-----------------|---------|-----------------------------------------------|
| crypto-sentiment           | 4001 | `POST /analyze` | $0.01   | Crypto-specific bullish/bearish sentiment      |
| polymarket-alpha-scanner   | 4002 | `POST /scan`    | $0.02   | Live Polymarket market scanner (alpha signals) |
| defi-alpha-scanner         | 4003 | `POST /scan`    | $0.015  | DeFi momentum scanner via CoinGecko API       |
| alphaclaw-hunter (agent)   | 5000 | `POST /hunt`    | $0.05   | Pays all 3 services, synthesizes alpha        |

Health checks at `GET /health` are free. Hunter also has `GET /ping` (free status).

## Agent-to-Agent Payment Flow

```
Client → [$0.05] → Hunter
Hunter  → [$0.01] → sentiment
Hunter  → [$0.02] → polymarket
Hunter  → [$0.015] → defi
Hunter synthesizes → returns alpha
```

## Tech Stack

- **Runtime**: Node.js 18+ ESM modules (`"type": "module"`)
- **Framework**: Express 5
- **Payments**: `x402-express` (server), `x402/client` (agent)
- **Wallet**: `viem` + `privateKeyToAccount`
- **Network**: Base Sepolia testnet (USDC)
- **Data**: Polymarket CLOB API, CoinGecko API (no keys needed)

## Key Files

```
services/sentiment.js   — Crypto sentiment (port 4001)
services/polymarket.js  — Polymarket scanner (port 4002)
services/defi.js        — DeFi scanner (port 4003)
agent/hunter.js         — Autonomous hunter agent (port 5000)
lib/paywall.js          — Conditional x402 paywall helper
start-all.js            — Forks all 4 services via child_process
demo.js                 — Interactive CLI demo with ASCII banner
.env                    — WALLET_ADDRESS, AGENT_PRIVATE_KEY, ports
```

## Environment Variables

```
WALLET_ADDRESS=0x...         # Receives USDC payments (all 4 services)
AGENT_PRIVATE_KEY=0x...      # Hunter pays sub-services with this key (optional)
FACILITATOR_URL=https://x402.org/facilitator
NETWORK=base-sepolia
PORT_SENTIMENT=4001
PORT_POLYMARKET=4002
PORT_DEFI=4003
PORT_AGENT=5000
```

## Commands

```bash
node start-all.js            # Start all 4 services
node demo.js                 # Full interactive demo
node demo.js --health        # Health check all services
node demo.js --topic "eth"   # Hunt alpha for specific topic
node agent/hunter.js         # Start hunter only
```

## Demo Mode

If `WALLET_ADDRESS` is not a valid `0x...` address, services skip the x402 paywall (demo mode).
If `AGENT_PRIVATE_KEY` is not set, the hunter logs payments but doesn't execute them on-chain.
This allows full testing without a funded Base Sepolia wallet.

## Conventions

- All services use `conditionalPaywall` from `lib/paywall.js` instead of `paymentMiddleware` directly
- `lib/paywall.js` validates the wallet address before applying middleware
- Data endpoints use graceful fallback sample data if external APIs are unavailable
- ESM only — `import`/`export`, no `require()`
