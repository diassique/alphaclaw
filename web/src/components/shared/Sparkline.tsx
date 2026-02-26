interface Props {
  history: number[];
  width?: number;
  height?: number;
}

export function Sparkline({ history, width = 120, height = 24 }: Props) {
  if (!history || history.length < 2) return null;
  const min = Math.min(...history) * 0.95;
  const max = Math.max(...history) * 1.05 || 1;
  const range = max - min || 0.01;
  const pts = history
    .map((v, i) => {
      const x = (i / (history.length - 1)) * width;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const trending = history[history.length - 1]! >= history[0]!;
  const color = trending ? "var(--green)" : "var(--red)";

  return (
    <div className="rep-sparkline">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <polyline points={pts} stroke={color} />
      </svg>
    </div>
  );
}
