import { useState, useCallback, type CSSProperties } from "react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { SERVICE_LABELS } from "../lib/constants.ts";
import type {
  ACPProtocolStatus,
  ACPRound,
  ACPAgentStats,
  ACPSlashEvent,
  ACPRewardEvent,
} from "../api/types.ts";

const POLL_MS = 8_000;

function label(key: string): string {
  return SERVICE_LABELS[key] ?? key;
}

function pnlColor(v: number): string {
  return v > 0 ? "var(--green)" : v < 0 ? "var(--red)" : "var(--text3)";
}

function pnlText(v: number): string {
  return `${v >= 0 ? "+" : ""}${v.toFixed(1)}`;
}

function dirColor(d: string): string {
  if (d === "bullish") return "var(--green)";
  if (d === "bearish") return "var(--red)";
  return "var(--text3)";
}

function pct(v: number): string {
  return (v * 100).toFixed(1);
}

function ago(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

// ── Stats Cards ──────────────────────────────────────────────────────────────

function ProtocolStats({ status }: { status: ACPProtocolStatus }) {
  return (
    <div className="stats" style={{ marginBottom: "2rem" }}>
      <div className="stat">
        <div className="stat-val">{status.totalRounds}</div>
        <div className="stat-label">Consensus Rounds</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--red)" }}>
          {status.totalSlashes}
        </div>
        <div className="stat-label">Slashes</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--green)" }}>
          {status.totalRewards}
        </div>
        <div className="stat-label">Rewards</div>
      </div>
      <div className="stat">
        <div className="stat-val">v{status.version}</div>
        <div className="stat-label">Protocol Version</div>
      </div>
    </div>
  );
}

// ── Leaderboard ──────────────────────────────────────────────────────────────

const thStyle: CSSProperties = {
  textAlign: "left",
  padding: ".5rem .6rem",
  fontSize: ".7rem",
  color: "var(--text3)",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: ".04em",
  borderBottom: "1px solid var(--border)",
};

const tdStyle: CSSProperties = {
  padding: ".5rem .6rem",
  fontSize: ".8rem",
  fontFamily: "var(--mono)",
  borderBottom: "1px solid var(--border)",
};

function Leaderboard({ agents }: { agents: ACPAgentStats[] }) {
  if (agents.length === 0) {
    return (
      <div className="panel" style={{ color: "var(--text3)", textAlign: "center", padding: "2rem" }}>
        No ACP data yet — run a hunt to start consensus rounds
      </div>
    );
  }

  const sorted = [...agents].sort((a, b) => b.pnl - a.pnl);

  return (
    <div className="panel" style={{ overflow: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Agent</th>
            <th style={thStyle}>Rounds</th>
            <th style={thStyle}>Agreement</th>
            <th style={thStyle}>Streak</th>
            <th style={thStyle}>Staked</th>
            <th style={thStyle}>Returned</th>
            <th style={thStyle}>P&L</th>
            <th style={thStyle}>Slashes</th>
            <th style={thStyle}>Rewards</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((a, i) => (
            <tr key={a.key} style={i === 0 ? { background: "rgba(var(--accent-rgb, 139, 92, 246), 0.06)" } : undefined}>
              <td style={tdStyle}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1}
              </td>
              <td style={{ ...tdStyle, color: "var(--accent2)", fontWeight: 600 }}>
                {label(a.key)}
              </td>
              <td style={tdStyle}>{a.rounds}</td>
              <td style={tdStyle}>{pct(a.agreementRate)}%</td>
              <td style={{ ...tdStyle, color: a.currentStreak > 0 ? "var(--green)" : a.currentStreak < 0 ? "var(--red)" : "var(--text3)" }}>
                {a.currentStreak > 0 ? `+${a.currentStreak}` : a.currentStreak}
                {a.bestStreak > 0 && (
                  <span style={{ color: "var(--text3)", fontSize: ".65rem", marginLeft: ".3rem" }}>
                    (best: {a.bestStreak})
                  </span>
                )}
              </td>
              <td style={tdStyle}>{a.totalStaked.toFixed(1)}</td>
              <td style={tdStyle}>{a.totalReturned.toFixed(1)}</td>
              <td style={{ ...tdStyle, color: pnlColor(a.pnl), fontWeight: 700 }}>
                {pnlText(a.pnl)}
              </td>
              <td style={{ ...tdStyle, color: a.slashCount > 0 ? "var(--red)" : "var(--text3)" }}>
                {a.slashCount}
              </td>
              <td style={{ ...tdStyle, color: a.rewardCount > 0 ? "var(--green)" : "var(--text3)" }}>
                {a.rewardCount}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Recent Rounds ────────────────────────────────────────────────────────────

function RoundCard({ round }: { round: ACPRound }) {
  const [expanded, setExpanded] = useState(false);
  const totalMs = round.phases.reduce((s, p) => s + p.durationMs, 0);

  return (
    <div
      className="panel"
      style={{ marginBottom: ".75rem", cursor: "pointer" }}
      onClick={() => setExpanded((e) => !e)}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: dirColor(round.consensus.direction),
            }}
          />
          <span style={{ fontWeight: 700, fontSize: ".85rem", color: "var(--text)" }}>
            {round.topic}
          </span>
          <span
            style={{
              fontSize: ".7rem",
              fontWeight: 600,
              color: dirColor(round.consensus.direction),
              textTransform: "uppercase",
            }}
          >
            {round.consensus.direction}
          </span>
          {round.consensus.unanimity && (
            <span style={{ fontSize: ".65rem", background: "var(--green)", color: "#000", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
              UNANIMOUS
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
          <span style={{ fontSize: ".7rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
            {round.consensus.quorum} agents
          </span>
          <span style={{ fontSize: ".7rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
            {totalMs}ms
          </span>
          <span style={{ fontSize: ".65rem", color: "var(--text3)" }}>
            {ago(round.timestamp)}
          </span>
          <span style={{ fontSize: ".7rem", color: "var(--text3)" }}>
            {expanded ? "▲" : "▼"}
          </span>
        </div>
      </div>

      {/* Consensus strength bar */}
      <div style={{ marginTop: ".5rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65rem", color: "var(--text3)", marginBottom: 2 }}>
          <span>Consensus Strength</span>
          <span>{pct(round.consensus.strength)}%</span>
        </div>
        <div style={{ background: "var(--bg3)", borderRadius: 4, height: 6, overflow: "hidden" }}>
          <div
            style={{
              width: `${round.consensus.strength * 100}%`,
              height: "100%",
              background: round.consensus.strength > 0.7 ? "var(--green)" : round.consensus.strength > 0.4 ? "var(--yellow, #eab308)" : "var(--red)",
              borderRadius: 4,
              transition: "width .3s",
            }}
          />
        </div>
      </div>

      {expanded && (
        <div style={{ marginTop: "1rem" }}>
          {/* Phase timing */}
          <div style={{ display: "flex", gap: ".5rem", marginBottom: ".75rem" }}>
            {round.phases.map((p) => (
              <div
                key={p.phase}
                style={{
                  background: "var(--bg3)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  padding: ".25rem .5rem",
                  fontSize: ".65rem",
                  fontFamily: "var(--mono)",
                }}
              >
                <span style={{ color: "var(--accent2)", fontWeight: 600 }}>{p.phase}</span>
                <span style={{ color: "var(--text3)", marginLeft: ".3rem" }}>{p.durationMs}ms</span>
              </div>
            ))}
          </div>

          {/* Agent votes */}
          <div style={{ fontSize: ".7rem", fontWeight: 600, color: "var(--text3)", marginBottom: ".4rem", textTransform: "uppercase", letterSpacing: ".04em" }}>
            Agent Votes
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: ".5rem" }}>
            {round.agents.map((a) => (
              <div
                key={a.key}
                style={{
                  background: "var(--bg3)",
                  border: `1px solid ${a.agreedWithConsensus ? "var(--green)" : "var(--red)"}`,
                  borderRadius: 6,
                  padding: ".4rem .6rem",
                  fontSize: ".7rem",
                  fontFamily: "var(--mono)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: ".2rem" }}>
                  <span style={{ fontWeight: 700, color: "var(--text)" }}>{label(a.key)}</span>
                  <span style={{ color: dirColor(a.direction), fontWeight: 600 }}>{a.direction}</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text3)" }}>
                  <span>conf: {(a.confidence * 100).toFixed(0)}%</span>
                  <span>stake: {a.effectiveStake.toFixed(0)}</span>
                  <span>w: {a.weight.toFixed(1)}</span>
                </div>
                {a.fromHeaders && (
                  <div style={{ fontSize: ".6rem", color: "var(--accent2)", marginTop: ".15rem" }}>via X-ACP-* headers</div>
                )}
              </div>
            ))}
          </div>

          {/* Settlement summary */}
          <div style={{ marginTop: ".75rem", fontSize: ".7rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".4rem" }}>
            Settlement
          </div>
          <div style={{ display: "flex", gap: "1rem", fontSize: ".75rem", fontFamily: "var(--mono)" }}>
            <span>Staked: {round.settlement.totalStaked.toFixed(1)}</span>
            <span>Returned: {round.settlement.totalReturned.toFixed(1)}</span>
            <span style={{ color: pnlColor(round.settlement.netPnl), fontWeight: 700 }}>
              Net: {pnlText(round.settlement.netPnl)}
            </span>
            {round.settlement.slashedAgents.length > 0 && (
              <span style={{ color: "var(--red)" }}>
                Slashed: {round.settlement.slashedAgents.map(label).join(", ")}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Event Log ────────────────────────────────────────────────────────────────

function EventLog({ slashes, rewards }: { slashes: ACPSlashEvent[]; rewards: ACPRewardEvent[] }) {
  type Event = { ts: string; type: "slash" | "reward"; agent: string; reason: string; amount: number; repDelta: number };
  const events: Event[] = [
    ...slashes.map((s) => ({ ts: s.timestamp, type: "slash" as const, agent: s.agent, reason: s.reason, amount: s.slashedAmount, repDelta: s.reputationDelta })),
    ...rewards.map((r) => ({ ts: r.timestamp, type: "reward" as const, agent: r.agent, reason: r.reason, amount: r.rewardAmount, repDelta: r.reputationDelta })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 30);

  if (events.length === 0) {
    return (
      <div className="panel" style={{ color: "var(--text3)", textAlign: "center", padding: "1.5rem", fontSize: ".85rem" }}>
        No slash/reward events yet
      </div>
    );
  }

  return (
    <div className="panel" style={{ maxHeight: 350, overflow: "auto" }}>
      {events.map((e, i) => (
        <div
          key={`${e.ts}-${i}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: ".5rem",
            padding: ".35rem 0",
            borderBottom: i < events.length - 1 ? "1px solid var(--border)" : "none",
            fontSize: ".75rem",
            fontFamily: "var(--mono)",
          }}
        >
          <span style={{ fontSize: ".9rem" }}>{e.type === "slash" ? "⚡" : "💎"}</span>
          <span style={{ color: e.type === "slash" ? "var(--red)" : "var(--green)", fontWeight: 700, minWidth: 50 }}>
            {e.type === "slash" ? `-${e.amount.toFixed(1)}` : `+${e.amount.toFixed(1)}`}
          </span>
          <span style={{ color: "var(--accent2)", fontWeight: 600, minWidth: 80 }}>
            {label(e.agent)}
          </span>
          <span style={{ color: "var(--text3)", flex: 1 }}>{e.reason}</span>
          <span style={{ color: e.repDelta >= 0 ? "var(--green)" : "var(--red)", fontSize: ".65rem" }}>
            rep: {e.repDelta >= 0 ? "+" : ""}{e.repDelta.toFixed(2)}
          </span>
          <span style={{ color: "var(--text3)", fontSize: ".65rem", minWidth: 55, textAlign: "right" }}>
            {ago(e.ts)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Weight Breakdown Chart ───────────────────────────────────────────────────

function WeightBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((s, [, v]) => s + v, 0) || 1;

  return (
    <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
      {entries.map(([dir, weight]) => (
        <div
          key={dir}
          style={{
            flex: `${weight / total}`,
            minWidth: 60,
            background: dirColor(dir),
            borderRadius: 6,
            padding: ".3rem .5rem",
            textAlign: "center",
            fontSize: ".7rem",
            fontWeight: 700,
            color: "#000",
          }}
        >
          {dir} {pct(weight / total)}%
        </div>
      ))}
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function ACPPage() {
  const statusFetcher = useCallback(() => api<ACPProtocolStatus>("/acp/status"), []);
  const { data: status, loading } = usePolling(statusFetcher, POLL_MS);

  if (loading && !status) {
    return (
      <div>
        <PageHeader description="Stake-weighted consensus with slashing and rewards">
          Alpha Consensus Protocol
        </PageHeader>
        <div style={{ color: "var(--text3)", textAlign: "center", padding: "3rem" }}>Loading ACP data...</div>
      </div>
    );
  }

  if (!status) {
    return (
      <div>
        <PageHeader description="Stake-weighted consensus with slashing and rewards">
          Alpha Consensus Protocol
        </PageHeader>
        <div style={{ color: "var(--text3)", textAlign: "center", padding: "3rem" }}>
          Failed to load ACP status
        </div>
      </div>
    );
  }

  const latestRound = status.recentRounds[0];

  return (
    <div>
      <PageHeader description="Stake-weighted consensus with slashing and rewards">
        Alpha Consensus Protocol
      </PageHeader>

      {/* Protocol stats */}
      <ProtocolStats status={status} />

      {/* Latest consensus breakdown */}
      {latestRound && (
        <div style={{ marginBottom: "2rem" }}>
          <div className="section-title">Latest Consensus</div>
          <div className="panel">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".75rem" }}>
              <div>
                <span style={{ fontWeight: 700, fontSize: ".9rem", color: "var(--text)" }}>{latestRound.topic}</span>
                <span style={{ marginLeft: ".5rem", fontSize: ".7rem", color: "var(--text3)" }}>{ago(latestRound.timestamp)}</span>
              </div>
              <span
                style={{
                  fontSize: ".8rem",
                  fontWeight: 700,
                  color: dirColor(latestRound.consensus.direction),
                  textTransform: "uppercase",
                }}
              >
                {latestRound.consensus.direction}
                {latestRound.consensus.unanimity && " (unanimous)"}
              </span>
            </div>
            <WeightBreakdown breakdown={latestRound.consensus.weightBreakdown} />
          </div>
        </div>
      )}

      {/* Leaderboard */}
      <div style={{ marginBottom: "2rem" }}>
        <div className="section-title">Agent Leaderboard</div>
        <Leaderboard agents={status.leaderboard} />
      </div>

      {/* Recent rounds */}
      <div style={{ marginBottom: "2rem" }}>
        <div className="section-title">Recent Rounds</div>
        {status.recentRounds.length === 0 ? (
          <div className="panel" style={{ color: "var(--text3)", textAlign: "center", padding: "1.5rem", fontSize: ".85rem" }}>
            No rounds yet — run a hunt to trigger the first consensus round
          </div>
        ) : (
          status.recentRounds.map((r) => <RoundCard key={r.roundId} round={r} />)
        )}
      </div>

      {/* Slash/Reward event log */}
      <div style={{ marginBottom: "2rem" }}>
        <div className="section-title">Slash & Reward Log</div>
        <EventLog slashes={status.recentSlashes} rewards={status.recentRewards} />
      </div>
    </div>
  );
}
