# AlphaClaw 🦅

> **Autonomous AI agent network** that hunts alpha on Polymarket & DeFi 24/7.
> Agents pay each other for analytics via **x402 micropayments** on Base Sepolia.
> Premium insights are sold to end users through the same payment protocol.

---

## The Idea

Traditional alpha services are siloed and expensive. AlphaClaw is different:

- **Three specialized microservices** each sell one data stream via x402
- **One autonomous hunter agent** buys data from all three, synthesizes it, and resells premium signals
- **Every hop is a micropayment** — no API keys, no subscriptions, no gatekeepers
- **Any AI agent** can plug in and start buying signals permissionlessly

```
You ──[$0.05]──→ AlphaClaw Hunter
                    ├──[$0.01]──→ Crypto Sentiment Analyzer
                    ├──[$0.02]──→ Polymarket Alpha Scanner
                    └──[$0.015]─→ DeFi Opportunity Scanner
                    ↓
              Synthesized Alpha Signal
```

---

## Architecture

| Service                    | Port | Endpoint      | Price   | What it does                            |
|----------------------------|------|---------------|---------|-----------------------------------------|
| `crypto-sentiment`         | 4001 | `POST /analyze` | $0.01 | Bullish/bearish signals from text       |
| `polymarket-alpha-scanner` | 4002 | `POST /scan`    | $0.02 | Scans Polymarket for mispriced markets  |
| `defi-alpha-scanner`       | 4003 | `POST /scan`    | $0.015 | Momentum & yield signals from DeFi      |
| `alphaclaw-hunter` (agent) | 5000 | `POST /hunt`    | $0.05 | Full synthesized alpha (pays all three) |

All paid endpoints return **HTTP 402** if no payment is provided.
Free endpoints: `GET /health` on every service, `GET /ping` on the hunter.

---

## Quick Start

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
WALLET_ADDRESS=0x...         # receives USDC payments
AGENT_PRIVATE_KEY=0x...      # hunter's wallet — pays sub-services (optional, demo mode if empty)
FACILITATOR_URL=https://x402.org/facilitator
NETWORK=base-sepolia
```

### 2. Start all services

```bash
node start-all.js
```

### 3. Run the demo

```bash
node demo.js                       # full interactive demo
node demo.js --health              # health check all services
node demo.js --topic "solana ETF"  # hunt alpha on a specific topic
```

---

## x402 Payment Flow

```
1. Client → POST /hunt (no payment)
   ← 402 Payment Required
      { x402Version: 1, accepts: [{ scheme: "exact", network: "base-sepolia", price: "$0.05" }] }

2. Client creates USDC transaction on Base Sepolia via facilitator

3. Client → POST /hunt (with X-PAYMENT header)
   ← 200 OK  { alpha, signals, agentPayments }
```

The Hunter agent does the same thing internally when calling its sub-services.
**Every data hop is a real on-chain micropayment.**

---

## Agent Economics

| Flow                   | Amount   |
|------------------------|----------|
| User pays Hunter       | $0.050   |
| Hunter pays Sentiment  | $0.010   |
| Hunter pays Polymarket | $0.020   |
| Hunter pays DeFi       | $0.015   |
| **Hunter margin**      | **$0.005 per hunt** |

---

## API Reference

### `POST /hunt` (port 5000) — `$0.05`

```json
{ "topic": "ethereum DeFi" }
```

Response:
```json
{
  "service": "alphaclaw-hunter",
  "topic": "ethereum DeFi",
  "alpha": {
    "confidence": "72%",
    "recommendation": "📈 MODERATE OPPORTUNITY — proceed with position sizing",
    "signals": ["bullish sentiment", "Polymarket HIGH: Will ETH exceed $4000...", "DeFi HOT: ETH 4.2%"],
    "breakdown": {
      "sentiment":  { "label": "bullish", "score": 0.28, "confidence": "medium" },
      "polymarket": { "market": "Will ETH exceed $4,000 before April?", "signal": "HIGH", "yesPrice": 0.34 },
      "defi":       { "asset": "ETH", "action": "MOMENTUM ENTRY", "change24h": "4.2%" }
    }
  },
  "agentPayments": {
    "totalPaid": "$0.045 USDC to 3 sub-agents",
    "breakdown": [...]
  }
}
```

### `POST /analyze` (port 4001) — `$0.01`

```json
{ "text": "ETH is mooning, massive breakout incoming" }
```

### `POST /scan` (port 4002) — `$0.02`

```json
{ "filter": "ethereum", "limit": 5 }
```

### `POST /scan` (port 4003) — `$0.015`

```json
{ "asset": "eth", "category": "top", "limit": 5 }
```

---

## Tech Stack

- **Runtime**: Node.js 18+ (ESM, built-in `fetch`)
- **Framework**: Express 5
- **Payments**: `x402-express` (server), `x402/client` (agent)
- **Wallet**: viem + `privateKeyToAccount`
- **Network**: Base Sepolia testnet (USDC)
- **Data**: Polymarket CLOB API, CoinGecko (no API keys required)

---

## Demo Mode

If `AGENT_PRIVATE_KEY` is not set, the Hunter runs in **demo mode**:
- Services still enforce x402 paywalls
- Hunter logs what payments it *would* make
- Direct service calls (without payment) return 402 responses as expected
- Run `node demo.js` to see the full annotated flow

---

Built for **SURGE Hackathon** — [OpenClaw](https://github.com/openclaw) project.
