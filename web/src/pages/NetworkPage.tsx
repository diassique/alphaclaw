import { useState, useCallback, type FormEvent, type CSSProperties, type ChangeEvent } from "react";
import { api } from "../api/client.ts";
import { usePolling } from "../hooks/usePolling.ts";
import { useStatus } from "../context/StatusContext.tsx";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { timeAgo, latencyClass } from "../lib/utils.ts";
import { SERVICE_LABELS, CIRCUIT_LABELS } from "../lib/constants.ts";
import type {
  CircuitsResponse,
  CircuitEntry,
  PingResponse,
  RegistryResponse,
  AgentInfo,
  ServiceHealth,
  MarketplaceStatus,
} from "../api/types.ts";

// ─── Registration form state type ───────────────────────────────────────────

interface RegisterForm {
  key: string;
  displayName: string;
  url: string;
  endpoint: string;
  price: string;
  category: string;
  description: string;
}

const EMPTY_FORM: RegisterForm = {
  key: "",
  displayName: "",
  url: "",
  endpoint: "",
  price: "",
  category: "",
  description: "",
};

const CATEGORIES = [
  { value: "", label: "Category..." },
  { value: "sentiment", label: "Sentiment" },
  { value: "prediction", label: "Prediction" },
  { value: "defi", label: "DeFi" },
  { value: "news", label: "News" },
  { value: "onchain", label: "On-chain" },
  { value: "other", label: "Other" },
];

// ─── Architecture diagram services ──────────────────────────────────────────

interface ArchService {
  name: string;
  port: number;
  price: string;
}

const ARCH_SERVICES: ArchService[] = [
  { name: "News", port: 4004, price: "$0.001" },
  { name: "Sentiment", port: 4001, price: "$0.001" },
  { name: "Polymarket", port: 4002, price: "$0.020" },
  { name: "DeFi", port: 4003, price: "$0.015" },
  { name: "Whale", port: 4005, price: "$0.002" },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

function networkClass(ok: boolean, onlineCount: number): "ok" | "degraded" | "offline" {
  if (ok) return "ok";
  if (onlineCount > 0) return "degraded";
  return "offline";
}

type NetStatus = "ok" | "degraded" | "offline";

const NETWORK_STATUS_LABELS: Record<NetStatus, string> = {
  ok: "FULLY OPERATIONAL",
  degraded: "DEGRADED",
  offline: "OFFLINE",
};

const NETWORK_STATUS_COLORS: Record<NetStatus, string> = {
  ok: "var(--green)",
  degraded: "var(--yellow)",
  offline: "var(--red)",
};

function circuitTimestamps(c: CircuitEntry): string[] {
  const ts: string[] = [];
  if (c.lastFailure) ts.push(`Last fail: ${timeAgo(new Date(c.lastFailure).toISOString())}`);
  if (c.lastSuccess) ts.push(`Last ok: ${timeAgo(new Date(c.lastSuccess).toISOString())}`);
  if (c.openedAt) ts.push(`Opened: ${timeAgo(new Date(c.openedAt).toISOString())}`);
  return ts;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function NetworkBanner({
  ok,
  onlineCount,
  totalCount,
  avgLatencyMs,
  checkedAt,
}: {
  ok: boolean;
  onlineCount: number;
  totalCount: number;
  avgLatencyMs: number;
  checkedAt: string;
}) {
  const cls = networkClass(ok, onlineCount);
  return (
    <div className="panel" style={{ textAlign: "center", marginBottom: "2rem" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: ".75rem",
        }}
      >
        <div
          className={`status-indicator ${cls}`}
          style={{ width: 12, height: 12 }}
        />
        <span
          style={{
            fontSize: "1.2rem",
            fontWeight: 700,
            fontFamily: "var(--mono)",
            color: NETWORK_STATUS_COLORS[cls],
          }}
        >
          {NETWORK_STATUS_LABELS[cls]}
        </span>
      </div>
      <div
        style={{
          fontSize: ".8rem",
          color: "var(--text3)",
          marginTop: ".5rem",
        }}
      >
        {onlineCount}/{totalCount} services online &middot; avg {avgLatencyMs}ms
        &middot; checked{" "}
        {new Date(checkedAt).toLocaleTimeString("en", { hour12: false })}
      </div>
    </div>
  );
}

function ServiceCard({ service }: { service: ServiceHealth }) {
  const statusCls =
    service.status === "ok" ? "ok" : service.status === "error" ? "err" : "off";
  const latCls = latencyClass(service.latencyMs);
  return (
    <div className="service-card">
      <div className={`service-status status-${statusCls}`} />
      <div className="service-info">
        <div className="service-name">{service.name}</div>
        <div className="service-details">
          <span className="service-price">{service.price || "coordinator"}</span>
          <span className={`service-latency ${latCls}`}>
            {service.latencyMs}ms
          </span>
          <span className="service-port">:{service.port}</span>
        </div>
      </div>
    </div>
  );
}

function LatencyBars({ services }: { services: ServiceHealth[] }) {
  const max = Math.max(...services.map((s) => s.latencyMs), 1);
  return (
    <div>
      {services.map((s) => {
        const pct = (s.latencyMs / max) * 100;
        const cls = latencyClass(s.latencyMs);
        return (
          <div
            key={s.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: ".75rem",
              marginBottom: ".5rem",
            }}
          >
            <span
              style={{
                minWidth: 140,
                fontSize: ".75rem",
                color: "var(--text2)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {s.name.replace("alphaclaw-", "")}
            </span>
            <div className="latency-bar-outer" style={{ flex: 1 }}>
              <div
                className={`latency-bar-fill ${cls}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span
              style={{
                minWidth: 50,
                textAlign: "right",
                fontFamily: "var(--mono)",
                fontSize: ".7rem",
                color: "var(--text3)",
              }}
            >
              {s.latencyMs}ms
            </span>
          </div>
        );
      })}
    </div>
  );
}

function CircuitCard({
  name,
  entry,
}: {
  name: string;
  entry: CircuitEntry;
}) {
  const ts = circuitTimestamps(entry);
  return (
    <div className={`circuit-card circuit-${entry.state}`}>
      <div className={`circuit-dot ${entry.state}`} />
      <div className="circuit-info">
        <div className="circuit-name">
          {CIRCUIT_LABELS[name] || name}
        </div>
        <div className="circuit-state">
          {entry.state} &middot; {entry.failures} fails
        </div>
        {ts.length > 0 && (
          <div
            style={{
              fontSize: ".6rem",
              color: "var(--text3)",
              marginTop: ".2rem",
            }}
          >
            {ts.join(" \u00b7 ")}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  onRemove,
}: {
  agent: AgentInfo;
  onRemove: (key: string) => void;
}) {
  const statusCls = agent.online ? "ok" : "off";
  return (
    <div className="service-card" style={{ marginBottom: ".4rem" }}>
      <div className={`service-status status-${statusCls}`} />
      <div className="service-info" style={{ flex: 1 }}>
        <div className="service-name">
          {agent.displayName}
          {agent.builtin ? (
            <span
              style={{
                fontSize: ".6rem",
                background: "var(--accent)",
                color: "#fff",
                padding: "1px 5px",
                borderRadius: 3,
                marginLeft: ".3rem",
              }}
            >
              BUILT-IN
            </span>
          ) : (
            <span
              style={{
                fontSize: ".6rem",
                background: "var(--green)",
                color: "#000",
                padding: "1px 5px",
                borderRadius: 3,
                marginLeft: ".3rem",
              }}
            >
              EXTERNAL
            </span>
          )}
          {!agent.builtin && (
            <button
              onClick={() => onRemove(agent.key)}
              style={{
                background: "none",
                border: "1px solid var(--red)",
                color: "var(--red)",
                borderRadius: 4,
                padding: "1px 6px",
                fontSize: ".65rem",
                cursor: "pointer",
                marginLeft: ".5rem",
              }}
            >
              Remove
            </button>
          )}
        </div>
        <div className="service-details">
          <span style={{ color: "var(--text3)", fontSize: ".7rem" }}>
            {agent.key}
          </span>
          <span className="service-price">{agent.price}</span>
          <span style={{ color: "var(--text3)", fontSize: ".7rem" }}>
            {agent.category}
          </span>
          {!agent.builtin && (
            <span style={{ color: "var(--text3)", fontSize: ".65rem" }}>
              {agent.url}
              {agent.endpoint}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArchitectureDiagram() {
  return (
    <div style={{ textAlign: "center", padding: "1rem" }}>
      <div
        style={{
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "1.5rem",
          fontFamily: "var(--mono)",
          fontSize: ".75rem",
        }}
      >
        {/* Client */}
        <div
          style={{
            background: "var(--bg3)",
            border: "1px solid var(--accent)",
            borderRadius: 10,
            padding: ".75rem 1.5rem",
            color: "var(--accent2)",
            fontWeight: 700,
          }}
        >
          Client &rarr; $0.050
        </div>
        <div
          style={{
            width: 2,
            height: 20,
            background: "var(--border2)",
          }}
        />
        {/* Coordinator */}
        <div
          style={{
            background:
              "linear-gradient(135deg, rgba(124,58,237,.15), rgba(6,182,212,.1))",
            border: "2px solid var(--accent)",
            borderRadius: 14,
            padding: "1rem 2rem",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontWeight: 700,
              fontSize: ".9rem",
              color: "var(--text)",
              marginBottom: ".25rem",
            }}
          >
            AlphaClaw Coordinator
          </div>
          <div style={{ fontSize: ".7rem", color: "var(--text3)" }}>
            Port 5000 &middot; Synthesize + Stake + Cache
          </div>
        </div>
        <div
          style={{
            width: 2,
            height: 10,
            background: "var(--border2)",
          }}
        />
        {/* Services row */}
        <div
          style={{
            display: "flex",
            gap: ".75rem",
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {ARCH_SERVICES.map((s) => (
            <div
              key={s.name}
              style={{
                background: "var(--bg3)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: ".5rem .75rem",
                textAlign: "center",
                minWidth: 100,
              }}
            >
              <div style={{ color: "var(--accent2)", fontWeight: 600 }}>
                {s.name}
              </div>
              <div style={{ color: "var(--text3)", fontSize: ".65rem" }}>
                :{s.port} &middot; {s.price}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Marketplace Controls ───────────────────────────────────────────────────

function MarketplaceControls({ onChanged }: { onChanged: () => void }) {
  const statusFetcher = useCallback(
    () => api<MarketplaceStatus>("/marketplace/status"),
    [],
  );
  const { data: status, refresh } = usePolling(statusFetcher, 5_000);
  const [busy, setBusy] = useState(false);

  const launch = async () => {
    setBusy(true);
    try {
      await api<MarketplaceStatus>("/marketplace/start", { method: "POST" });
      refresh();
      onChanged();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setBusy(true);
    try {
      await api<{ ok: boolean }>("/marketplace/stop", { method: "POST" });
      refresh();
      onChanged();
    } catch {
      // ignore
    } finally {
      setBusy(false);
    }
  };

  const isRunning = status?.running ?? false;

  return (
    <div
      className="panel"
      style={{
        marginBottom: "1.5rem",
        border: isRunning ? "1px solid var(--green)" : "1px solid var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: isRunning ? ".75rem" : 0,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <div
            className={`status-indicator ${isRunning ? "ok" : "off"}`}
            style={{ width: 10, height: 10 }}
          />
          <span style={{ fontWeight: 700, fontSize: ".85rem", color: "var(--text)" }}>
            Marketplace Simulator
          </span>
          <span style={{ fontSize: ".7rem", color: "var(--text3)" }}>
            {isRunning ? `${status?.agents.length ?? 0} mock agents running` : "stopped"}
          </span>
        </div>
        <button
          disabled={busy}
          onClick={isRunning ? stop : launch}
          style={{
            background: isRunning ? "transparent" : "var(--green)",
            border: isRunning ? "1px solid var(--red)" : "none",
            color: isRunning ? "var(--red)" : "#000",
            borderRadius: 6,
            padding: ".35rem .8rem",
            fontSize: ".75rem",
            fontWeight: 600,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.6 : 1,
          }}
        >
          {busy ? "..." : isRunning ? "Stop Marketplace" : "Launch Marketplace"}
        </button>
      </div>
      {isRunning && status?.agents && status.agents.length > 0 && (
        <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap" }}>
          {status.agents.map((a) => (
            <div
              key={a.key}
              style={{
                background: "var(--bg3)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                padding: ".3rem .6rem",
                fontSize: ".7rem",
                fontFamily: "var(--mono)",
              }}
            >
              <span style={{ color: "var(--accent2)", fontWeight: 600 }}>
                {a.displayName}
              </span>
              <span style={{ color: "var(--text3)", marginLeft: ".3rem" }}>
                :{a.port}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Registration form ──────────────────────────────────────────────────────

const formInputStyle: CSSProperties = {
  background: "var(--bg3)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  padding: ".4rem .6rem",
  color: "var(--text)",
  fontSize: ".8rem",
};

function RegisterAgentForm({
  onRegistered,
}: {
  onRegistered: () => void;
}) {
  const [form, setForm] = useState<RegisterForm>(EMPTY_FORM);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = (field: keyof RegisterForm) => (
    e: ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);
    try {
      await api<{ ok: boolean }>("/registry/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      setResult({ ok: true, msg: "Registered!" });
      setForm(EMPTY_FORM);
      onRegistered();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Network error";
      setResult({ ok: false, msg });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <details style={{ marginTop: "1rem" }}>
      <summary
        style={{
          cursor: "pointer",
          color: "var(--accent2)",
          fontSize: ".85rem",
          fontWeight: 600,
        }}
      >
        Register External Agent
      </summary>
      <form
        onSubmit={handleSubmit}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: ".5rem",
          marginTop: ".75rem",
        }}
      >
        <input
          placeholder="agent-key"
          required
          value={form.key}
          onChange={set("key")}
          style={formInputStyle}
        />
        <input
          placeholder="Display Name"
          required
          value={form.displayName}
          onChange={set("displayName")}
          style={formInputStyle}
        />
        <input
          placeholder="https://agent.example.com"
          required
          value={form.url}
          onChange={set("url")}
          style={formInputStyle}
        />
        <input
          placeholder="/analyze"
          required
          value={form.endpoint}
          onChange={set("endpoint")}
          style={formInputStyle}
        />
        <input
          placeholder="$0.005"
          required
          value={form.price}
          onChange={set("price")}
          style={formInputStyle}
        />
        <select
          required
          value={form.category}
          onChange={set("category")}
          style={formInputStyle}
        >
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input
          placeholder="Description"
          required
          value={form.description}
          onChange={set("description")}
          style={{ ...formInputStyle, gridColumn: "1 / -1" }}
        />
        <button
          type="submit"
          disabled={submitting}
          style={{
            gridColumn: "1 / -1",
            background: "var(--accent)",
            border: "none",
            borderRadius: 6,
            padding: ".5rem",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer",
            fontSize: ".8rem",
          }}
        >
          {submitting ? "Registering..." : "Register Agent"}
        </button>
      </form>
      {result && (
        <div
          style={{
            fontSize: ".75rem",
            marginTop: ".5rem",
            color: result.ok ? "var(--green)" : "var(--red)",
          }}
        >
          {result.msg}
        </div>
      )}
    </details>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function NetworkPage() {
  const healthAll = useStatus();

  const circuitsFetcher = useCallback(
    () => api<CircuitsResponse>("/circuits"),
    [],
  );
  const pingFetcher = useCallback(() => api<PingResponse>("/ping"), []);
  const registryFetcher = useCallback(
    () => api<RegistryResponse>("/registry/agents"),
    [],
  );

  const { data: circuits } = usePolling(circuitsFetcher, 10_000);
  const { data: ping } = usePolling(pingFetcher, 10_000);
  const { data: registry, refresh: refreshRegistry } = usePolling(
    registryFetcher,
    10_000,
  );

  const circuitKeys = circuits ? Object.keys(circuits) : [];
  const dynamicPricing = ping?.dynamicPricing ?? [];
  const agents = registry?.agents ?? [];

  const handleRemoveAgent = async (key: string) => {
    if (!window.confirm(`Remove agent "${key}"?`)) return;
    try {
      await api<{ ok: boolean }>(`/registry/${key}`, { method: "DELETE" });
      refreshRegistry();
    } catch {
      // silently ignore
    }
  };

  return (
    <>
      <PageHeader description="Service health, circuit breakers, dynamic pricing, and architecture overview.">
        <span>Network</span> Status
      </PageHeader>

      {/* ── Network Banner ────────────────────────────────────────────────── */}
      {healthAll ? (
        <NetworkBanner
          ok={healthAll.ok}
          onlineCount={healthAll.onlineCount}
          totalCount={healthAll.totalCount}
          avgLatencyMs={healthAll.avgLatencyMs}
          checkedAt={healthAll.checkedAt}
        />
      ) : (
        <div className="panel" style={{ textAlign: "center", marginBottom: "2rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: ".75rem",
            }}
          >
            <div
              className="status-indicator loading"
              style={{ width: 12, height: 12 }}
            />
            <span
              style={{
                fontSize: "1.2rem",
                fontWeight: 700,
                fontFamily: "var(--mono)",
                color: "var(--text3)",
              }}
            >
              Checking...
            </span>
          </div>
        </div>
      )}

      {/* ── Service Cards ─────────────────────────────────────────────────── */}
      <div className="section-title">Services</div>
      <div className="services-grid" style={{ marginBottom: "2rem" }}>
        {healthAll ? (
          healthAll.services.map((s) => (
            <ServiceCard key={s.name} service={s} />
          ))
        ) : (
          <div className="service-card">
            <div className="service-status status-off" />
            <div className="service-info">
              <div className="service-name">Loading...</div>
            </div>
          </div>
        )}
      </div>

      {/* ── Latency Comparison ────────────────────────────────────────────── */}
      <div className="section-title">Latency Comparison</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        {healthAll ? (
          <LatencyBars services={healthAll.services} />
        ) : (
          <span style={{ color: "var(--text3)", fontSize: ".8rem" }}>
            Loading...
          </span>
        )}
      </div>

      {/* ── Circuit Breakers ──────────────────────────────────────────────── */}
      <div className="section-title">Circuit Breakers</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div className="circuit-grid">
          {circuitKeys.length === 0 ? (
            <div
              style={{
                color: "var(--text3)",
                fontSize: ".8rem",
                gridColumn: "1 / -1",
                textAlign: "center",
                padding: ".75rem",
              }}
            >
              {circuits === null ? "Loading circuits..." : "No circuit data yet"}
            </div>
          ) : (
            circuitKeys.map((k) => {
              const entry = circuits![k];
              return entry ? (
                <CircuitCard key={k} name={k} entry={entry} />
              ) : null;
            })
          )}
        </div>
      </div>

      {/* ── Dynamic Pricing ───────────────────────────────────────────────── */}
      <div className="section-title">Dynamic Pricing</div>
      <div className="panel" style={{ marginBottom: "2rem", overflowX: "auto" }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Service</th>
              <th>Base Price</th>
              <th>Effective Price</th>
              <th>Multiplier</th>
              <th>Reputation</th>
            </tr>
          </thead>
          <tbody>
            {dynamicPricing.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{ textAlign: "center", color: "var(--text3)" }}
                >
                  Loading...
                </td>
              </tr>
            ) : (
              <>
                {dynamicPricing.map((p) => (
                  <tr key={p.service}>
                    <td style={{ color: "var(--text)" }}>
                      {SERVICE_LABELS[p.service] || p.service}
                    </td>
                    <td>{p.basePrice}</td>
                    <td style={{ color: "var(--accent2)" }}>
                      {p.effectivePrice}
                    </td>
                    <td>{p.multiplier.toFixed(2)}x</td>
                    <td>{(p.reputation * 100).toFixed(0)}%</td>
                  </tr>
                ))}
                <tr style={{ borderTop: "2px solid var(--border2)" }}>
                  <td style={{ color: "var(--text)", fontWeight: 700 }}>
                    Total
                  </td>
                  <td />
                  <td style={{ color: "var(--green)", fontWeight: 700 }}>
                    {ping?.totalBuyCost ?? "\u2014"}
                  </td>
                  <td />
                  <td />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Economic Overview ─────────────────────────────────────────────── */}
      <div className="section-title">Economic Overview</div>
      <div className="stats" style={{ marginBottom: "2rem" }}>
        <div className="stat">
          <div className="stat-val">{ping?.totalBuyCost ?? "\u2014"}</div>
          <div className="stat-label">Total Buy Cost</div>
        </div>
        <div className="stat">
          <div className="stat-val">$0.050</div>
          <div className="stat-label">Sell Price</div>
        </div>
        <div className="stat">
          <div className="stat-val" style={{ color: "var(--green)" }}>
            {ping?.margin ? ping.margin.replace(" per hunt", "") : "\u2014"}
          </div>
          <div className="stat-label">Margin / Hunt</div>
        </div>
        <div className="stat">
          <div className="stat-val">
            {ping ? String(ping.cachedReports) : "\u2014"}
          </div>
          <div className="stat-label">Cached Reports</div>
        </div>
      </div>

      {/* ── Marketplace Simulator ─────────────────────────────────────────── */}
      <MarketplaceControls onChanged={refreshRegistry} />

      {/* ── Registered Agents ─────────────────────────────────────────────── */}
      <div className="section-title">Registered Agents</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          {registry === null ? (
            <span style={{ color: "var(--text3)", fontSize: ".8rem" }}>
              Loading...
            </span>
          ) : agents.length === 0 ? (
            <span style={{ color: "var(--text3)", fontSize: ".8rem" }}>
              No agents registered
            </span>
          ) : (
            <>
              <div
                style={{
                  fontSize: ".75rem",
                  color: "var(--text3)",
                  marginBottom: ".5rem",
                }}
              >
                {registry.builtin} built-in, {registry.external} external
              </div>
              {agents.map((a) => (
                <AgentCard
                  key={a.key}
                  agent={a}
                  onRemove={handleRemoveAgent}
                />
              ))}
            </>
          )}
        </div>
        <RegisterAgentForm onRegistered={refreshRegistry} />
      </div>

      {/* ── Architecture Diagram ──────────────────────────────────────────── */}
      <div className="section-title">Architecture</div>
      <div className="panel" style={{ marginBottom: "2rem" }}>
        <ArchitectureDiagram />
      </div>
    </>
  );
}
