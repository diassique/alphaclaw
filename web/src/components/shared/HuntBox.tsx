import { useState, type KeyboardEvent } from "react";
import { DEFAULT_TOPICS } from "../../lib/constants.ts";

interface Props {
  onHunt: (topic: string) => void;
  hunting: boolean;
  topics?: string[];
}

export function HuntBox({ onHunt, hunting, topics = DEFAULT_TOPICS }: Props) {
  const [topic, setTopic] = useState("");

  const fire = () => {
    const t = topic.trim();
    if (!t) return;
    onHunt(t);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter") fire();
  };

  return (
    <div className="hunt-box" style={{ marginBottom: "2rem" }}>
      <div className="hunt-input-row">
        <input
          className="hunt-input"
          type="text"
          placeholder="e.g. Trump impeachment 2026, Fed rate cut, Bitcoin ETF..."
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          onKeyDown={onKey}
        />
        <button className="btn btn-primary" onClick={fire} disabled={hunting}>
          {hunting ? "Hunting\u2026" : "Hunt \u2192"}
        </button>
      </div>
      <div className="quick-topics">
        {topics.map((t) => (
          <span key={t} className="topic-chip" onClick={() => setTopic(t)}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}
