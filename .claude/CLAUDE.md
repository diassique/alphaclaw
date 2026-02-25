# alphaclaw-services

Autonomous AI agent network for **AlphaClaw** (SURGE hackathon) — hunts alpha on Polymarket & DeFi via x402 micropayments.

## Project Overview

Six services: five paywalled data microservices + one autonomous coordinator agent that pays all five.

| Service                    | Port | Endpoint        | Price   | Description                                   |
|----------------------------|------|-----------------|---------|-----------------------------------------------|
| crypto-sentiment           | 4001 | `POST /analyze` | $0.001  | Crypto-specific bullish/bearish sentiment      |
| polymarket-alpha-scanner   | 4002 | `POST /scan`    | $0.02   | Live Polymarket market scanner (alpha signals) |
| defi-alpha-scanner         | 4003 | `POST /scan`    | $0.015  | DeFi momentum scanner via CoinGecko API       |
| news-agent                 | 4004 | `POST /news`    | $0.001  | News articles via CryptoPanic API              |
| whale-agent                | 4005 | `POST /whale`   | $0.002  | On-chain whale movements via Base Sepolia RPC  |
| alphaclaw-coordinator      | 5000 | `POST /hunt`    | $0.05   | Pays all 5 services, synthesizes alpha        |

Health checks at `GET /health` are free. Coordinator also has `GET /ping`, `GET /stream` (SSE), `GET /reports`, `GET /report/:id`.

## Agent-to-Agent Payment Flow

```
Client → [$0.05] → Coordinator
Coordinator → [$0.001] → news
Coordinator → [$0.001] → sentiment
Coordinator → [$0.020] → polymarket
Coordinator → [$0.015] → defi
Coordinator → [$0.002] → whale
Coordinator synthesizes → returns alpha (margin: $0.011)
```

## Tech Stack

- **Runtime**: Node.js 22+ ESM (`"type": "module"`)
- **Language**: TypeScript (strict, `tsx` runner — no compile step)
- **Framework**: Express 5
- **Payments**: `x402-express` (server), `x402/client` (agent)
- **Wallet**: `viem` + `privateKeyToAccount`
- **Network**: Base Sepolia testnet (USDC)
- **Data**: Polymarket Gamma API, CoinGecko API, CryptoPanic API, Base RPC

## Project Structure

```
src/
  config/
    env.ts                        — Single dotenv.config(), typed frozen AppConfig
    services.ts                   — SERVICE_DEFS registry, serviceUrl() helper
  types/
    index.ts                      — All cross-boundary domain types
  lib/
    cache.ts                      — In-memory TTL cache (ApiCache<T>)
    fetch-retry.ts                — Fetch with retry + exponential backoff
    logger.ts                     — Structured JSON logger (createLogger)
    validate.ts                   — Express request validation helpers
    paywall.ts                    — Conditional x402 paywall + CORS
    service-factory.ts            — createService() eliminates boilerplate
  services/
    sentiment/
      index.ts                    — Factory + route handler
      lexicon.ts                  — Word maps, phrases, negation sets
    polymarket/
      index.ts                    — Factory + route handler
    defi/
      index.ts                    — Factory + route handler
    news/
      index.ts                    — Factory + route handler
    whale/
      index.ts                    — Factory + route handler
  agent/
    index.ts                      — Factory + route wiring + dashboard
    wallet.ts                     — Wallet setup + x402Fetch
    orchestrator.ts               — call*() functions + callAllServices
    synthesis.ts                  — synthesizeAlpha (pure function)
    report-cache.ts               — Report Map, eviction, caching
    routes/
      hunt.ts                     — POST /hunt
      stream.ts                   — GET /stream (SSE)
      reports.ts                  — GET /reports, GET /report/:id
      status.ts                   — GET /ping, GET /health-all
    dashboard.html                — Single-file SPA dashboard
  start-all.ts                    — Spawns all 6 services via tsx
  demo.ts                         — Interactive CLI demo
```

## Key Abstractions

- **`config/env.ts`** — Calls `dotenv.config()` once, exports frozen `config` object. All files import `config` instead of reading `process.env`.
- **`config/services.ts`** — `SERVICE_DEFS` record with ports, prices, entry files. `serviceUrl(key)` builds base URLs.
- **`lib/service-factory.ts`** — `createService(opts)` returns `{ app, log, start }`. Handles express setup, JSON parsing, CORS, paywall, health endpoint, and listen. Each service adds routes between `createService()` and `start()`.
- **`types/index.ts`** — All shared types in one place (sentiment, polymarket, defi, news, whale, orchestrator, synthesis).

## Environment Variables

```
WALLET_ADDRESS=0x...         # Receives USDC payments (all services)
AGENT_PRIVATE_KEY=0x...      # Coordinator pays sub-services (optional)
FACILITATOR_URL=https://x402.org/facilitator
NETWORK=base-sepolia
PORT_SENTIMENT=4001
PORT_POLYMARKET=4002
PORT_DEFI=4003
PORT_NEWS=4004
PORT_WHALE=4005
PORT_AGENT=5000
CRYPTOPANIC_TOKEN=           # Required for news service
BASE_RPC_URL=https://sepolia.base.org
CORS_ORIGINS=*
```

## Commands

```bash
npm start                    # Start all 6 services
npm run demo                 # Full interactive demo
npm run demo:health          # Health check all services
npm run typecheck            # tsc --noEmit
npm run hunter               # Start coordinator only
npm run sentiment            # Start sentiment only
# Dashboard: open http://localhost:5000 in browser
```

## Demo Mode

If `WALLET_ADDRESS` is not a valid `0x...` address, services skip the x402 paywall (demo mode).
If `AGENT_PRIVATE_KEY` is not set, the coordinator logs payments but doesn't execute them on-chain.
This allows full testing without a funded Base Sepolia wallet.

## Conventions

- All services use `createService()` from `lib/service-factory.ts` for boilerplate-free setup
- All config reads go through `config` from `config/env.ts` — never raw `process.env`
- Shared types live in `types/index.ts` — no type duplication across files
- Service route files export `register*Routes(app)` functions
- ESM only — `import`/`export`, no `require()`
- `.js` extensions in imports (tsx resolves to .ts transparently)
