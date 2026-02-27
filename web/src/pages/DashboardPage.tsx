import { useState, useEffect, useCallback } from "react";
import { Link } from "react-router";
import { Zap, Search, LayoutGrid, Bot, FileText, Server, SearchSlash } from "lucide-react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { useHuntStream } from "../hooks/useHuntStream.ts";
import { useStatus } from "../context/StatusContext.tsx";
import { HuntBox } from "../components/shared/HuntBox.tsx";
import { StreamLog } from "../components/shared/StreamLog.tsx";
import { timeAgo, formatMs, latencyClass } from "../lib/utils.ts";
import type {
  PingResponse,
  ReportsResponse,
  ReportSummary,
  ReputationResponse,
  AutopilotStatus,
  ServiceHealth,
} from "../api/types.ts";

// ─── Sub-components ──────────────────────────────────────────────────────────

function Hero() {
  return (
    <div className="hero">
      <div className="hero-label">
        <Zap size={14} />
        SURGE x OpenClaw Hackathon 2026
      </div>
      <h1>
        The <span>Alpha Network</span>
        <br />
        for AI Agents
      </h1>
      <p>
        5 autonomous agents buy and sell intelligence via x402 micropayments.
        One query. Five data sources. Real on-chain transactions.
      </p>
      <div className="hero-actions">
        <Link className="btn btn-primary" to="/hunt">
          <Search size={16} />
          Hunt Alpha
        </Link>
        <Link className="btn btn-secondary" to="/network">
          <LayoutGrid size={16} />
          Network Status
        </Link>
      </div>
    </div>
  );
}

interface StatsBarProps {
  ping: PingResponse | null;
  reports: ReportsResponse | null;
  reputation: ReputationResponse | null;
  health: { onlineCount: number } | null;
}

function StatsBar({ ping, reports, reputation, health }: StatsBarProps) {
  const agentCount = ping?.dynamicPricing
    ? ping.dynamicPricing.length + 1
    : health?.onlineCount ?? "\u2014";

  const avgRep =
    reputation?.agents && reputation.agents.length > 0
      ? (
          (reputation.agents.reduce((s, a) => s + a.score, 0) /
            reputation.agents.length) *
          100
        ).toFixed(0) + "%"
      : "\u2014";

  const totalPnl =
    reputation?.agents && reputation.agents.length > 0
      ? reputation.agents.reduce((s, a) => s + a.pnl, 0)
      : null;

  const pnlText =
    totalPnl !== null ? (totalPnl >= 0 ? "+" : "") + totalPnl.toFixed(1) : "\u2014";
  const pnlColor =
    totalPnl !== null
      ? totalPnl >= 0
        ? "var(--green)"
        : "var(--red)"
      : "var(--text2)";

  return (
    <div className="stats">
      <div className="stat">
        <div className="stat-val">{agentCount}</div>
        <div className="stat-label">Active Agents</div>
      </div>
      <div className="stat">
        <div className="stat-val">{reports?.count ?? "\u2014"}</div>
        <div className="stat-label">Cached Reports</div>
      </div>
      <div className="stat">
        <div className="stat-val">{ping?.totalBuyCost ?? "$0.039"}</div>
        <div className="stat-label">Buy Cost</div>
      </div>
      <div className="stat">
        <div className="stat-val">$0.050</div>
        <div className="stat-label">Sell Price</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--green)" }}>
          {ping?.margin ? ping.margin.replace(" per hunt", "") : "$0.011"}
        </div>
        <div className="stat-label">Margin / Hunt</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: "var(--accent2)" }}>
          {avgRep}
        </div>
        <div className="stat-label">Avg Reputation</div>
      </div>
      <div className="stat">
        <div className="stat-val" style={{ color: pnlColor }}>
          {pnlText}
        </div>
        <div className="stat-label">Economy P&amp;L</div>
      </div>
    </div>
  );
}

function AutopilotCompact({ status }: { status: AutopilotStatus | null }) {
  const phase = status?.phase ?? "idle";
  const huntCount = status?.huntCount ?? 0;
  const nextTime = status?.nextHuntAt
    ? new Date(status.nextHuntAt).toLocaleTimeString("en", { hour12: false })
    : "\u2014";
  const interval = status ? formatMs(status.currentIntervalMs) : "5m 0s";

  return (
    <>
      <div className="section-title">
        <span className="sec-icon">
          <Bot size={18} stroke="var(--accent2)" />
        </span>
        Autopilot
        <Link to="/autopilot" style={{ fontSize: ".75rem", color: "var(--accent2)", textDecoration: "none", marginLeft: ".5rem" }}>
          View full &rarr;
        </Link>
      </div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <span className={`ap-phase ${phase}`}>{phase.toUpperCase()}</span>
          <span style={{ fontFamily: "var(--mono)", fontSize: ".8rem", color: "var(--text2)" }}>
            {huntCount} hunts
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: ".8rem", color: "var(--text3)" }}>
            Next: {nextTime}
          </span>
          <span style={{ fontFamily: "var(--mono)", fontSize: ".8rem", color: "var(--text3)" }}>
            Interval: {interval}
          </span>
        </div>
      </div>
    </>
  );
}

function RecentReports({ reports }: { reports: ReportSummary[] }) {
  return (
    <>
      <div className="section-title">
        <span className="sec-icon">
          <FileText size={18} stroke="var(--accent2)" />
        </span>
        Recent Reports
        <Link to="/reports" style={{ fontSize: ".75rem", color: "var(--accent2)", textDecoration: "none", marginLeft: ".5rem" }}>
          View all &rarr;
        </Link>
      </div>
      <div style={{ marginBottom: "2rem" }}>
        {reports.length === 0 ? (
          <div style={{ color: "var(--text3)", fontSize: ".85rem", padding: "1rem", textAlign: "center" }}>
            No reports yet &mdash; run a hunt to generate one
          </div>
        ) : (
          reports.slice(0, 5).map((rep) => (
            <Link
              key={rep.id}
              to="/reports"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: ".6rem .75rem",
                borderBottom: "1px solid var(--border)",
                fontSize: ".82rem",
                cursor: "pointer",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ color: "var(--text)", fontWeight: 500 }}>{rep.topic}</span>
              <span style={{ display: "flex", alignItems: "center", gap: ".75rem" }}>
                <span style={{ fontFamily: "var(--mono)", fontSize: ".7rem", color: "var(--text3)" }}>
                  {timeAgo(rep.timestamp)}
                </span>
                <span className="report-price">{rep.price}</span>
              </span>
            </Link>
          ))
        )}
      </div>
    </>
  );
}

function ServicesGrid({ services }: { services: ServiceHealth[] }) {
  return (
    <>
      <div className="section-title">
        <span className="sec-icon">
          <Server size={18} stroke="var(--accent3)" />
        </span>
        Service Health
        <Link to="/network" style={{ fontSize: ".75rem", color: "var(--accent2)", textDecoration: "none", marginLeft: ".5rem" }}>
          Details &rarr;
        </Link>
      </div>
      <div className="services-grid" style={{ marginBottom: "2rem" }}>
        {services.map((s) => {
          const statusCls = s.status === "ok" ? "ok" : s.status === "error" ? "err" : "off";
          const latCls = latencyClass(s.latencyMs);
          return (
            <div className="service-card" key={s.name}>
              <div className={`service-status status-${statusCls}`} />
              <div className="service-info">
                <div className="service-name">{s.name.replace("alphaclaw-", "")}</div>
                <div className="service-details">
                  <span className="service-price">{s.price || "coordinator"}</span>
                  <span className={`service-latency ${latCls}`}>{s.latencyMs}ms</span>
                  <span className="service-port">:{s.port}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function DashboardPage() {
  const health = useStatus();

  const reportsFetcher = useCallback(() => api<ReportsResponse>("/reports"), []);
  const reputationFetcher = useCallback(() => api<ReputationResponse>("/reputation"), []);
  const autopilotFetcher = useCallback(() => api<AutopilotStatus>("/autopilot/status"), []);
  const pingFetcher = useCallback(() => api<PingResponse>("/ping"), []);

  const { data: reports } = usePolling(reportsFetcher, 10_000);
  const { data: reputation } = usePolling(reputationFetcher, 10_000);
  const { data: autopilot } = usePolling(autopilotFetcher, 10_000);
  const { data: ping } = usePolling(pingFetcher, 10_000);

  const { hunting, logs, alpha, startHunt } = useHuntStream();
  const [showStream, setShowStream] = useState(false);

  useEffect(() => {
    if (hunting || logs.length > 0) setShowStream(true);
  }, [hunting, logs.length]);

  const handleHunt = useCallback(
    (topic: string) => {
      setShowStream(true);
      startHunt(topic);
    },
    [startHunt],
  );

  // Reload reports shortly after a hunt finishes (report gets cached)
  const [prevHunting, setPrevHunting] = useState(false);
  useEffect(() => {
    if (prevHunting && !hunting) {
      const t = setTimeout(() => reportsFetcher().catch(() => {}), 500);
      return () => clearTimeout(t);
    }
    setPrevHunting(hunting);
  }, [hunting, prevHunting, reportsFetcher]);

  return (
    <>
      <Hero />

      <StatsBar ping={ping} reports={reports} reputation={reputation} health={health} />

      {/* Quick Hunt */}
      <div className="section-title">
        <span className="sec-icon">
          <SearchSlash size={18} stroke="var(--accent2)" />
        </span>
        Quick Hunt
      </div>

      <HuntBox
        onHunt={handleHunt}
        hunting={hunting}
        topics={["Trump impeachment", "Fed rate cut March", "Bitcoin ETF approval", "Ethereum DeFi", "Base L2 yields"]}
      />

      {showStream && (
        <div style={{ marginTop: "1rem" }}>
          <StreamLog logs={logs} maxHeight="200px" />
          {alpha && (
            <div className="alpha-result" style={{ display: "block" }}>
              <div className="alpha-header">
                <div className="alpha-rec">{alpha.recommendation}</div>
                <div className="alpha-conf">Confidence: {alpha.confidence}</div>
              </div>
              <div className="alpha-signals">
                {alpha.signals.map((s) => (
                  <span key={s} className="signal-tag">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <AutopilotCompact status={autopilot} />

      <RecentReports reports={reports?.reports ?? []} />

      <ServicesGrid services={health?.services ?? []} />
    </>
  );
}
