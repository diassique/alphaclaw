import { useStatus } from "../../context/StatusContext.tsx";

function statusIcon(status: string): string {
  return status === "ok" ? "\u2713" : "\u2717";
}

export function StatusStrip() {
  const data = useStatus();

  const cls = data
    ? data.ok
      ? "ok"
      : data.onlineCount > 0
        ? "degraded"
        : "offline"
    : "loading";

  const labelText = data
    ? data.ok
      ? "ALL OPERATIONAL"
      : data.onlineCount > 0
        ? `DEGRADED (${data.onlineCount}/${data.totalCount})`
        : "OFFLINE"
    : "Checking...";

  return (
    <div className="status-strip">
      <div className="status-strip-left">
        <div className={`status-indicator ${cls}`} />
        <span className={`status-label ${cls}`}>{labelText}</span>
      </div>
      <div className="status-dots">
        {data?.services.map((s) => {
          const dotCls = s.status === "ok" ? "ok" : s.status === "error" ? "error" : "offline";
          return (
            <div key={s.name} className={`status-dot ${dotCls}`} title={s.name}>
              <span dangerouslySetInnerHTML={{ __html: statusIcon(s.status) }} />
              <div className="tooltip">
                <strong>{s.name}</strong>
                <br />
                Port {s.port} &middot; {s.latencyMs}ms
                <br />
                {s.price ? `${s.price} USDC` : "coordinator"}
                <br />
                Status:{" "}
                <span style={{ color: s.status === "ok" ? "var(--green)" : "var(--red)" }}>
                  {s.status.toUpperCase()}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="status-meta">
        <span>{data ? `avg ${data.avgLatencyMs}ms` : "--"}</span> &middot;{" "}
        <span>
          {data ? `updated ${new Date(data.checkedAt).toLocaleTimeString("en", { hour12: false })}` : "checking"}
        </span>{" "}
        &middot; <span className="status-countdown" />
      </div>
    </div>
  );
}
