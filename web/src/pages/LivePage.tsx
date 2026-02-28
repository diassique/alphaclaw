import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { Wallet, Activity, Clock, Fish, Shield, Copy, ExternalLink } from "lucide-react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { timeAgo, shortAddr, shortHash } from "../lib/utils.ts";
import type {
  LiveConfig,
  TxFeedItem,
  WhaleMovement,
  SettlementStats,
  HuntPayingEvent,
  HuntResultEvent,
} from "../api/types.ts";

// ─── Service definitions for flow diagram ────────────────────────────────────

interface FlowServiceDef {
  key: string;
  label: string;
  price: string;
  port: string;
}

const FLOW_SERVICES: FlowServiceDef[] = [
  { key: "news-agent", label: "News", price: "$0.001", port: ":4004" },
  { key: "crypto-sentiment", label: "Sentiment", price: "$0.001", port: ":4001" },
  { key: "polymarket-alpha-scanner", label: "Polymarket", price: "$0.020", port: ":4002" },
  { key: "defi-alpha-scanner", label: "DeFi", price: "$0.015", port: ":4003" },
  { key: "whale-agent", label: "Whale", price: "$0.002", port: ":4005" },
];

// ─── Pending settlement item (from /settlement/pending) ──────────────────────

interface PendingItem {
  huntId: string;
  topic: string;
  consensus: string;
  settled: boolean;
}

interface SettlementHistoryItem {
  huntId: string;
  topic: string;
  consensus: string;
  correct: boolean;
  priceMovePct: number;
  settledAt: string;
}

interface SettlementHistoryResponse {
  history: SettlementHistoryItem[];
}

// ─── Whale response shape ────────────────────────────────────────────────────

interface WhaleResponse {
  result: { movements: WhaleMovement[] };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function explorerTxLink(hash: string | undefined, explorer: string): ReactNode {
  if (!hash) return <span style={{ color: "var(--text3)" }}>&mdash;</span>;
  return (
    <a className="explorer-link" href={`${explorer}/tx/${hash}`} target="_blank" rel="noopener noreferrer">
      {shortHash(hash)}
    </a>
  );
}

function explorerAddrLink(addr: string | undefined, explorer: string): ReactNode {
  if (!addr) return <span style={{ color: "var(--text3)" }}>&mdash;</span>;
  return (
    <a className="explorer-link" href={`${explorer}/address/${addr}`} target="_blank" rel="noopener noreferrer">
      {shortAddr(addr)}
    </a>
  );
}

async function copyAddr(text: string, setFlash: (id: string) => void, id: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setFlash(id);
  } catch {
    /* clipboard unavailable */
  }
}

function statusBadge(status: string): ReactNode {
  const cls = status === "paid" ? "badge-green" : status === "demo" ? "badge-yellow" : "badge-red";
  return (
    <span className={`badge ${cls}`} style={{ fontSize: ".65rem", padding: ".15rem .5rem" }}>
      {status.toUpperCase()}
    </span>
  );
}

function cleanServiceName(name: string): string {
  return name.replace("alphaclaw-", "").replace("-agent", "");
}

// ─── Component ───────────────────────────────────────────────────────────────

export function LivePage() {
  // ── State ────────────────────────────────────────────────────────────────

  const [config, setConfig] = useState<LiveConfig | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [topic, setTopic] = useState("ethereum DeFi");
  const [flashCopy, setFlashCopy] = useState<string | null>(null);
  const [activeServices, setActiveServices] = useState<Record<string, "paying" | "paid" | "demo">>({});
  const [liveTxItems, setLiveTxItems] = useState<TxFeedItem[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // ── Load config (once on mount) ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const cfg = await api<LiveConfig>("/live/config");
        if (!cancelled) setConfig(cfg);
      } catch {
        /* swallow */
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  // ── Polled feeds ─────────────────────────────────────────────────────────

  const feedFetcher = useCallback(() => api<TxFeedItem[]>("/live/feed?limit=20"), []);
  const { data: feedData, refresh: refreshFeed } = usePolling(feedFetcher, 15_000);

  const whaleFetcher = useCallback(() => api<WhaleResponse>("/live/whales"), []);
  const { data: whaleData } = usePolling(whaleFetcher, 60_000);

  const statsFetcher = useCallback(() => api<SettlementStats>("/settlement/stats"), []);
  const { data: settlementStats } = usePolling(statsFetcher, 30_000);

  const pendingFetcher = useCallback(() => api<PendingItem[]>("/settlement/pending"), []);
  const { data: pendingItems } = usePolling(pendingFetcher, 30_000);

  const historyFetcher = useCallback(() => api<SettlementHistoryResponse>("/settlement/history?limit=20"), []);
  const { data: historyData } = usePolling(historyFetcher, 30_000);

  // ── Derived values ───────────────────────────────────────────────────────

  const explorer = config?.explorer ?? "https://sepolia.basescan.org";
  const whaleExplorer = config?.whaleExplorer ?? "https://basescan.org";
  const movements = whaleData?.result?.movements ?? [];

  // Merge live SSE tx items on top of polled feed
  const allTxItems: TxFeedItem[] = liveTxItems.length > 0
    ? [...liveTxItems, ...(feedData ?? [])].slice(0, 30)
    : (feedData ?? []);

  // ── Copy flash effect ────────────────────────────────────────────────────

  useEffect(() => {
    if (!flashCopy) return;
    const t = setTimeout(() => setFlashCopy(null), 800);
    return () => clearTimeout(t);
  }, [flashCopy]);

  // ── SSE live hunt ────────────────────────────────────────────────────────

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStreaming(false);
    setActiveServices({});
  }, []);

  const startLiveHunt = useCallback(() => {
    if (esRef.current) return;

    const encodedTopic = encodeURIComponent(topic || "ethereum DeFi");
    const es = new EventSource(`/stream?topic=${encodedTopic}`);
    esRef.current = es;
    setStreaming(true);
    setLiveTxItems([]);
    setActiveServices({});

    es.addEventListener("paying", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as HuntPayingEvent;
      setActiveServices((prev) => ({ ...prev, [d.service]: "paying" }));
    });

    es.addEventListener("result", (e: MessageEvent) => {
      const d = JSON.parse(e.data) as HuntResultEvent;
      const status = d.paid ? "paid" : "demo";

      setActiveServices((prev) => ({ ...prev, [d.service]: status }));

      // Clear service highlight after 3s
      setTimeout(() => {
        setActiveServices((prev) => {
          const next = { ...prev };
          if (next[d.service] === status) delete next[d.service];
          return next;
        });
      }, 3000);

      // Prepend tx to live feed
      const tx: TxFeedItem = {
        timestamp: new Date().toISOString(),
        service: d.service,
        fromAddr: d.fromAddr,
        toAddr: d.toAddr,
        amount: d.paid ? (d.amount ?? "(paid)") : "(demo)",
        txHash: d.txHash,
        status: d.paid ? "paid" : "demo",
      };
      setLiveTxItems((prev) => [tx, ...prev].slice(0, 20));
    });

    es.addEventListener("done", () => {
      closeStream();
      setTimeout(refreshFeed, 500);
    });

    es.onerror = () => {
      closeStream();
    };
  }, [topic, refreshFeed, closeStream]);

  const stopLiveHunt = closeStream;

  // ── Cleanup on unmount ───────────────────────────────────────────────────

  useEffect(() => {
    return () => {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    };
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <>
      <PageHeader description="Real x402 USDC payments on Base Sepolia and whale movements on Base mainnet. Click any hash or address for block explorer proof.">
        <span>Live</span> Transactions
      </PageHeader>

      {/* ── Wallet Identity Panel ──────────────────────────────────────── */}
      <div className="section-title">
        <span className="sec-icon"><Wallet size={18} /></span>
        Wallet Identity
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "2rem" }}>
        {/* Agent Wallet (Sender) */}
        <div className="wallet-panel">
          <div className="wallet-panel-label">Agent Wallet (Sender)</div>
          <div className="wallet-addr-row">
            <code
              className="wallet-addr"
              style={flashCopy === "sender" ? { color: "var(--green)" } : undefined}
            >
              {config?.sender ?? "Loading..."}
            </code>
            {config?.sender && (
              <button
                className="copy-btn"
                title="Copy address"
                onClick={() => copyAddr(config.sender!, setFlashCopy, "sender")}
              >
                <Copy size={14} />
              </button>
            )}
          </div>
          <div className="wallet-meta">
            {config?.sender && (
              <a
                className="explorer-link"
                href={`${explorer}/address/${config.sender}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={12} /> View on BaseScan
              </a>
            )}
            <span className="wallet-network-badge">{config?.network ?? "base-sepolia"}</span>
            {config?.walletConnected ? (
              <span className="wallet-connected">
                <span className="badge badge-green" style={{ fontSize: ".65rem", padding: ".15rem .5rem" }}>
                  <span className="dot" /> Connected
                </span>
              </span>
            ) : (
              <span className="wallet-connected">
                <span className="badge badge-yellow" style={{ fontSize: ".65rem", padding: ".15rem .5rem" }}>
                  Demo Mode
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Service Wallet (Receiver) */}
        <div className="wallet-panel">
          <div className="wallet-panel-label">Service Wallet (Receiver)</div>
          <div className="wallet-addr-row">
            <code
              className="wallet-addr"
              style={flashCopy === "receiver" ? { color: "var(--green)" } : undefined}
            >
              {config?.receiver ?? "Loading..."}
            </code>
            {config?.receiver && (
              <button
                className="copy-btn"
                title="Copy address"
                onClick={() => copyAddr(config.receiver!, setFlashCopy, "receiver")}
              >
                <Copy size={14} />
              </button>
            )}
          </div>
          <div className="wallet-meta">
            {config?.receiver && (
              <a
                className="explorer-link"
                href={`${explorer}/address/${config.receiver}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink size={12} /> View on BaseScan
              </a>
            )}
            <span className="wallet-network-badge">USDC receiver</span>
          </div>
        </div>
      </div>

      {/* ── USDC Contract Link ─────────────────────────────────────────── */}
      <div className="panel" style={{ marginBottom: "2rem", textAlign: "center" }}>
        <span style={{ fontSize: ".78rem", color: "var(--text3)", fontFamily: "var(--mono)" }}>
          USDC Contract (Base Sepolia):{" "}
        </span>
        {config?.usdcContract ? (
          <a
            className="explorer-link"
            href={`${explorer}/token/${config.usdcContract}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: ".78rem" }}
          >
            <ExternalLink size={12} /> {config.usdcContract}
          </a>
        ) : (
          <span style={{ fontSize: ".78rem", color: "var(--text3)" }}>Loading...</span>
        )}
      </div>

      {/* ── Payment Flow Diagram ───────────────────────────────────────── */}
      <div className="section-title">
        <span className="sec-icon"><Activity size={18} /></span>
        Payment Flow
      </div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div className="flow-diagram">
          <div className="flow-node flow-client">
            <div className="flow-node-label">Client</div>
            <div className="flow-node-detail">&rarr; $0.050</div>
          </div>
          <div className={`flow-arrow${streaming ? " active" : ""}`}>&rarr;</div>
          <div className="flow-node flow-coordinator">
            <div className="flow-node-label">Coordinator</div>
            <div className="flow-node-addr">
              {config?.sender ? shortAddr(config.sender) : "demo"}
            </div>
            <div className="flow-node-detail">:5000</div>
          </div>
          <div className={`flow-arrow${streaming ? " active" : ""}`}>&rarr;</div>
          <div className="flow-services">
            {FLOW_SERVICES.map((svc) => {
              const state = activeServices[svc.key];
              const cls = [
                "flow-service",
                state === "paying" ? "flow-active" : "",
                state === "paid" ? "flow-paid" : "",
                state === "demo" ? "flow-demo" : "",
              ].filter(Boolean).join(" ");
              return (
                <div className={cls} data-service={svc.key} key={svc.key}>
                  <span>{svc.label}</span>
                  <span className="flow-svc-price">{svc.price}</span>
                  <span className="flow-svc-port">{svc.port}</span>
                </div>
              );
            })}
          </div>
          <div className="flow-receiver-label">
            <Shield size={12} />
            {" "}Receiver: {config?.receiver ? shortAddr(config.receiver) : "not set"}
          </div>
        </div>
      </div>

      {/* ── Live Hunt Trigger + x402 Transaction Feed ──────────────────── */}
      <div className="section-title">
        <span className="sec-icon"><Clock size={18} /></span>
        x402 Transaction Feed
        {streaming && (
          <span className="live-badge">
            <span className="live-dot" /> STREAMING
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: ".75rem", marginBottom: "1rem", alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          className="hunt-input"
          placeholder="Topic for live hunt..."
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !streaming) startLiveHunt(); }}
          style={{ maxWidth: 300 }}
        />
        {!streaming ? (
          <button className="btn btn-primary btn-sm" onClick={startLiveHunt}>
            Start Live Hunt
          </button>
        ) : (
          <button className="btn btn-secondary btn-sm" onClick={stopLiveHunt}>
            Stop
          </button>
        )}
      </div>

      <div className="tx-feed">
        <div className="tx-header">
          <div className="tx-title">Recent x402 Payments</div>
          <span className="badge badge-purple">{allTxItems.length} txs</span>
        </div>
        <div>
          {allTxItems.length === 0 ? (
            <div className="tx-empty">No transactions yet. Start a hunt or wait for autopilot.</div>
          ) : (
            allTxItems.map((tx, i) => (
              <div className="tx-item tx-item-new" key={`${tx.txHash ?? tx.service}-${tx.timestamp}-${i}`}>
                <span style={{ color: "var(--text3)", minWidth: 65 }}>{timeAgo(tx.timestamp)}</span>
                <span className="tx-dir">&rarr;</span>
                <span>{explorerAddrLink(tx.fromAddr, explorer)}</span>
                <span className="tx-dir">&rarr;</span>
                <span>{explorerAddrLink(tx.toAddr, explorer)}</span>
                <span style={{ color: "var(--text2)", minWidth: 80 }}>{cleanServiceName(tx.service)}</span>
                <span className="tx-amount">{tx.amount}</span>
                <span>{explorerTxLink(tx.txHash, explorer)}</span>
                {statusBadge(tx.status)}
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Whale Movements ────────────────────────────────────────────── */}
      <div className="section-title" style={{ marginTop: "2rem" }}>
        <span className="sec-icon"><Fish size={18} /></span>
        Whale Movements
        <span className="badge badge-yellow" style={{ marginLeft: ".5rem" }}>Base Mainnet</span>
      </div>
      <div className="tx-feed">
        <div className="tx-header">
          <div className="tx-title">Large On-Chain Transfers</div>
          <span className="badge badge-yellow">{movements.length} movements</span>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>From</th>
                <th>To</th>
                <th>Value</th>
                <th>Token</th>
                <th>USD Est</th>
                <th>Tx Hash</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ textAlign: "center", color: "var(--text3)" }}>
                    No whale movements detected in recent blocks
                  </td>
                </tr>
              ) : (
                movements.map((m, i) => (
                  <tr key={`${m.hash}-${i}`}>
                    <td>{timeAgo(m.timestamp)}</td>
                    <td>{explorerAddrLink(m.from, whaleExplorer)}</td>
                    <td>{explorerAddrLink(m.to, whaleExplorer)}</td>
                    <td style={{ fontWeight: 700, color: "var(--text)" }}>{m.value}</td>
                    <td>
                      <span className="badge badge-purple" style={{ fontSize: ".65rem", padding: ".15rem .5rem" }}>
                        {m.tokenSymbol}
                      </span>
                    </td>
                    <td style={{ color: "var(--green)" }}>{m.usdEstimate ?? "\u2014"}</td>
                    <td>{explorerTxLink(m.hash, whaleExplorer)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Settlement Oracle ──────────────────────────────────────────── */}
      <div className="section-title" style={{ marginTop: "2rem" }}>
        <span className="sec-icon"><Shield size={18} /></span>
        Settlement Oracle
      </div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div className="stats" style={{ marginBottom: 0 }}>
          <div className="stat">
            <div className="stat-val">{pendingItems?.length ?? "\u2014"}</div>
            <div className="stat-label">Pending</div>
          </div>
          <div className="stat">
            <div className="stat-val">
              {settlementStats && settlementStats.totalSettled > 0
                ? `${((settlementStats.correctCount / settlementStats.totalSettled) * 100).toFixed(0)}%`
                : "\u2014"}
            </div>
            <div className="stat-label">Accuracy</div>
          </div>
          <div className="stat">
            <div className="stat-val">{settlementStats?.totalSettled ?? "\u2014"}</div>
            <div className="stat-label">Settled</div>
          </div>
          <div className="stat">
            <div className="stat-val">
              {settlementStats?.avgPriceMovePct != null
                ? `${settlementStats.avgPriceMovePct.toFixed(2)}%`
                : "\u2014"}
            </div>
            <div className="stat-label">Avg Price Move</div>
          </div>
        </div>
      </div>

      {/* Settlement History */}
      {historyData?.history && historyData.history.length > 0 && (
        <div className="panel" style={{ marginBottom: "2rem", maxHeight: 300, overflow: "auto" }}>
          <div style={{ fontSize: ".7rem", fontWeight: 600, color: "var(--text3)", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".5rem" }}>
            Settlement History
          </div>
          {historyData.history.map((h, i) => (
            <div
              key={h.huntId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: ".75rem",
                padding: ".35rem 0",
                borderBottom: i < historyData.history.length - 1 ? "1px solid var(--border)" : "none",
                fontSize: ".75rem",
                fontFamily: "var(--mono)",
              }}
            >
              <span style={{ fontSize: ".85rem" }}>{h.correct ? "\u2705" : "\u274c"}</span>
              <span style={{ color: "var(--text)", fontWeight: 600, minWidth: 100 }}>{h.topic}</span>
              <span style={{
                color: h.consensus === "bullish" ? "var(--green)" : h.consensus === "bearish" ? "var(--red)" : "var(--text3)",
                minWidth: 60,
              }}>
                {h.consensus}
              </span>
              <span style={{ color: "var(--text3)" }}>
                {h.priceMovePct >= 0 ? "+" : ""}{h.priceMovePct.toFixed(2)}%
              </span>
              <span style={{ color: "var(--text3)", fontSize: ".65rem", marginLeft: "auto" }}>
                {new Date(h.settledAt).toLocaleTimeString("en", { hour12: false })}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
