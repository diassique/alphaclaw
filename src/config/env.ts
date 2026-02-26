import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  walletAddress: string;
  agentPrivateKey: string;
  facilitatorUrl: string;
  network: string;
  corsOrigins: string;
  cryptoPanicToken: string;
  baseRpcUrl: string;
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
  autopilot: {
    baseIntervalMs: number;
    minIntervalMs: number;
    maxIntervalMs: number;
    topics: string[];
  };
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
  walletAddress: env("WALLET_ADDRESS", ""),
  agentPrivateKey: env("AGENT_PRIVATE_KEY", ""),
  facilitatorUrl: env("FACILITATOR_URL", "https://x402.org/facilitator"),
  network: env("NETWORK", "base-sepolia"),
  corsOrigins: env("CORS_ORIGINS", "*"),
  cryptoPanicToken: env("CRYPTOPANIC_TOKEN", ""),
  baseRpcUrl: env("BASE_RPC_URL", "https://sepolia.base.org"),
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
  autopilot: Object.freeze({
    baseIntervalMs: envInt("AUTOPILOT_INTERVAL_MS", 5 * 60_000),
    minIntervalMs: envInt("AUTOPILOT_MIN_INTERVAL_MS", 60_000),
    maxIntervalMs: envInt("AUTOPILOT_MAX_INTERVAL_MS", 15 * 60_000),
    topics: Object.freeze(
      env("AUTOPILOT_TOPICS", "bitcoin,ethereum,solana,DeFi alpha,crypto market").split(",").map(t => t.trim()),
    ) as unknown as string[],
  }),
});
