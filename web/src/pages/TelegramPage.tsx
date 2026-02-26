import { useState, useCallback } from "react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import type { TelegramStatus } from "../api/types.ts";

// ─── Bot command definitions ──────────────────────────────────────────────────

interface BotCommand {
  command: string;
  description: string;
  example: string;
}

const BOT_COMMANDS: BotCommand[] = [
  {
    command: "/hunt <topic>",
    description: "Run a full alpha hunt on the given topic",
    example: "/hunt Bitcoin ETF approval",
  },
  {
    command: "/status",
    description: "Show network status, wallet, circuits, and autopilot state",
    example: "/status",
  },
  {
    command: "/reputation",
    description: "Show all agent reputation scores and P&L",
    example: "/reputation",
  },
  {
    command: "/autopilot",
    description: "Toggle autopilot on/off",
    example: "/autopilot",
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

export function TelegramPage() {
  const [threshold, setThreshold] = useState(70);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{
    text: string;
    kind: "success" | "error";
  } | null>(null);

  const fetchStatus = useCallback(
    () => api<TelegramStatus>("/telegram/status"),
    [],
  );

  const { data: status } = usePolling(fetchStatus, 30_000);

  // Sync threshold from server when status loads (only on first load)
  const [synced, setSynced] = useState(false);
  if (status && !synced) {
    const serverThreshold = status.alertThreshold ?? 70;
    setThreshold(serverThreshold);
    setSynced(true);
  }

  const isEnabled = status?.enabled ?? false;

  // ── Save threshold ──────────────────────────────────────────────────────

  const saveThreshold = async () => {
    setSaving(true);
    setSaveMessage(null);

    try {
      const res = await fetch("/telegram/threshold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threshold }),
      });

      if (res.ok) {
        setSaveMessage({ text: `Threshold saved: ${threshold}%`, kind: "success" });
      } else {
        setSaveMessage({ text: "Failed to save", kind: "error" });
      }
    } catch {
      setSaveMessage({ text: "Error saving threshold", kind: "error" });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader description="Bot status, alert threshold configuration, and command reference.">
        <span>Telegram</span> Bot
      </PageHeader>

      {/* Bot Status */}
      <div className="section-title">Bot Status</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <div
              className={isEnabled ? "status-indicator ok" : "status-indicator"}
              style={{
                width: 10,
                height: 10,
                background: isEnabled ? undefined : "var(--text3)",
              }}
            />
            <span
              style={{
                fontWeight: 700,
                fontFamily: "var(--mono)",
                fontSize: ".9rem",
                color: isEnabled ? "var(--green)" : "var(--text3)",
              }}
            >
              {status ? (isEnabled ? "CONNECTED" : "NOT CONFIGURED") : "Checking..."}
            </span>
          </div>
          {isEnabled && status?.chatId && (
            <span
              style={{
                fontFamily: "var(--mono)",
                fontSize: ".8rem",
                color: "var(--text3)",
              }}
            >
              Chat ID: {status.chatId}
            </span>
          )}
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: ".8rem",
              color: "var(--text3)",
            }}
          >
            Threshold: {threshold}%
          </span>
        </div>
      </div>

      {/* Alert Threshold */}
      <div className="section-title">Alert Threshold</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <p
          style={{
            fontSize: ".85rem",
            color: "var(--text2)",
            marginBottom: "1rem",
          }}
        >
          Only send Telegram alerts when hunt confidence exceeds this threshold.
        </p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "1rem",
            flexWrap: "wrap",
          }}
        >
          <input
            type="range"
            min={0}
            max={100}
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            style={{ flex: 1, minWidth: 200, accentColor: "var(--accent)" }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <input
              type="number"
              min={0}
              max={100}
              value={threshold}
              onChange={(e) => {
                const val = Math.min(100, Math.max(0, Number(e.target.value)));
                setThreshold(val);
              }}
              style={{
                width: 60,
                background: "var(--bg3)",
                border: "1px solid var(--border2)",
                borderRadius: 6,
                padding: ".4rem .5rem",
                color: "var(--text)",
                fontFamily: "var(--mono)",
                fontSize: ".85rem",
                textAlign: "center",
              }}
            />
            <span style={{ color: "var(--text3)", fontSize: ".85rem" }}>%</span>
          </div>
          <button
            className="btn-sm btn-green"
            onClick={saveThreshold}
            disabled={saving}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
        {saveMessage && (
          <div
            style={{
              fontSize: ".75rem",
              marginTop: ".5rem",
              color:
                saveMessage.kind === "success" ? "var(--green)" : "var(--red)",
            }}
          >
            {saveMessage.text}
          </div>
        )}
      </div>

      {/* Bot Commands */}
      <div className="section-title">Bot Commands</div>
      <div className="panel" style={{ marginBottom: "2rem", overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Command</th>
              <th>Description</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            {BOT_COMMANDS.map((cmd) => (
              <tr key={cmd.command}>
                <td style={{ color: "var(--accent2)" }}>{cmd.command}</td>
                <td>{cmd.description}</td>
                <td style={{ color: "var(--text3)" }}>{cmd.example}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Webhook Setup */}
      <div className="section-title">Webhook Setup</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div
          style={{
            fontSize: ".85rem",
            color: "var(--text2)",
            lineHeight: 1.8,
          }}
        >
          <p style={{ marginBottom: ".75rem" }}>
            To connect your Telegram bot to AlphaClaw:
          </p>
          <ol style={{ paddingLeft: "1.5rem", color: "var(--text2)" }}>
            <li>
              Create a bot via{" "}
              <span style={{ color: "var(--accent2)" }}>@BotFather</span> on
              Telegram
            </li>
            <li>
              Set environment variables:
              <div
                style={{
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: ".75rem",
                  margin: ".5rem 0",
                  fontFamily: "var(--mono)",
                  fontSize: ".75rem",
                  color: "var(--text)",
                }}
              >
                TELEGRAM_BOT_TOKEN=your_bot_token
                <br />
                TELEGRAM_CHAT_ID=your_chat_id
              </div>
            </li>
            <li>
              Set the webhook URL:
              <div
                style={{
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  padding: ".75rem",
                  margin: ".5rem 0",
                  fontFamily: "var(--mono)",
                  fontSize: ".75rem",
                  color: "var(--text)",
                }}
              >
                {"curl -X POST \"https://api.telegram.org/bot{TOKEN}/setWebhook\" \\"}
                <br />
                {'  -d "url=https://your-server:5000/telegram/webhook"'}
              </div>
            </li>
            <li>
              Restart the coordinator. The TG badge in the nav will show{" "}
              <span
                className="tg-badge tg-on"
                style={{ display: "inline-flex" }}
              >
                TG ON
              </span>{" "}
              when connected.
            </li>
          </ol>
        </div>
      </div>

      {/* Alert Preview */}
      <div className="section-title">Alert Preview</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <p
          style={{
            fontSize: ".8rem",
            color: "var(--text3)",
            marginBottom: ".75rem",
          }}
        >
          When confidence exceeds the threshold, alerts look like this:
        </p>
        <div
          style={{
            background: "var(--bg3)",
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "1rem",
            fontFamily: "var(--mono)",
            fontSize: ".78rem",
            lineHeight: 1.6,
            color: "var(--text)",
          }}
        >
          <div
            style={{
              color: "var(--accent2)",
              fontWeight: 700,
              marginBottom: ".5rem",
            }}
          >
            AlphaClaw Alert
          </div>
          <div>
            Topic: <span style={{ color: "var(--text)" }}>Bitcoin ETF approval</span>
          </div>
          <div>
            Recommendation:{" "}
            <span style={{ color: "var(--green)" }}>STRONGLY BULLISH</span>
          </div>
          <div>
            Confidence:{" "}
            <span style={{ color: "var(--accent2)" }}>HIGH (82.5%)</span>
          </div>
          <div style={{ marginTop: ".5rem" }}>Signals:</div>
          <div style={{ color: "var(--text2)", paddingLeft: ".5rem" }}>
            &bull; strongly_bullish sentiment (0.85)
            <br />
            &bull; HIGH_ALPHA polymarket (YES: $0.78)
            <br />
            &bull; ACCUMULATION defi momentum
            <br />
            &bull; whale accumulation detected
          </div>
          <div
            style={{
              marginTop: ".5rem",
              color: "var(--text3)",
              fontSize: ".7rem",
            }}
          >
            Report: abc123def &middot; $0.01 via x402
          </div>
        </div>
      </div>
    </>
  );
}
