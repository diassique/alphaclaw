export function timeAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  return `${Math.floor(d / 3600)}h ago`;
}

export function shortAddr(addr: string | undefined | null): string {
  return addr ? addr.slice(0, 6) + "\u2026" + addr.slice(-4) : "\u2014";
}

export function shortHash(h: string | undefined | null): string {
  return h ? h.slice(0, 10) + "\u2026" : "\u2014";
}

export function formatMs(ms: number): string {
  const s = Math.round(ms / 1000);
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

export function latencyClass(ms: number): "fast" | "medium" | "slow" {
  if (ms < 100) return "fast";
  if (ms < 500) return "medium";
  return "slow";
}
