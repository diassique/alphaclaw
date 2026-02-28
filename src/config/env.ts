import dotenv from "dotenv";
import { randomBytes } from "crypto";

dotenv.config();

export interface AppConfig {
  claude: {
    apiKey: string;
    model: string;
  };
  walletAddress: string;
  agentPrivateKey: string;
  facilitatorUrl: string;
  network: string;
  corsOrigins: string;
  cryptoPanicToken: string;
  baseRpcUrl: string;
  baseMainnetRpcUrl: string;
  ports: {
    sentiment: number;
    sentiment2: number;
    polymarket: number;
    defi: number;
    news: number;
    whale: number;
    agent: number;
  };
  telegram: {
    botToken: string;
    chatId: string;
    alertThreshold: number;
  };
  moltbook: {
    apiKey: string;
    submolt: string;
    autoPost: boolean;
    minConfidence: number;
  };
  autopilot: {
    baseIntervalMs: number;
    minIntervalMs: number;
    maxIntervalMs: number;
    topics: string[];
  };
  cloudflareTunnelToken: string;
  internalSecret: string;
}

function env(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export const config: AppConfig = Object.freeze({
  claude: Object.freeze({
    apiKey: env("ANTHROPIC_API_KEY", ""),
    model: env("CLAUDE_MODEL", "claude-sonnet-4-6"),
  }),
  walletAddress: env("WALLET_ADDRESS", ""),
  agentPrivateKey: env("AGENT_PRIVATE_KEY", ""),
  facilitatorUrl: env("FACILITATOR_URL", "https://x402.org/facilitator"),
  network: env("NETWORK", "base-sepolia"),
  corsOrigins: env("CORS_ORIGINS", "*"),
  cryptoPanicToken: env("CRYPTOPANIC_TOKEN", ""),
  baseRpcUrl: env("BASE_RPC_URL", "https://sepolia.base.org"),
  baseMainnetRpcUrl: env("BASE_MAINNET_RPC_URL", "https://mainnet.base.org"),
  ports: Object.freeze({
    sentiment: envInt("PORT_SENTIMENT", 4001),
    sentiment2: envInt("PORT_SENTIMENT2", 4006),
    polymarket: envInt("PORT_POLYMARKET", 4002),
    defi: envInt("PORT_DEFI", 4003),
    news: envInt("PORT_NEWS", 4004),
    whale: envInt("PORT_WHALE", 4005),
    agent: envInt("PORT_AGENT", 5000),
  }),
  telegram: Object.freeze({
    botToken: env("TELEGRAM_BOT_TOKEN", ""),
    chatId: env("TELEGRAM_CHAT_ID", ""),
    alertThreshold: envInt("TELEGRAM_ALERT_THRESHOLD", 50),
  }),
  moltbook: Object.freeze({
    apiKey: env("MOLTBOOK_API_KEY", ""),
    submolt: env("MOLTBOOK_SUBMOLT", "lablab"),
    autoPost: env("MOLTBOOK_AUTO_POST", "false") === "true",
    minConfidence: envInt("MOLTBOOK_MIN_CONFIDENCE", 40),
  }),
  cloudflareTunnelToken: env("CLOUDFLARE_TUNNEL_TOKEN", ""),
  internalSecret: env("INTERNAL_SECRET", randomBytes(32).toString("hex")),
  autopilot: Object.freeze({
    baseIntervalMs: envInt("AUTOPILOT_INTERVAL_MS", 30_000),       // TODO: revert to 3 * 60_000 after demo
    minIntervalMs: envInt("AUTOPILOT_MIN_INTERVAL_MS", 30_000),    // TODO: revert to 3 * 60_000 after demo
    maxIntervalMs: envInt("AUTOPILOT_MAX_INTERVAL_MS", 15 * 60_000),
    topics: Object.freeze(
      env("AUTOPILOT_TOPICS", "bitcoin,ethereum,solana,DeFi alpha,crypto market").split(",").map(t => t.trim()),
    ) as unknown as string[],
  }),
});
