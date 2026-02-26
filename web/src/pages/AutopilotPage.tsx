import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "../api/client.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { formatMs } from "../lib/utils.ts";
import { DEFAULT_TOPICS } from "../lib/constants.ts";
import type { AutopilotStatus, AdaptationRecord } from "../api/types.ts";

// ─── Local types ──────────────────────────────────────────────────────────────

interface TimelineItem {
  text: string;
  time: string;
  kind: "hunting" | "result" | "adapted" | "scheduled" | "stopped" | "info";
}

interface SSEPhaseData {
  phase: string;
}

interface SSEHuntingData {
  topic: string;
}

interface SSEResultData {
  confidence: number;
  recommendation: string;
}

interface SSEAdaptedData {
  oldIntervalMs: number;
  newIntervalMs: number;
  confidence: number;
  reason: string;
}

interface SSEScheduledData {
  nextHuntAt: string;
  intervalMs: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const MAX_ITEMS = 50;

function now(): string {
  return new Date().toLocaleTimeString("en", { hour12: false });
}

// ─── Component ────────────────────────────────────────────────────────────────

export function AutopilotPage() {
  const [status, setStatus] = useState<AutopilotStatus | null>(null);
  const [timeline, setTimeline] = useState<TimelineItem[]>([]);
  const [adaptations, setAdaptations] = useState<AdaptationRecord[]>([]);
  const [toggling, setToggling] = useState(false);
  const sseRef = useRef<EventSource | null>(null);

  // ── Push helpers (cap at MAX_ITEMS) ───────────────────────────────────────

  const pushTimeline = useCallback((item: TimelineItem) => {
    setTimeline((prev) => [item, ...prev].slice(0, MAX_ITEMS));
  }, []);

  const pushAdaptation = useCallback((rec: AdaptationRecord) => {
    setAdaptations((prev) => [rec, ...prev].slice(0, MAX_ITEMS));
  }, []);

  // ── SSE connection ────────────────────────────────────────────────────────

  const connectSSE = useCallback(() => {
    if (sseRef.current) sseRef.current.close();

    const es = new EventSource("/autopilot/stream");
    sseRef.current = es;

    es.addEventListener("status", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as AutopilotStatus;
      setStatus(d);
    });

    es.addEventListener("autopilot:phase", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as SSEPhaseData;
      setStatus((prev) =>
        prev ? { ...prev, phase: d.phase } : prev,
      );
    });

    es.addEventListener("autopilot:hunting", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as SSEHuntingData;
      pushTimeline({ text: `Hunting: ${d.topic}`, time: now(), kind: "hunting" });
    });

    es.addEventListener("autopilot:result", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as SSEResultData;
      pushTimeline({
        text: `Result: ${d.confidence.toFixed(1)}% \u2014 ${d.recommendation.slice(0, 50)}`,
        time: now(),
        kind: "result",
      });
    });

    es.addEventListener("autopilot:adapted", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as SSEAdaptedData;
      const time = now();
      pushTimeline({
        text: `Adapted: ${formatMs(d.oldIntervalMs)} \u2192 ${formatMs(d.newIntervalMs)} (${d.reason})`,
        time,
        kind: "adapted",
      });
      pushAdaptation({
        timestamp: new Date().toISOString(),
        oldIntervalMs: d.oldIntervalMs,
        newIntervalMs: d.newIntervalMs,
        confidence: d.confidence,
        reason: d.reason,
      });
    });

    es.addEventListener("autopilot:scheduled", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as SSEScheduledData;
      setStatus((prev) =>
        prev
          ? { ...prev, nextHuntAt: d.nextHuntAt, currentIntervalMs: d.intervalMs }
          : prev,
      );
    });

    es.addEventListener("autopilot:stopped", () => {
      setStatus((prev) =>
        prev ? { ...prev, running: false, phase: "idle" } : prev,
      );
      pushTimeline({ text: "Autopilot stopped", time: now(), kind: "stopped" });
    });

    es.onerror = () => {
      /* silent reconnect handled by browser */
    };
  }, [pushTimeline, pushAdaptation]);

  const disconnectSSE = useCallback(() => {
    if (sseRef.current) {
      sseRef.current.close();
      sseRef.current = null;
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const d = await api<AutopilotStatus>("/autopilot/status");
        if (cancelled) return;
        setStatus(d);
        if (d.adaptations.length) {
          setAdaptations(d.adaptations.slice().reverse().slice(0, MAX_ITEMS));
        }
        if (d.running) connectSSE();
      } catch {
        /* swallow */
      }
    }

    load();
    return () => {
      cancelled = true;
      disconnectSSE();
    };
  }, [connectSSE, disconnectSSE]);

  // ── Toggle autopilot ──────────────────────────────────────────────────────

  const toggle = useCallback(async () => {
    if (!status) return;
    setToggling(true);
    try {
      if (status.running) {
        await api<unknown>("/autopilot/stop", { method: "POST" });
        disconnectSSE();
        pushTimeline({ text: "Autopilot stopped", time: now(), kind: "stopped" });
      } else {
        await api<unknown>("/autopilot/start", { method: "POST" });
        connectSSE();
        pushTimeline({ text: "Autopilot started", time: now(), kind: "info" });
      }
      const d = await api<AutopilotStatus>("/autopilot/status");
      setStatus(d);
    } catch {
      /* swallow */
    } finally {
      setToggling(false);
    }
  }, [status, connectSSE, disconnectSSE, pushTimeline]);

  // ── Derived values ────────────────────────────────────────────────────────

  const running = status?.running ?? false;
  const phase = status?.phase ?? "idle";
  const huntCount = status?.huntCount ?? 0;
  const intervalMs = status?.currentIntervalMs ?? 300_000;
  const topicIndex = status?.topicIndex ?? 0;
  const lastConfidence = status?.lastConfidence;
  const nextHuntAt = status?.nextHuntAt;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader description="Automated alpha hunting with adaptive intervals and topic rotation.">
        Autopilot Control Center
      </PageHeader>

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="autopilot-panel">
        <div className="ap-controls">
          <button
            className={running ? "btn-sm btn-red" : "btn-sm btn-green"}
            onClick={toggle}
            disabled={toggling}
          >
            {toggling ? "..." : running ? "Stop Autopilot" : "Start Autopilot"}
          </button>
          <div className="ap-status">
            <span className={`ap-phase ${phase}`}>{phase.toUpperCase()}</span>
            <span style={{ color: "var(--text3)" }}>{huntCount} hunts</span>
          </div>
        </div>

        <div className="ap-meta">
          <div className="ap-meta-item">
            <div className="ap-meta-label">Interval</div>
            <div className="ap-meta-val">{formatMs(intervalMs)}</div>
          </div>
          <div className="ap-meta-item">
            <div className="ap-meta-label">Next Hunt</div>
            <div className="ap-meta-val">
              {nextHuntAt
                ? new Date(nextHuntAt).toLocaleTimeString("en", { hour12: false })
                : "\u2014"}
            </div>
          </div>
          <div className="ap-meta-item">
            <div className="ap-meta-label">Last Confidence</div>
            <div className="ap-meta-val">
              {lastConfidence !== null && lastConfidence !== undefined
                ? `${lastConfidence.toFixed(1)}%`
                : "\u2014"}
            </div>
          </div>
          <div className="ap-meta-item">
            <div className="ap-meta-label">Topic Index</div>
            <div className="ap-meta-val">{topicIndex}</div>
          </div>
          <div className="ap-meta-item">
            <div className="ap-meta-label">Hunt Count</div>
            <div className="ap-meta-val">{huntCount}</div>
          </div>
        </div>
      </div>

      {/* ── Topic Rotation ───────────────────────────────────────────── */}
      <div className="section-title">Topic Rotation</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: ".5rem" }}>
          {DEFAULT_TOPICS.map((topic, i) => {
            const active = i === topicIndex;
            return (
              <span
                key={topic}
                className="topic-chip"
                style={
                  active
                    ? {
                        borderColor: "var(--accent)",
                        color: "var(--accent2)",
                        background: "rgba(124,58,237,.1)",
                      }
                    : undefined
                }
              >
                {active ? "\u25b6 " : ""}
                {topic}
              </span>
            );
          })}
        </div>
      </div>

      {/* ── Live Timeline ────────────────────────────────────────────── */}
      <div className="section-title">Live Timeline</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div className="ap-timeline" style={{ maxHeight: 500 }}>
          {timeline.length === 0 ? (
            <div
              style={{
                color: "var(--text3)",
                fontSize: ".8rem",
                textAlign: "center",
                padding: "1rem",
              }}
            >
              Start autopilot to see live events
            </div>
          ) : (
            timeline.map((item, i) => (
              <div className="ap-timeline-item" key={`${item.time}-${i}`}>
                <span>{item.text}</span>
                <span style={{ color: "var(--text3)" }}>{item.time}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Adaptation History ───────────────────────────────────────── */}
      <div className="section-title">Adaptation History</div>
      <div className="panel" style={{ marginBottom: "2rem", overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Old Interval</th>
              <th>New Interval</th>
              <th>Confidence</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {adaptations.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ textAlign: "center", color: "var(--text3)" }}
                >
                  No adaptations yet
                </td>
              </tr>
            ) : (
              adaptations.map((a, i) => (
                <tr key={`${a.timestamp}-${i}`}>
                  <td>
                    {new Date(a.timestamp).toLocaleTimeString("en", {
                      hour12: false,
                    })}
                  </td>
                  <td>{formatMs(a.oldIntervalMs)}</td>
                  <td style={{ color: "var(--accent2)" }}>
                    {formatMs(a.newIntervalMs)}
                  </td>
                  <td>
                    {a.confidence !== null && a.confidence !== undefined
                      ? `${a.confidence.toFixed(1)}%`
                      : "\u2014"}
                  </td>
                  <td>{a.reason}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
