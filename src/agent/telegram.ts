import { createLogger } from "../lib/logger.js";
import { config } from "../config/env.js";
import type { AlphaSynthesis, TelegramConfig } from "../types/index.js";

const log = createLogger("telegram");

let telegramConfig: TelegramConfig = {
  botToken: config.telegram.botToken,
  chatId: config.telegram.chatId,
  alertThreshold: config.telegram.alertThreshold,
  enabled: false,
};

const API_BASE = "https://api.telegram.org/bot";

async function tgCall(method: string, body?: Record<string, unknown>): Promise<unknown> {
  if (!telegramConfig.botToken) return null;
  try {
    const r = await fetch(`${API_BASE}${telegramConfig.botToken}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const data = await r.json() as { ok?: boolean; description?: string };
    if (!data.ok) log.warn("telegram API error", { method, error: data.description });
    return data;
  } catch (err) {
    log.warn("telegram call failed", { method, error: (err as Error).message });
    return null;
  }
}

export function initTelegram(): void {
  if (!config.telegram.botToken || !config.telegram.chatId) {
    log.info("telegram disabled (no TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID)");
    return;
  }
  telegramConfig.enabled = true;
  log.info("telegram enabled", { chatId: telegramConfig.chatId, threshold: telegramConfig.alertThreshold });

  // Send startup message
  sendMessage("*AlphaClaw Coordinator Online*\nReady to deliver alpha. Use /help for commands.").catch(() => {});
}

export function getTelegramStatus(): { enabled: boolean; chatId: string; alertThreshold: number } {
  return {
    enabled: telegramConfig.enabled,
    chatId: telegramConfig.chatId ? `...${telegramConfig.chatId.slice(-4)}` : "",
    alertThreshold: telegramConfig.alertThreshold,
  };
}

export function setAlertThreshold(threshold: number): void {
  telegramConfig.alertThreshold = Math.max(0, Math.min(100, threshold));
  log.info("telegram threshold updated", { threshold: telegramConfig.alertThreshold });
}

async function sendMessage(text: string, chatId?: string): Promise<void> {
  if (!telegramConfig.enabled) return;
  await tgCall("sendMessage", {
    chat_id: chatId ?? telegramConfig.chatId,
    text,
    parse_mode: "Markdown",
  });
}

export async function notifyHuntResult(
  topic: string,
  alpha: AlphaSynthesis,
  source: "manual" | "autopilot" = "manual",
): Promise<void> {
  if (!telegramConfig.enabled) return;
  if (alpha.weightedConfidence < telegramConfig.alertThreshold) return;

  const icon = alpha.weightedConfidence >= 75 ? "🔥" : alpha.weightedConfidence >= 50 ? "📊" : "👀";

  // Use AI narrative if available, otherwise fall back to signals list
  const body = alpha.narrative?.summary
    ? alpha.narrative.summary
    : alpha.signals.slice(0, 4).join(", ");

  const msg = [
    `${icon} *AlphaClaw Alert* (${source})`,
    `*Topic:* ${topic}`,
    `*Confidence:* ${alpha.confidence}`,
    `*Action:* ${alpha.recommendation}`,
    body,
    alpha.narrative?.keyInsight ? `💡 ${alpha.narrative.keyInsight}` : "",
    alpha.breakdown.polymarket ? `*Polymarket:* ${alpha.breakdown.polymarket.market?.slice(0, 60)}` : "",
    alpha.breakdown.defi ? `*DeFi:* ${alpha.breakdown.defi.asset} ${alpha.breakdown.defi.action}` : "",
  ].filter(Boolean).join("\n");

  await sendMessage(msg);
}

interface TelegramUpdate {
  message?: {
    chat?: { id: number };
    text?: string;
    from?: { first_name?: string };
  };
}

export async function handleUpdate(
  update: TelegramUpdate,
  deps: {
    doHunt: (topic: string) => Promise<{ alpha: AlphaSynthesis }>;
    getStatus: () => unknown;
    getReputation: () => unknown;
    getAutopilotStatus: () => unknown;
    startAutopilot: () => unknown;
    stopAutopilot: () => unknown;
  },
): Promise<void> {
  const msg = update.message;
  if (!msg?.text || !msg.chat?.id) return;

  const chatId = String(msg.chat.id);
  const text = msg.text.trim();
  const name = msg.from?.first_name ?? "Agent";

  if (text.startsWith("/hunt")) {
    const topic = text.replace("/hunt", "").trim() || "crypto market";
    await sendMessage(`Hunting alpha on *${topic}*...`, chatId);
    try {
      const { alpha } = await deps.doHunt(topic);
      const reply = [
        `*Hunt Complete: ${topic}*`,
        `Confidence: ${alpha.confidence}`,
        `${alpha.recommendation}`,
        alpha.narrative?.summary ?? `Signals: ${alpha.signals.slice(0, 4).join(", ")}`,
        alpha.narrative?.keyInsight ? `💡 ${alpha.narrative.keyInsight}` : "",
      ].filter(Boolean).join("\n");
      await sendMessage(reply, chatId);
    } catch (err) {
      await sendMessage(`Hunt failed: ${(err as Error).message}`, chatId);
    }
  } else if (text === "/status") {
    const status = deps.getStatus();
    await sendMessage(`*Status:*\n\`\`\`\n${JSON.stringify(status, null, 2).slice(0, 3500)}\n\`\`\``, chatId);
  } else if (text === "/reputation") {
    const rep = deps.getReputation();
    await sendMessage(`*Reputation:*\n\`\`\`\n${JSON.stringify(rep, null, 2).slice(0, 3500)}\n\`\`\``, chatId);
  } else if (text === "/autopilot") {
    const st = deps.getAutopilotStatus();
    await sendMessage(`*Autopilot:*\n\`\`\`\n${JSON.stringify(st, null, 2).slice(0, 3500)}\n\`\`\``, chatId);
  } else if (text === "/autopilot start") {
    deps.startAutopilot();
    await sendMessage("Autopilot *started*", chatId);
  } else if (text === "/autopilot stop") {
    deps.stopAutopilot();
    await sendMessage("Autopilot *stopped*", chatId);
  } else if (text === "/help") {
    await sendMessage([
      `*AlphaClaw Bot* — Hi ${name}!`,
      "",
      "/hunt <topic> — Run alpha hunt",
      "/status — Service status",
      "/reputation — Agent reputations",
      "/autopilot — Autopilot status",
      "/autopilot start — Start autopilot",
      "/autopilot stop — Stop autopilot",
      "/help — This message",
    ].join("\n"), chatId);
  }
}
