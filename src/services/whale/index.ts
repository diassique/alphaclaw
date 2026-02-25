import { createService } from "../../lib/service-factory.js";
import { ApiCache } from "../../lib/cache.js";
import { fetchWithRetry } from "../../lib/fetch-retry.js";
import { validateAddress, validateInt } from "../../lib/validate.js";
import { config } from "../../config/env.js";
import { createPublicClient, http, parseAbiItem, formatEther, type PublicClient } from "viem";
import { baseSepolia } from "viem/chains";
import type { WhaleMovement } from "../../types/index.js";

const USDC_CONTRACT = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
const WHALE_THRESHOLD_ETH = 0.001;
const WHALE_THRESHOLD_USDC = 100;
const BLOCK_RANGE = 50n;
const DEFAULT_ADDRESS = config.walletAddress || "0xF81D8A1e6c0487858463C6B3135340eF6E4c3C10";

const rpcUrl = config.baseRpcUrl;
const publicClient: PublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(rpcUrl),
}) as PublicClient;

const movementCache = new ApiCache<WhaleMovement[]>();
const ethPriceCache = new ApiCache<number>();
const MOVEMENT_TTL = 120_000;
const PRICE_TTL = 60_000;

const { app, log, start } = createService({
  name: "whale",
  displayName: "whale-agent",
  port: config.ports.whale,
  routes: {
    "POST /whale": {
      price: "$0.002",
      description: "Whale wallet movements — large on-chain flows on Base Sepolia",
    },
  },
  healthExtra: () => ({ rpcUrl }),
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

// ─── On-chain fetchers using viem ───────────────────────────────────────────

async function fetchETHTransfers(address: string): Promise<WhaleMovement[]> {
  const addr = address.toLowerCase();
  const ethPrice = await fetchETHPrice();

  try {
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > BLOCK_RANGE ? latestBlock - BLOCK_RANGE : 0n;

    const movements: WhaleMovement[] = [];

    for (let blockNum = latestBlock; blockNum > fromBlock && movements.length < 20; blockNum--) {
      const block = await publicClient.getBlock({ blockNumber: blockNum, includeTransactions: true });
      if (!block.transactions || !Array.isArray(block.transactions)) continue;

      for (const tx of block.transactions) {
        if (typeof tx === "string") continue;
        const from = tx.from?.toLowerCase() ?? "";
        const to = tx.to?.toLowerCase() ?? "";
        if (from !== addr && to !== addr) continue;

        const ethVal = parseFloat(formatEther(tx.value));
        if (ethVal < WHALE_THRESHOLD_ETH) continue;

        movements.push({
          hash: tx.hash,
          from: tx.from,
          to: tx.to ?? "0x0",
          value: ethVal.toFixed(6),
          tokenSymbol: "ETH",
          timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
          isWhale: ethVal >= WHALE_THRESHOLD_ETH * 10,
          usdEstimate: ethPrice > 0 ? `$${(ethVal * ethPrice).toFixed(2)}` : undefined,
        });
      }
    }

    return movements;
  } catch (err) {
    log.warn("ETH transfer scan failed", { error: (err as Error).message });
    return [];
  }
}

async function fetchERC20Transfers(address: string): Promise<WhaleMovement[]> {
  const ethPrice = await fetchETHPrice();
  void ethPrice;

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

    const addr = address.toLowerCase();
    const movements: WhaleMovement[] = [];

    for (const logEntry of logs) {
      const from = (logEntry.args.from ?? "").toLowerCase();
      const to = (logEntry.args.to ?? "").toLowerCase();
      if (from !== addr && to !== addr) continue;

      const rawVal = logEntry.args.value ?? 0n;
      const amount = Number(rawVal) / 1e6;
      if (amount < WHALE_THRESHOLD_USDC) continue;

      let timestamp = new Date().toISOString();
      try {
        const block = await publicClient.getBlock({ blockNumber: logEntry.blockNumber });
        timestamp = new Date(Number(block.timestamp) * 1000).toISOString();
      } catch { /* use current time */ }

      movements.push({
        hash: logEntry.transactionHash ?? "0x",
        from: logEntry.args.from ?? "0x",
        to: logEntry.args.to ?? "0x",
        value: amount.toFixed(2),
        tokenSymbol: "USDC",
        timestamp,
        isWhale: amount >= WHALE_THRESHOLD_USDC * 10,
        usdEstimate: `$${amount.toFixed(2)}`,
      });
    }

    return movements;
  } catch (err) {
    log.warn("ERC20 transfer scan failed", { error: (err as Error).message });
    return [];
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

app.post("/whale", async (req, res) => {
  const address = validateAddress(req, res, "address", { defaultVal: DEFAULT_ADDRESS });
  if (address === null) return;
  const limit = validateInt(req, res, "limit", { min: 1, max: 50, defaultVal: 10 });
  if (limit === null) return;

  const cacheKey = `whale:${address}`;

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
          fetchETHTransfers(address),
          fetchERC20Transfers(address),
        ]);

        movements = [...ethMoves, ...usdcMoves]
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

        movementCache.set(cacheKey, movements, MOVEMENT_TTL);
        log.info("fetched live whale data", { address: address.slice(0, 10), count: movements.length });
      } catch (err) {
        log.warn("live fetch failed", { error: (err as Error).message });
        if (movementCache.has(cacheKey)) {
          movements = movementCache.get(cacheKey)!;
          cached = true;
          cacheAge = movementCache.age(cacheKey);
          log.warn("returning stale cache", { cacheAge });
        } else {
          throw new Error("API_UNAVAILABLE");
        }
      }
    }

    const limited = movements.slice(0, limit);
    const whaleCount = limited.filter(m => m.isWhale).length;
    const totalVolumeUSD = limited.reduce((sum, m) => {
      const v = parseFloat(m.usdEstimate?.replace("$", "") ?? "0");
      return sum + v;
    }, 0);

    const signal = whaleCount >= 2 ? "ACCUMULATION" : whaleCount === 1 ? "WATCH" : "QUIET";

    log.info("whale", { address: address.slice(0, 10), movements: limited.length, whaleCount, signal, cached });

    res.json({
      service: "whale-agent",
      timestamp: new Date().toISOString(),
      result: {
        address,
        movements: limited,
        whaleCount,
        totalVolumeUSD: `$${totalVolumeUSD.toFixed(2)}`,
        signal,
        source: "viem-rpc",
      },
      ...(cached ? { cached: true, cacheAge } : {}),
    });
  } catch (err) {
    const msg = (err as Error).message;
    log.error("whale failed", { error: msg });
    res.status(502).json({
      service: "whale-agent",
      timestamp: new Date().toISOString(),
      error: "Blockchain RPC unavailable",
      code: "API_UNAVAILABLE",
      cached: false,
    });
  }
});

start();
