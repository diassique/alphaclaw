import { useState, useCallback } from "react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { Sparkline } from "../components/shared/Sparkline.tsx";
import { SERVICE_LABELS } from "../lib/constants.ts";
import type { AgentRep, ReputationResponse } from "../api/types.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const POLL_MS = 10_000;

function pct(score: number): string {
  return (score * 100).toFixed(1);
}

function pnlColor(pnl: number): string {
  return pnl >= 0 ? "var(--green)" : "var(--red)";
}

function pnlText(pnl: number): string {
  return `${pnl >= 0 ? "+" : ""}${pnl.toFixed(1)}`;
}

function label(key: string): string {
  return SERVICE_LABELS[key] ?? key;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SummaryStats({ agents }: { agents: AgentRep[] }) {
  if (agents.length === 0) return null;

  const avg = agents.reduce((s, a) => s + a.score, 0) / agents.length;
  const totalPnl = agents.reduce((s, a) => s + a.pnl, 0);
  const totalHunts = agents.reduce((s, a) => s + a.hunts, 0);
  const totalCorrect = agents.reduce((s, a) => s + a.correct, 0);

  return (
    <div className="stats" style={{ marginBottom: "2rem" }}>
      <div className="stat">
        <div className="stat-val">{(avg * 100).toFixed(0)}%</div>
        <div className="stat-label">Avg Reputation</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: pnlColor(totalPnl) }}>
          {pnlText(totalPnl)}
        </div>
        <div className="stat-label">Total P&amp;L</div>
      </div>
      <div className="stat">
        <div className="stat-val">{totalHunts}</div>
        <div className="stat-label">Total Hunts</div>
      </div>
      <div className="stat">
        <div className="stat-val">{totalCorrect}</div>
        <div className="stat-label">Correct Calls</div>
      </div>
    </div>
  );
}

function RepGrid({ agents }: { agents: AgentRep[] }) {
  if (agents.length === 0) {
    return (
      <div className="rep-grid">
        <div
          style={{
            color: "var(--text3)",
            fontSize: ".85rem",
            gridColumn: "1/-1",
            padding: "1rem",
            textAlign: "center",
          }}
        >
          No reputation data
        </div>
      </div>
    );
  }

  return (
    <div className="rep-grid">
      {agents.map((a) => {
        const score = pct(a.score);
        return (
          <div className="rep-card" key={a.key} id={`rep-${a.key}`}>
            <div className="rep-name">{label(a.key)}</div>
            <div className="rep-score">{score}%</div>
            <div className="rep-bar-outer">
              <div className="rep-bar-fill" style={{ width: `${score}%` }} />
            </div>
            <Sparkline history={a.history} />
            <div className="rep-stats">
              <span className={a.pnl >= 0 ? "rep-pnl-pos" : "rep-pnl-neg"}>
                {pnlText(a.pnl)} P&amp;L
              </span>
              <span>
                {a.correct}/{a.hunts}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Leaderboard({ agents }: { agents: AgentRep[] }) {
  const sorted = [...agents].sort((a, b) => b.score - a.score);

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>#</th>
          <th>Agent</th>
          <th>Score</th>
          <th>P&amp;L</th>
          <th>Correct</th>
          <th>Hunts</th>
        </tr>
      </thead>
      <tbody>
        {sorted.length === 0 ? (
          <tr>
            <td
              colSpan={6}
              style={{ textAlign: "center", color: "var(--text3)" }}
            >
              No data
            </td>
          </tr>
        ) : (
          sorted.map((a, i) => (
            <tr key={a.key}>
              <td
                style={{
                  color: i === 0 ? "var(--accent2)" : "var(--text3)",
                  fontWeight: 700,
                }}
              >
                {i + 1}
              </td>
              <td style={{ color: "var(--text)" }}>{label(a.key)}</td>
              <td style={{ color: "var(--accent2)" }}>{pct(a.score)}%</td>
              <td style={{ color: pnlColor(a.pnl) }}>{pnlText(a.pnl)}</td>
              <td>{a.correct}</td>
              <td>{a.hunts}</td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function ScoreHistory({ agents }: { agents: AgentRep[] }) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th>History (recent &rarr; oldest)</th>
        </tr>
      </thead>
      <tbody>
        {agents.length === 0 ? (
          <tr>
            <td
              colSpan={2}
              style={{ textAlign: "center", color: "var(--text3)" }}
            >
              No data
            </td>
          </tr>
        ) : (
          agents.map((a) => (
            <tr key={a.key}>
              <td style={{ color: "var(--text)" }}>{label(a.key)}</td>
              <td>
                {a.history.length > 0
                  ? a.history.map((v, idx) => (
                      <span
                        key={idx}
                        style={{
                          display: "inline-block",
                          padding: ".1rem .3rem",
                          margin: ".1rem",
                          borderRadius: 4,
                          fontSize: ".7rem",
                          background: "var(--bg3)",
                        }}
                      >
                        {(v * 100).toFixed(0)}%
                      </span>
                    ))
                  : "\u2014"}
              </td>
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}

function Competition({ agents }: { agents: AgentRep[] }) {
  const s1 = agents.find((a) => a.key === "sentiment");
  const s2 = agents.find((a) => a.key === "sentiment2");

  if (!s1 || !s2) {
    return (
      <div className="comp-card visible" style={{ display: "block" }}>
        <div className="comp-reason">
          Run a hunt to see competition results
        </div>
      </div>
    );
  }

  let agent1Class = "comp-agent";
  let agent2Class = "comp-agent";
  let reason = "Tied";

  if (s1.score > s2.score) {
    agent1Class = "comp-agent winner";
    agent2Class = "comp-agent loser";
    reason = `v1 leads: ${(s1.score * 100).toFixed(0)}% vs ${(s2.score * 100).toFixed(0)}%`;
  } else if (s2.score > s1.score) {
    agent1Class = "comp-agent loser";
    agent2Class = "comp-agent winner";
    reason = `v2 leads: ${(s2.score * 100).toFixed(0)}% vs ${(s1.score * 100).toFixed(0)}%`;
  }

  return (
    <div className="comp-card visible" style={{ display: "block" }}>
      <div className="comp-matchup">
        <div className={agent1Class}>
          <div className="comp-agent-name">Sentiment v1</div>
          <div className="comp-agent-ratio">
            {(s1.score * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: ".7rem", color: "var(--text3)", marginTop: ".25rem" }}>
            P&amp;L: {pnlText(s1.pnl)} &middot; {s1.correct}/{s1.hunts}
          </div>
        </div>
        <div className="comp-vs">VS</div>
        <div className={agent2Class}>
          <div className="comp-agent-name">Sentiment v2</div>
          <div className="comp-agent-ratio">
            {(s2.score * 100).toFixed(0)}%
          </div>
          <div style={{ fontSize: ".7rem", color: "var(--text3)", marginTop: ".25rem" }}>
            P&amp;L: {pnlText(s2.pnl)} &middot; {s2.correct}/{s2.hunts}
          </div>
        </div>
      </div>
      <div className="comp-reason">{reason}</div>
    </div>
  );
}

// ─── Page Component ───────────────────────────────────────────────────────────

export function ReputationPage() {
  const [resetting, setResetting] = useState(false);

  const fetcher = useCallback(
    () => api<ReputationResponse>("/reputation"),
    [],
  );

  const { data, refresh } = usePolling(fetcher, POLL_MS);

  const agents: AgentRep[] = data?.agents ?? [];

  const handleReset = useCallback(async () => {
    if (!window.confirm("Reset all agent reputations to 50%?")) return;
    setResetting(true);
    try {
      await api<unknown>("/reputation/reset", { method: "POST" });
      refresh();
    } catch {
      /* swallow */
    } finally {
      setResetting(false);
    }
  }, [refresh]);

  return (
    <>
      <PageHeader description="Reputation scores, staking results, and agent competition tracking.">
        Agent Reputation
      </PageHeader>

      {/* ── Summary Stats ────────────────────────────────────────────── */}
      <SummaryStats agents={agents} />

      {/* ── Agent Score Cards ────────────────────────────────────────── */}
      <div className="section-title">Agent Scores</div>
      <RepGrid agents={agents} />

      {/* ── Leaderboard ──────────────────────────────────────────────── */}
      <div className="section-title">Leaderboard</div>
      <div className="panel" style={{ marginBottom: "2rem", overflowX: "auto" }}>
        <Leaderboard agents={agents} />
      </div>

      {/* ── Score History ────────────────────────────────────────────── */}
      <div className="section-title">Score History</div>
      <div className="panel" style={{ marginBottom: "2rem", overflowX: "auto" }}>
        <ScoreHistory agents={agents} />
      </div>

      {/* ── Sentiment Competition ────────────────────────────────────── */}
      <div className="section-title">Sentiment Competition</div>
      <Competition agents={agents} />

      {/* ── Reset Button ─────────────────────────────────────────────── */}
      <div style={{ textAlign: "center", marginBottom: "2rem" }}>
        <button
          className="btn btn-secondary"
          style={{ borderColor: "var(--red)", color: "var(--red)" }}
          onClick={handleReset}
          disabled={resetting}
        >
          {resetting ? "Resetting..." : "Reset All Reputations"}
        </button>
      </div>
    </>
  );
}
