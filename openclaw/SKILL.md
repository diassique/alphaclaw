---
name: alphaclaw
description: Hunt crypto alpha signals — sentiment, prediction markets, DeFi trends, news, whale movements. Autonomous agent network with x402 micropayments.
---

# AlphaClaw Alpha Hunter

You can query the AlphaClaw agent network for synthesized crypto trading signals. The network consists of 5 specialized data agents and 1 coordinator agent that pays them all and synthesizes the results.

Base URL: `${ALPHACLAW_URL:-http://localhost:5000}`

## Full Alpha Hunt

When the user asks for alpha, trading signals, market analysis, or anything related to crypto market intelligence on a specific topic, run the full hunt:

```bash
curl -s -X POST "${ALPHACLAW_URL:-http://localhost:5000}/hunt" \
  -H "Content-Type: application/json" \
  -d "{\"topic\": \"REPLACE_WITH_USER_TOPIC\"}" | jq .
```

Replace `REPLACE_WITH_USER_TOPIC` with whatever the user asked about (e.g. "ethereum", "solana DeFi", "bitcoin halving").

**Interpreting the response (HTTP 200):**
- `.alpha.recommendation` — the main signal (STRONG BUY, MODERATE OPPORTUNITY, WATCH CLOSELY, or WAIT)
- `.alpha.confidence` — confidence percentage
- `.alpha.signals[]` — list of contributing signals
- `.alpha.breakdown.sentiment` — mood analysis (bullish/bearish/neutral)
- `.alpha.breakdown.polymarket` — prediction market data
- `.alpha.breakdown.defi` — DeFi momentum (HOT/WARM/COOL tokens)
- `.alpha.breakdown.news` — relevant headlines
- `.alpha.breakdown.whale` — on-chain whale movements
- `.agentPayments` — transparent payment ledger showing what the coordinator paid each sub-agent

**If HTTP 402:** The endpoint requires x402 payment ($0.05 USDC on Base Sepolia). Show the user the payment requirements from the response body. In demo mode (no WALLET_ADDRESS configured), endpoints work without payment.

Present results clearly: lead with the recommendation and confidence, then break down each signal source.

## Service Health Check

When the user asks if services are running, or before attempting other calls:

```bash
curl -s "${ALPHACLAW_URL:-http://localhost:5000}/health-all" | jq .
```

Shows status of all 6 agents. `.ok` is true if all are online. `.marketplaceStatus` is "FULLY OPERATIONAL" or "DEGRADED".

## Cached Reports

List previously generated alpha reports (free, no payment):

```bash
curl -s "${ALPHACLAW_URL:-http://localhost:5000}/reports" | jq .
```

Each report has an `.id` and `.preview`. To fetch a full cached report:

```bash
curl -s "${ALPHACLAW_URL:-http://localhost:5000}/report/REPORT_ID" | jq .
```

## Individual Data Agents

For more targeted queries, call individual services directly:

**Sentiment Analysis** ($0.001) — analyze text for bullish/bearish signals:
```bash
curl -s -X POST "http://localhost:4001/analyze" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"USER_TEXT_HERE\"}" | jq .
```

**Polymarket Scanner** ($0.02) — find mispriced prediction markets:
```bash
curl -s -X POST "http://localhost:4002/scan" \
  -H "Content-Type: application/json" \
  -d "{\"filter\": \"OPTIONAL_FILTER\", \"limit\": 5}" | jq .
```

**DeFi Momentum** ($0.015) — scan for hot tokens and momentum:
```bash
curl -s -X POST "http://localhost:4003/scan" \
  -H "Content-Type: application/json" \
  -d "{\"asset\": \"OPTIONAL_ASSET\", \"limit\": 5}" | jq .
```

**Crypto News** ($0.001) — latest headlines for a topic:
```bash
curl -s -X POST "http://localhost:4004/news" \
  -H "Content-Type: application/json" \
  -d "{\"topic\": \"TOPIC\", \"limit\": 5}" | jq .
```

**Whale Movements** ($0.002) — on-chain whale activity:
```bash
curl -s -X POST "http://localhost:4005/whale" \
  -H "Content-Type: application/json" \
  -d "{\"limit\": 10}" | jq .
```

## Network Economics

The coordinator buys data from 5 agents for $0.039 total and sells synthesized reports at $0.05 — a $0.011 margin per hunt. All payments use USDC on Base Sepolia via the x402 protocol. This demonstrates autonomous agent-to-agent commerce.
