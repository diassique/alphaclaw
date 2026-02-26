import { useState, useCallback } from "react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { timeAgo } from "../lib/utils.ts";
import type { MemoryStats, MemoryEntry, MemoryInsight } from "../api/types.ts";

// ─── Accuracy bucket helpers ────────────────────────────────────────────────

interface AccuracyBucket {
  range: string;
  count: number;
  color: string;
}

function buildAccuracyBuckets(
  topPatterns: MemoryInsight[],
  weakPatterns: MemoryInsight[],
): AccuracyBucket[] {
  const all = [...topPatterns, ...weakPatterns];
  const counts = {
    "90-100": 0,
    "70-89": 0,
    "50-69": 0,
    "30-49": 0,
    "0-29": 0,
  };
  for (const p of all) {
    const pct = p.accuracy * 100;
    if (pct >= 90) counts["90-100"]++;
    else if (pct >= 70) counts["70-89"]++;
    else if (pct >= 50) counts["50-69"]++;
    else if (pct >= 30) counts["30-49"]++;
    else counts["0-29"]++;
  }
  const colors: Record<string, string> = {
    "90-100": "var(--green)",
    "70-89": "var(--accent2)",
    "50-69": "var(--yellow)",
    "30-49": "var(--red)",
    "0-29": "var(--red)",
  };
  return (Object.keys(counts) as Array<keyof typeof counts>).map((range) => ({
    range,
    count: counts[range],
    color: colors[range] ?? "var(--text3)",
  }));
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function PatternList({
  patterns,
  cls,
}: {
  patterns: MemoryInsight[];
  cls: "good" | "weak";
}) {
  if (!patterns.length) {
    return (
      <div style={{ color: "var(--text3)", fontSize: ".7rem" }}>
        No patterns yet
      </div>
    );
  }
  return (
    <>
      {patterns.map((p) => (
        <div key={p.combo} className="pattern-item">
          <span className="pattern-combo" title={p.combo}>
            {p.combo}
          </span>
          <span className={`pattern-acc ${cls}`}>
            {(p.accuracy * 100).toFixed(0)}%
          </span>
          <span className="pattern-adj">
            {p.adjustment > 0 ? "+" : ""}
            {p.adjustment}
          </span>
        </div>
      ))}
    </>
  );
}

function AccuracyChart({ buckets }: { buckets: AccuracyBucket[] }) {
  const max = Math.max(...buckets.map((b) => b.count), 1);
  return (
    <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
      {buckets.map((b) => (
        <div
          key={b.range}
          style={{ flex: 1, minWidth: 80, textAlign: "center" }}
        >
          <div
            style={{
              height: 60,
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "center",
              marginBottom: ".25rem",
            }}
          >
            <div
              style={{
                width: 30,
                height: `${(b.count / max) * 100}%`,
                background: b.color,
                borderRadius: "4px 4px 0 0",
                minHeight: 2,
              }}
            />
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: ".7rem",
              color: "var(--text2)",
            }}
          >
            {b.range}%
          </div>
          <div
            style={{
              fontFamily: "var(--mono)",
              fontSize: ".65rem",
              color: "var(--text3)",
            }}
          >
            {b.count}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function MemoryPage() {
  const [verifying, setVerifying] = useState<string | null>(null);

  const statsFetcher = useCallback(
    () => api<MemoryStats>("/memory/stats"),
    [],
  );
  const entriesFetcher = useCallback(
    () => api<MemoryEntry[]>("/memory/entries?limit=50"),
    [],
  );

  const {
    data: stats,
    loading: statsLoading,
    refresh: refreshStats,
  } = usePolling(statsFetcher, 10_000);
  const {
    data: rawEntries,
    loading: entriesLoading,
    refresh: refreshEntries,
  } = usePolling(entriesFetcher, 10_000);

  // The API may return an array or an object with .entries
  const entries: MemoryEntry[] = Array.isArray(rawEntries)
    ? rawEntries
    : rawEntries
      ? ((rawEntries as unknown as { entries?: MemoryEntry[] }).entries ?? [])
      : [];

  const handleVerify = async (id: string, outcome: "correct" | "incorrect") => {
    setVerifying(id);
    try {
      await api<{ ok: boolean }>("/memory/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, outcome }),
      });
      refreshStats();
      refreshEntries();
    } finally {
      setVerifying(null);
    }
  };

  const topPatterns = stats?.topPatterns ?? [];
  const weakPatterns = stats?.weakPatterns ?? [];
  const buckets = buildAccuracyBuckets(topPatterns, weakPatterns);
  const hasPatterns = topPatterns.length > 0 || weakPatterns.length > 0;

  return (
    <>
      <PageHeader description="Pattern recognition, memory entries, and prediction verification.">
        Agent <span>Memory</span>
      </PageHeader>

      {/* ── Stats + Patterns Panel ────────────────────────────────────────── */}
      <div className="memory-panel">
        <div className="memory-stats-grid">
          <div className="memory-stat">
            <div className="memory-stat-val">
              {statsLoading ? "--" : (stats?.totalEntries ?? 0)}
            </div>
            <div className="memory-stat-label">Entries</div>
          </div>
          <div className="memory-stat">
            <div className="memory-stat-val">
              {statsLoading ? "--" : (stats?.verifiedEntries ?? 0)}
            </div>
            <div className="memory-stat-label">Verified</div>
          </div>
          <div className="memory-stat">
            <div className="memory-stat-val">
              {statsLoading ? "--" : (stats?.patterns ?? 0)}
            </div>
            <div className="memory-stat-label">Patterns</div>
          </div>
          <div className="memory-stat">
            <div className="memory-stat-val">
              {statsLoading ? "--" : (stats?.activePatterns ?? 0)}
            </div>
            <div className="memory-stat-label">Active</div>
          </div>
        </div>

        <div className="memory-patterns">
          <div className="pattern-col">
            <h4>Top Patterns</h4>
            <PatternList patterns={topPatterns} cls="good" />
          </div>
          <div className="pattern-col">
            <h4>Weak Patterns</h4>
            <PatternList patterns={weakPatterns} cls="weak" />
          </div>
        </div>
      </div>

      {/* ── Accuracy Distribution ─────────────────────────────────────────── */}
      <div className="section-title">Accuracy Distribution</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        {hasPatterns ? (
          <AccuracyChart buckets={buckets} />
        ) : (
          <span style={{ color: "var(--text3)", fontSize: ".8rem" }}>
            No patterns to display
          </span>
        )}
      </div>

      {/* ── Memory Entries Table ──────────────────────────────────────────── */}
      <div className="section-title">Memory Entries</div>
      <div className="panel" style={{ marginBottom: "2rem", overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Topic</th>
              <th>Time</th>
              <th>Confidence</th>
              <th>Recommendation</th>
              <th>Verified</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {entriesLoading && entries.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--text3)" }}>
                  Loading entries...
                </td>
              </tr>
            ) : entries.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: "center", color: "var(--text3)" }}>
                  No entries yet &mdash; run a hunt to create one
                </td>
              </tr>
            ) : (
              entries.map((e) => (
                <tr key={e.id}>
                  <td style={{ fontSize: ".7rem", color: "var(--text3)" }}>
                    {(e.id ?? "").slice(0, 8)}
                  </td>
                  <td
                    style={{
                      color: "var(--text)",
                      maxWidth: 150,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.topic || "\u2014"}
                  </td>
                  <td style={{ fontSize: ".7rem" }}>
                    {e.timestamp ? timeAgo(e.timestamp) : "\u2014"}
                  </td>
                  <td style={{ color: "var(--accent2)" }}>
                    {e.confidence ?? "\u2014"}
                  </td>
                  <td
                    style={{
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {e.recommendation || "\u2014"}
                  </td>
                  <td>
                    {e.verified ? (
                      e.outcome === "correct" ? (
                        <span style={{ color: "var(--green)" }}>Correct</span>
                      ) : (
                        <span style={{ color: "var(--red)" }}>Incorrect</span>
                      )
                    ) : (
                      <span style={{ color: "var(--text3)" }}>Pending</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    {!e.verified ? (
                      <>
                        <button
                          className="btn-sm btn-green"
                          style={{ fontSize: ".65rem", padding: ".2rem .5rem" }}
                          disabled={verifying === e.id}
                          onClick={() => handleVerify(e.id, "correct")}
                        >
                          Correct
                        </button>{" "}
                        <button
                          className="btn-sm btn-red"
                          style={{ fontSize: ".65rem", padding: ".2rem .5rem" }}
                          disabled={verifying === e.id}
                          onClick={() => handleVerify(e.id, "incorrect")}
                        >
                          Wrong
                        </button>
                      </>
                    ) : (
                      "\u2014"
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
