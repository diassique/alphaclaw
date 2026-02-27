import { useState, useCallback } from "react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import type { MoltbookStatus, MoltbookHistoryResponse, MoltbookPostRecord } from "../api/types.ts";

// ─── Helpers ────────────────────────────────────────────────────────────────

function timeAgo(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function confidenceColor(conf: string): string {
  const num = parseInt(conf);
  if (num >= 70) return "var(--green)";
  if (num >= 50) return "var(--accent2)";
  if (num >= 30) return "var(--yellow)";
  return "var(--text3)";
}

function moltbookPostUrl(submolt: string, postId: string): string {
  return `https://www.moltbook.com/m/${submolt}/post/${postId}`;
}

// ─── Post Card ──────────────────────────────────────────────────────────────

function PostCard({ post, submolt }: { post: MoltbookPostRecord; submolt: string }) {
  return (
    <a
      href={moltbookPostUrl(submolt, post.postId)}
      target="_blank"
      rel="noopener noreferrer"
      className="moltbook-card"
      title="Open on Moltbook"
    >
      <div className="moltbook-card-header">
        <span className="moltbook-card-topic">{post.topic}</span>
        <span className="moltbook-card-time">{timeAgo(post.timestamp)}</span>
      </div>
      <div className="moltbook-card-body">
        <span
          className="moltbook-card-confidence"
          style={{ color: confidenceColor(post.confidence) }}
        >
          {post.confidence}
        </span>
        <span className="moltbook-card-id">#{post.postId.slice(0, 8)}</span>
      </div>
      <div className="moltbook-card-footer">
        <span className="moltbook-card-submolt">m/{submolt}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.4 }}>
          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </div>
    </a>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function MoltbookPage() {
  const [minConfidence, setMinConfidence] = useState(40);
  const [autoPost, setAutoPost] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ text: string; kind: "success" | "error" } | null>(null);

  const fetchStatus = useCallback(() => api<MoltbookStatus>("/moltbook/status"), []);
  const fetchHistory = useCallback(() => api<MoltbookHistoryResponse>("/moltbook/history"), []);

  const { data: status } = usePolling(fetchStatus, 15_000);
  const { data: history, refresh: refreshHistory } = usePolling(fetchHistory, 30_000);

  // Sync from server on first load
  const [synced, setSynced] = useState(false);
  if (status && !synced) {
    setMinConfidence(status.minConfidence ?? 40);
    setAutoPost(status.autoPost ?? false);
    setSynced(true);
  }

  const isEnabled = status?.enabled ?? false;
  const posts = history?.posts ?? [];

  // ── Save config ─────────────────────────────────────────────────────────

  const saveConfig = async () => {
    setSaving(true);
    setSaveMsg(null);
    try {
      const res = await fetch("/moltbook/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoPost, minConfidence }),
      });
      if (res.ok) {
        setSaveMsg({ text: "Config saved", kind: "success" });
        refreshHistory();
      } else {
        setSaveMsg({ text: "Failed to save", kind: "error" });
      }
    } catch {
      setSaveMsg({ text: "Error saving config", kind: "error" });
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(null), 3000);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader description="Auto-post hunt results to Moltbook. Configure posting rules and view post history.">
        <span>Moltbook</span> Integration
      </PageHeader>

      {/* Status */}
      <div className="section-title">Status</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <div
              className={isEnabled ? "status-indicator ok" : "status-indicator"}
              style={{ width: 10, height: 10, background: isEnabled ? undefined : "var(--text3)" }}
            />
            <span style={{
              fontWeight: 700,
              fontFamily: "var(--mono)",
              fontSize: ".9rem",
              color: isEnabled ? "var(--green)" : "var(--text3)",
            }}>
              {status ? (isEnabled ? "CONNECTED" : "NOT CONFIGURED") : "Checking..."}
            </span>
          </div>
          {isEnabled && (
            <>
              <span className="badge badge-purple" style={{ fontSize: ".75rem" }}>
                m/{status?.submolt}
              </span>
              <span style={{ fontFamily: "var(--mono)", fontSize: ".8rem", color: "var(--text3)" }}>
                Posts today: {status?.postsToday ?? 0}
              </span>
              {status?.lastPost && (
                <span style={{ fontFamily: "var(--mono)", fontSize: ".8rem", color: "var(--text3)" }}>
                  Last: {timeAgo(status.lastPost)}
                </span>
              )}
              {(status?.rateLimitRemainingMs ?? 0) > 0 && (
                <span style={{ fontFamily: "var(--mono)", fontSize: ".75rem", color: "var(--yellow)" }}>
                  Rate limit: {Math.ceil((status?.rateLimitRemainingMs ?? 0) / 60_000)}m
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* Config */}
      <div className="section-title">Posting Config</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {/* Auto-post toggle */}
          <label style={{ display: "flex", alignItems: "center", gap: ".75rem", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoPost}
              onChange={(e) => setAutoPost(e.target.checked)}
              style={{ accentColor: "var(--accent)" }}
            />
            <span style={{ fontSize: ".85rem", color: "var(--text)" }}>
              Auto-post hunt results to Moltbook
            </span>
          </label>

          {/* Min confidence */}
          <div>
            <p style={{ fontSize: ".85rem", color: "var(--text2)", marginBottom: ".5rem" }}>
              Minimum confidence to auto-post
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem", flexWrap: "wrap" }}>
              <input
                type="range"
                min={0}
                max={100}
                value={minConfidence}
                onChange={(e) => setMinConfidence(Number(e.target.value))}
                style={{ flex: 1, minWidth: 200, accentColor: "var(--accent)" }}
              />
              <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(Math.min(100, Math.max(0, Number(e.target.value))))}
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
              <button className="btn-sm btn-green" onClick={saveConfig} disabled={saving}>
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
          {saveMsg && (
            <div style={{ fontSize: ".75rem", color: saveMsg.kind === "success" ? "var(--green)" : "var(--red)" }}>
              {saveMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* Post History */}
      <div className="section-title">
        Recent Posts
        {posts.length > 0 && (
          <span style={{ fontWeight: 400, color: "var(--text3)", fontSize: ".8rem", marginLeft: ".5rem" }}>
            ({posts.length})
          </span>
        )}
      </div>

      {posts.length === 0 ? (
        <div className="panel" style={{ marginBottom: "2rem" }}>
          <p style={{ fontSize: ".85rem", color: "var(--text3)", textAlign: "center", padding: "2rem 0" }}>
            {isEnabled
              ? "No posts yet. Run a hunt or enable autopilot to start posting."
              : "Set MOLTBOOK_API_KEY in .env to enable Moltbook integration."}
          </p>
        </div>
      ) : (
        <div className="moltbook-grid" style={{ marginBottom: "2rem" }}>
          {posts.map((post) => (
            <PostCard key={post.postId} post={post} submolt={status?.submolt ?? "lablab"} />
          ))}
        </div>
      )}

      {/* Setup Guide */}
      {!isEnabled && (
        <>
          <div className="section-title">Setup</div>
          <div className="panel" style={{ marginBottom: "2rem" }}>
            <div style={{ fontSize: ".85rem", color: "var(--text2)", lineHeight: 1.8 }}>
              <p style={{ marginBottom: ".75rem" }}>To connect AlphaClaw to Moltbook:</p>
              <ol style={{ paddingLeft: "1.5rem", color: "var(--text2)" }}>
                <li>
                  Get an API key from{" "}
                  <a
                    href="https://www.moltbook.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "var(--accent2)" }}
                  >
                    moltbook.com
                  </a>
                </li>
                <li>
                  Set environment variables:
                  <div style={{
                    background: "var(--bg3)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: ".75rem",
                    margin: ".5rem 0",
                    fontFamily: "var(--mono)",
                    fontSize: ".75rem",
                    color: "var(--text)",
                  }}>
                    MOLTBOOK_API_KEY=your_api_key<br />
                    MOLTBOOK_SUBMOLT=lablab<br />
                    MOLTBOOK_AUTO_POST=true<br />
                    MOLTBOOK_MIN_CONFIDENCE=40
                  </div>
                </li>
                <li>Restart the coordinator. The MB badge in the nav will turn green.</li>
              </ol>
            </div>
          </div>
        </>
      )}
    </>
  );
}
