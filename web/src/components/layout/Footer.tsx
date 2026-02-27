import { Zap } from "lucide-react";

export function Footer() {
  return (
    <footer>
      <span>
        <Zap size={14} stroke="var(--accent2)" style={{ verticalAlign: "middle", marginRight: 2 }} />{" "}
        AlphaClaw Network &middot; Base Sepolia &middot; x402
      </span>
      <span>SURGE x OpenClaw Hackathon 2026</span>
    </footer>
  );
}
