import { useState, useCallback } from "react";
import { Link } from "react-router";
import { api, apiRaw } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { Modal } from "../components/shared/Modal.tsx";
import { timeAgo, shortHash } from "../lib/utils.ts";
import type {
  ReportsResponse,
  ReportSummary,
  ReportDetail,
} from "../api/types.ts";

// ─── Modal states ────────────────────────────────────────────────────────────

interface ModalLoading {
  kind: "loading";
}

interface ModalLocked {
  kind: "locked";
  id: string;
}

interface ModalError {
  kind: "error";
  message: string;
}

interface ModalLoaded {
  kind: "loaded";
  report: ReportDetail;
}

type ModalState = ModalLoading | ModalLocked | ModalError | ModalLoaded;

// ─── Component ───────────────────────────────────────────────────────────────

export function ReportsPage() {
  const [filter, setFilter] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [modalState, setModalState] = useState<ModalState>({ kind: "loading" });
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const fetchReports = useCallback(
    () => api<ReportsResponse>("/reports"),
    [],
  );

  const { data, loading } = usePolling(fetchReports, 15_000);

  const reports = data?.reports ?? [];
  const count = data?.count ?? 0;

  const filtered = filter
    ? reports.filter(
        (r) =>
          r.topic.toLowerCase().includes(filter.toLowerCase()) ||
          r.preview.toLowerCase().includes(filter.toLowerCase()),
      )
    : reports;

  // ── Open a report ────────────────────────────────────────────────────────

  const openReport = async (id: string) => {
    setModalOpen(true);
    setModalState({ kind: "loading" });
    setCopyFeedback(null);

    try {
      const res = await apiRaw(`/report/${id}`);

      if (res.status === 402) {
        setModalState({ kind: "locked", id });
        return;
      }

      if (!res.ok) {
        setModalState({ kind: "error", message: `${res.status} ${res.statusText}` });
        return;
      }

      const report = (await res.json()) as ReportDetail;
      setModalState({ kind: "loaded", report });
    } catch (e) {
      setModalState({
        kind: "error",
        message: e instanceof Error ? e.message : "Failed to load report",
      });
    }
  };

  // ── Copy helpers ─────────────────────────────────────────────────────────

  const copyEndpoint = (id: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/report/${id}`);
    setCopyFeedback("Endpoint copied!");
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const copyJSON = async (id: string) => {
    try {
      const res = await apiRaw(`/report/${id}`);
      const json: unknown = await res.json();
      await navigator.clipboard.writeText(JSON.stringify(json, null, 2));
      setCopyFeedback("Report JSON copied to clipboard");
    } catch {
      setCopyFeedback("Failed to copy");
    }
    setTimeout(() => setCopyFeedback(null), 2000);
  };

  const closeModal = () => {
    setModalOpen(false);
    setCopyFeedback(null);
  };

  // ── Derive modal title ──────────────────────────────────────────────────

  const modalTitle = (() => {
    switch (modalState.kind) {
      case "loading":
        return "Loading...";
      case "locked":
        return "Locked Report";
      case "error":
        return "Error";
      case "loaded":
        return modalState.report.topic || "Report";
    }
  })();

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader
        description={`${count} cached reports available`}
        right={
          <Link className="btn btn-primary" to="/hunt">
            Run a Hunt &rarr;
          </Link>
        }
      >
        <span>Reports</span> Archive
      </PageHeader>

      {/* Filter */}
      <div style={{ marginBottom: "1.5rem" }}>
        <input
          className="hunt-input"
          type="text"
          placeholder="Filter by topic..."
          style={{ maxWidth: 400 }}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      {/* Reports Grid */}
      <div className="reports-grid">
        {loading && reports.length === 0 && (
          <div
            style={{
              color: "var(--text3)",
              fontSize: ".85rem",
              gridColumn: "1 / -1",
              padding: "2rem",
              textAlign: "center",
            }}
          >
            Loading reports...
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div
            style={{
              color: "var(--text3)",
              fontSize: ".85rem",
              gridColumn: "1 / -1",
              padding: "2rem",
              textAlign: "center",
            }}
          >
            No reports found
          </div>
        )}

        {filtered.map((rep) => (
          <ReportCard key={rep.id} report={rep} onClick={() => openReport(rep.id)} />
        ))}
      </div>

      {/* Modal */}
      <Modal open={modalOpen} onClose={closeModal} title={modalTitle}>
        <ReportModalBody
          state={modalState}
          copyFeedback={copyFeedback}
          onCopyEndpoint={copyEndpoint}
          onCopyJSON={copyJSON}
        />
      </Modal>
    </>
  );
}

// ─── Report Card ──────────────────────────────────────────────────────────────

function ReportCard({
  report,
  onClick,
}: {
  report: ReportSummary;
  onClick: () => void;
}) {
  return (
    <div className="report-card" onClick={onClick} role="button" tabIndex={0}>
      <div className="report-meta">
        <span className="report-id">#{report.id}</span>
        <span className="report-price">{report.price}</span>
      </div>
      <div className="report-topic">{report.topic}</div>
      <div className="report-preview">{report.preview}</div>
      <div className="report-footer">
        <span className="report-time">{timeAgo(report.timestamp)}</span>
        <span className="badge badge-purple" style={{ fontSize: ".68rem" }}>
          Buy via x402
        </span>
      </div>
    </div>
  );
}

// ─── Modal Body ───────────────────────────────────────────────────────────────

function ReportModalBody({
  state,
  copyFeedback,
  onCopyEndpoint,
  onCopyJSON,
}: {
  state: ModalState;
  copyFeedback: string | null;
  onCopyEndpoint: (id: string) => void;
  onCopyJSON: (id: string) => void;
}) {
  if (state.kind === "loading") {
    return (
      <div style={{ color: "var(--text3)", padding: "2rem", textAlign: "center" }}>
        Loading...
      </div>
    );
  }

  if (state.kind === "error") {
    return (
      <div style={{ color: "var(--red)", padding: "1rem", textAlign: "center" }}>
        {state.message}
      </div>
    );
  }

  if (state.kind === "locked") {
    return (
      <div style={{ textAlign: "center", padding: "1rem" }}>
        <p style={{ color: "var(--text2)", marginBottom: "1rem" }}>
          This report requires <strong>$0.01 USDC</strong> via x402.
        </p>
        <button
          className="btn btn-primary"
          onClick={() => onCopyEndpoint(state.id)}
        >
          Copy x402 Endpoint
        </button>
        {copyFeedback && (
          <div style={{ fontSize: ".75rem", marginTop: ".5rem", color: "var(--green)" }}>
            {copyFeedback}
          </div>
        )}
      </div>
    );
  }

  // kind === "loaded"
  const { report } = state;
  const alpha = report.alpha;
  const breakdown = alpha.breakdown;

  return (
    <>
      {/* Synthesis */}
      <div className="report-detail-section">
        <div className="report-detail-label">Synthesis</div>
        <div style={{ fontSize: "1rem", fontWeight: 600, marginBottom: ".5rem" }}>
          {alpha.recommendation || "\u2014"}
        </div>
        <div style={{ fontSize: ".85rem", color: "var(--text2)" }}>
          Confidence:{" "}
          <strong style={{ color: "var(--accent2)" }}>
            {alpha.confidence || "\u2014"}
          </strong>
          {alpha.weightedConfidence != null && (
            <> (weighted: {alpha.weightedConfidence.toFixed(1)}%)</>
          )}
        </div>
      </div>

      {/* Signals */}
      <div className="report-detail-section">
        <div className="report-detail-label">Signals</div>
        <div className="alpha-signals">
          {alpha.signals.length > 0 ? (
            alpha.signals.map((s, i) => (
              <span key={i} className="signal-tag">
                {s}
              </span>
            ))
          ) : (
            <span style={{ color: "var(--text3)" }}>No signals</span>
          )}
        </div>
      </div>

      {/* Claude Narrative */}
      {alpha.narrative && (
        <div className="report-detail-section">
          <div className="report-detail-label">AI Analysis (Claude)</div>
          <div style={{ fontSize: ".85rem", color: "var(--text)", lineHeight: 1.6 }}>
            {alpha.narrative.summary}
          </div>
          {alpha.narrative.keyInsight && (
            <div style={{ marginTop: ".4rem", fontSize: ".8rem", color: "var(--text2)", fontStyle: "italic" }}>
              Key insight: {alpha.narrative.keyInsight}
            </div>
          )}
        </div>
      )}

      {/* News */}
      {breakdown.news && (
        <div className="report-detail-section">
          <div className="report-detail-label">News</div>
          <div className="breakdown-item">
            <span className="breakdown-key">Headline</span>
            <span className="breakdown-val">{breakdown.news.topHeadline}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Articles</span>
            <span className="breakdown-val">{breakdown.news.articleCount}</span>
          </div>
        </div>
      )}

      {/* Sentiment */}
      {breakdown.sentiment && (
        <div className="report-detail-section">
          <div className="report-detail-label">Sentiment</div>
          <div className="breakdown-item">
            <span className="breakdown-key">Label</span>
            <span className="breakdown-val">{breakdown.sentiment.label}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Score</span>
            <span className="breakdown-val">{breakdown.sentiment.score}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Confidence</span>
            <span className="breakdown-val">{breakdown.sentiment.confidence}</span>
          </div>
        </div>
      )}

      {/* Polymarket */}
      {breakdown.polymarket && (
        <div className="report-detail-section">
          <div className="report-detail-label">Polymarket</div>
          <div className="breakdown-item">
            <span className="breakdown-key">Market</span>
            <span className="breakdown-val">{breakdown.polymarket.market}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Signal</span>
            <span className="breakdown-val">{breakdown.polymarket.signal}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">YES price</span>
            <span className="breakdown-val">{breakdown.polymarket.yesPrice}</span>
          </div>
        </div>
      )}

      {/* DeFi */}
      {breakdown.defi && (
        <div className="report-detail-section">
          <div className="report-detail-label">DeFi</div>
          <div className="breakdown-item">
            <span className="breakdown-key">Asset</span>
            <span className="breakdown-val">{breakdown.defi.asset}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Action</span>
            <span className="breakdown-val">{breakdown.defi.action}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">24h change</span>
            <span className="breakdown-val">{breakdown.defi.change24h}</span>
          </div>
        </div>
      )}

      {/* Whale */}
      {breakdown.whale && (
        <div className="report-detail-section">
          <div className="report-detail-label">Whale Activity</div>
          <div className="breakdown-item">
            <span className="breakdown-key">Signal</span>
            <span className="breakdown-val">{breakdown.whale.signal}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Whale count</span>
            <span className="breakdown-val">{breakdown.whale.whaleCount}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Volume</span>
            <span className="breakdown-val">{breakdown.whale.totalVolume}</span>
          </div>
        </div>
      )}

      {/* Staking Results */}
      {report.stakingSummary && (
        <div className="report-detail-section">
          <div className="report-detail-label">Staking Results</div>
          <div className="breakdown-item">
            <span className="breakdown-key">Consensus</span>
            <span className="breakdown-val">
              {report.stakingSummary.consensus.toUpperCase()}
            </span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Total Staked</span>
            <span className="breakdown-val">{report.stakingSummary.totalStaked}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Total Returned</span>
            <span
              className="breakdown-val"
              style={{
                color:
                  report.stakingSummary.totalReturned >= report.stakingSummary.totalStaked
                    ? "var(--green)"
                    : "var(--red)",
              }}
            >
              {report.stakingSummary.totalReturned}
            </span>
          </div>
          {report.stakingSummary.results.map((r) => (
            <div key={r.service} className="breakdown-item">
              <span className="breakdown-key">{r.service}</span>
              <span
                className="breakdown-val"
                style={{ color: r.correct ? "var(--green)" : "var(--red)" }}
              >
                {r.correct ? "OK" : "MISS"} {r.direction} &middot; {r.staked}&rarr;
                {r.returned}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Agent Payments */}
      <div className="report-detail-section">
        <div className="report-detail-label">Agent Payments</div>
        {(report.agentPayments?.breakdown ?? []).map((p) => (
          <div key={p.service} className="breakdown-item">
            <span className="breakdown-key">{p.service}</span>
            <span
              className="breakdown-val"
              style={{ color: p.paid ? "var(--green)" : "var(--text3)" }}
            >
              {p.paid ? "Paid" : "Demo"} {p.price}
              {p.txHash ? ` \u00b7 ${shortHash(p.txHash)}` : ""}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          paddingTop: ".75rem",
          borderTop: "1px solid var(--border)",
          marginTop: "1rem",
        }}
      >
        <span
          style={{
            fontSize: ".72rem",
            color: "var(--text3)",
            fontFamily: "var(--mono)",
          }}
        >
          Report: {report.reportId} &middot; {report.timestamp}
        </span>
        <button
          className="btn-sm btn-secondary"
          onClick={() => onCopyJSON(report.reportId)}
        >
          Copy JSON
        </button>
      </div>
      {copyFeedback && (
        <div
          style={{
            fontSize: ".75rem",
            marginTop: ".5rem",
            color: "var(--green)",
            textAlign: "right",
          }}
        >
          {copyFeedback}
        </div>
      )}
    </>
  );
}
