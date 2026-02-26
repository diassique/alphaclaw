import { createService } from "../../lib/service-factory.js";
import { ApiCache } from "../../lib/cache.js";
import { fetchWithRetry } from "../../lib/fetch-retry.js";
import { validateInt } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import { createPublicClient, http, parseAbiItem, formatEther, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { WhaleMovement } from "../../types/index.js";

// ─── Base Mainnet Configuration ─────────────────────────────────────────────

const USDC_CONTRACT = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const; // USDC on Base mainnet
const WHALE_THRESHOLD_ETH = 1.0;      // ~$3,000+ USD
const WHALE_THRESHOLD_USDC = 50_000;   // $50k+
const BLOCK_RANGE = 50n;               // ~100s of Base blocks (2s/block)

const publicClient: PublicClient = createPublicClient({
  chain: base,
  transport: http(config.baseMainnetRpcUrl),
}) as PublicClient;

const movementCache = new ApiCache<WhaleMovement[]>();
const ethPriceCache = new ApiCache<number>();
const MOVEMENT_TTL = 60_000;
const PRICE_TTL = 60_000;

const { app, log, start } = createService({
  name: "whale",
  displayName: "whale-agent",
  port: config.ports.whale,
  routes: {
    "POST /whale": {
      price: "$0.002",
      description: "Whale wallet movements — large on-chain flows on Base mainnet",
    },
  },
  healthExtra: () => ({ network: "base-mainnet", rpcUrl: config.baseMainnetRpcUrl }),
});

// ─── ETH Price from CoinGecko ────────────────────────────────────────────────

async function fetchETHPrice(): Promise<number> {
  if (ethPriceCache.isFresh("eth")) {
    return ethPriceCache.get("eth")!;
  }

  try {
    const res = await fetchWithRetry(
      "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd",
      undefined,
      { timeoutMs: 5000, retries: 1 },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { ethereum?: { usd?: number } };
    const price = data.ethereum?.usd ?? 0;
    if (price > 0) {
      ethPriceCache.set("eth", price, PRICE_TTL);
      return price;
    }
  } catch (err) {
    log.warn("ETH price fetch failed", { error: (err as Error).message });
  }

  if (ethPriceCache.has("eth")) return ethPriceCache.get("eth")!;
  return 0;
}

// ─── Scan recent blocks for large ETH transfers ─────────────────────────────

const BATCH_SIZE = 10;

async function fetchLargeETHTransfers(address?: string): Promise<WhaleMovement[]> {
  const ethPrice = await fetchETHPrice();
  const addr = address?.toLowerCase();

  try {
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > BLOCK_RANGE ? latestBlock - BLOCK_RANGE : 0n;

    const movements: WhaleMovement[] = [];

    for (let batchStart = latestBlock; batchStart > fromBlock && movements.length < 30; batchStart -= BigInt(BATCH_SIZE)) {
      const blockNums: bigint[] = [];
      for (let i = 0n; i < BigInt(BATCH_SIZE) && batchStart - i > fromBlock; i++) {
        blockNums.push(batchStart - i);
      }

      const blocks = await Promise.all(
        blockNums.map((bn) => publicClient.getBlock({ blockNumber: bn, includeTransactions: true }).catch(() => null)),
      );

      for (const block of blocks) {
        if (!block?.transactions || !Array.isArray(block.transactions)) continue;
        if (movements.length >= 30) break;

        for (const tx of block.transactions) {
          if (typeof tx === "string") continue;

          const from = tx.from?.toLowerCase() ?? "";
          const to = tx.to?.toLowerCase() ?? "";

          // If address specified, filter for it; otherwise find ALL large transfers
          if (addr && from !== addr && to !== addr) continue;

          const ethVal = parseFloat(formatEther(tx.value));
          if (ethVal < WHALE_THRESHOLD_ETH) continue;

          movements.push({
            hash: tx.hash,
            from: tx.from,
            to: tx.to ?? "0x0",
            value: ethVal.toFixed(4),
            tokenSymbol: "ETH",
            timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
            isWhale: ethVal >= WHALE_THRESHOLD_ETH * 10,
            usdEstimate: ethPrice > 0 ? `$${(ethVal * ethPrice).toLocaleString("en-US", { maximumFractionDigits: 0 })}` : undefined,
          });
        }
      }
    }

    return movements;
  } catch (err) {
    log.warn("ETH transfer scan failed", { error: (err as Error).message });
    return [];
  }
}

// ─── Scan USDC Transfer events on Base mainnet ──────────────────────────────

async function fetchLargeUSDCTransfers(address?: string): Promise<WhaleMovement[]> {
  const addr = address?.toLowerCase();

  try {
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > BLOCK_RANGE ? latestBlock - BLOCK_RANGE : 0n;

    const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");

    const logs = await publicClient.getLogs({
      address: USDC_CONTRACT,
      event: transferEvent,
      args: {},
      fromBlock,
      toBlock: latestBlock,
    });

    const movements: WhaleMovement[] = [];

    // Get block timestamps in batch for unique block numbers
    const blockNumbers = [...new Set(logs.map(l => l.blockNumber))];
    const blockTimestamps = new Map<bigint, string>();
    const batchedBlocks = await Promise.all(
      blockNumbers.slice(0, 20).map(bn =>
        publicClient.getBlock({ blockNumber: bn }).then(b => [bn, new Date(Number(b.timestamp) * 1000).toISOString()] as const).catch(() => [bn, new Date().toISOString()] as const)
      ),
    );
    for (const [bn, ts] of batchedBlocks) blockTimestamps.set(bn, ts);

    for (const logEntry of logs) {
      const from = (logEntry.args.from ?? "").toLowerCase();
      const to = (logEntry.args.to ?? "").toLowerCase();

      // If address specified, filter for it; otherwise find ALL large transfers
      if (addr && from !== addr && to !== addr) continue;

      const rawVal = logEntry.args.value ?? 0n;
      const amount = Number(rawVal) / 1e6;
      if (amount < WHALE_THRESHOLD_USDC) continue;

      const timestamp = blockTimestamps.get(logEntry.blockNumber) ?? new Date().toISOString();

      movements.push({
        hash: logEntry.transactionHash ?? "0x",
        from: logEntry.args.from ?? "0x",
        to: logEntry.args.to ?? "0x",
        value: amount.toLocaleString("en-US", { maximumFractionDigits: 0 }),
        tokenSymbol: "USDC",
        timestamp,
        isWhale: amount >= WHALE_THRESHOLD_USDC * 10,
        usdEstimate: `$${amount.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
      });
    }

    return movements;
  } catch (err) {
    log.warn("USDC transfer scan failed", { error: (err as Error).message });
    return [];
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post("/whale", async (req, res) => {
  // Address is optional — if omitted, scans ALL large transfers (whale hunting mode)
  const body = req.body as Record<string, unknown> | undefined;
  const rawAddr = body?.["address"] as string | undefined;
  const address = rawAddr && /^0x[a-fA-F0-9]{40}$/.test(rawAddr) ? rawAddr : undefined;

  const limit = validateInt(req, res, "limit", { min: 1, max: 50, defaultVal: 15 });
  if (limit === null) return;

  const cacheKey = `whale:${address ?? "global"}`;

  try {
    let movements: WhaleMovement[];
    let cached = false;
    let cacheAge: number | undefined;

    if (movementCache.isFresh(cacheKey)) {
      movements = movementCache.get(cacheKey)!;
      cached = true;
      cacheAge = movementCache.age(cacheKey);
    } else {
      try {
        const [ethMoves, usdcMoves] = await Promise.all([
          fetchLargeETHTransfers(address),
          fetchLargeUSDCTransfers(address),
        ]);

        movements = [...ethMoves, ...usdcMoves]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        movementCache.set(cacheKey, movements, MOVEMENT_TTL);
        log.info("fetched mainnet whale data", { mode: address ? "address" : "global", count: movements.length });
      } catch (err) {
        log.warn("live fetch failed", { error: (err as Error).message });
        if (movementCache.has(cacheKey)) {
          movements = movementCache.get(cacheKey)!;
          cached = true;
          cacheAge = movementCache.age(cacheKey);
        } else {
          throw new Error("API_UNAVAILABLE");
        }
      }
    }

    const limited = movements.slice(0, limit);
    const whaleCount = limited.filter(m => m.isWhale).length;
    const totalVolumeUSD = limited.reduce((sum, m) => {
      const v = parseFloat(m.usdEstimate?.replace(/[$,]/g, "") ?? "0");
      return sum + v;
    }, 0);

    const signal = whaleCount >= 3 ? "ACCUMULATION" : whaleCount >= 1 ? "WATCH" : "QUIET";

    // Confidence staking score
    const volScore = Math.min(totalVolumeUSD / 1_000_000, 1);
    const confidenceScore = Math.min(1,
      Math.min(whaleCount / 5, 1) * 0.4 +
      volScore * 0.3 +
      Math.min(limited.length / 10, 1) * 0.15 +
      (cached ? 0 : 0.15),
    );
    const confidenceBasis = `${whaleCount} whales, $${totalVolumeUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })} volume, ${limited.length} moves`;

    log.info("whale", {
      mode: address ? "address" : "global",
      movements: limited.length,
      whaleCount,
      signal,
      cached,
      confidenceScore: confidenceScore.toFixed(3),
      totalVolumeUSD: `$${totalVolumeUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
    });

    res.json({
      service: "whale-agent",
      timestamp: new Date().toISOString(),
      network: "base-mainnet",
      result: {
        address: address ?? "global-scan",
        movements: limited,
        whaleCount,
        totalVolumeUSD: `$${totalVolumeUSD.toLocaleString("en-US", { maximumFractionDigits: 0 })}`,
        signal,
        confidenceScore: parseFloat(confidenceScore.toFixed(3)),
        confidenceBasis,
        source: "base-mainnet-rpc",
      },
      ...(cached ? { cached: true, cacheAge } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message;
    log.error("whale failed", { error: msg });
    res.status(502).json({
      service: "whale-agent",
      timestamp: new Date().toISOString(),
      network: "base-mainnet",
      error: "Base mainnet RPC unavailable",
      code: "API_UNAVAILABLE",
      cached: false,
    });
  }
});

start();
