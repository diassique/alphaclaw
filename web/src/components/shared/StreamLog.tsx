import { useEffect, useRef } from "react";
import type { LogEntry } from "../../hooks/useHuntStream.ts";

interface Props {
  logs: LogEntry[];
  maxHeight?: string;
}

export function StreamLog({ logs, maxHeight = "500px" }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [logs]);

  return (
    <div className="stream-log" ref={ref} style={{ maxHeight }}>
      {logs.map((l, i) => (
        <div key={i} className={`log-line log-${l.cls}`}>
          <span className="log-time">{l.time}</span>
          <span>
            {l.icon} {l.msg}
          </span>
        </div>
      ))}
    </div>
  );
}
