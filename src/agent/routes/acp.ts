import type { Application } from "express";
import { getACPStatus, getACPRound, getSlashLog, getRewardLog, getAgentACPStats } from "../acp.js";
import { ACP_VERSION, ACP_HEADERS } from "../../types/index.js";

export function registerACPRoutes(app: Application): void {
  app.get("/acp/status", (_req, res) => {
    res.json(getACPStatus());
  });

  app.get("/acp/round/:id", (req, res) => {
    const round = getACPRound(req.params["id"] ?? "");
    if (!round) { res.status(404).json({ error: "round not found" }); return; }
    res.json(round);
  });

  app.get("/acp/slashes", (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
    res.json({ slashes: getSlashLog(limit) });
  });

  app.get("/acp/rewards", (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(String(req.query["limit"] ?? "50"), 10) || 50));
    res.json({ rewards: getRewardLog(limit) });
  });

  app.get("/acp/agent/:key", (req, res) => {
    const stats = getAgentACPStats(req.params["key"] ?? "");
    if (!stats) { res.status(404).json({ error: "agent not found in ACP" }); return; }
    res.json(stats);
  });

  app.get("/acp/spec", (_req, res) => {
    res.json({
      protocol: "Alpha Consensus Protocol",
      version: ACP_VERSION,
      headers: ACP_HEADERS,
      phases: [
        { name: "collect", description: "Parse X-ACP-* headers from service responses; fallback to direction/confidence extraction" },
        { name: "consensus", description: "Weighted vote using effectiveStake * reputation; direction with highest weight wins" },
        { name: "settle", description: "Slash agents against consensus, reward those aligned; bonus/penalty for high-confidence bets" },
      ],
      staking: {
        maxStake: 100,
        effectiveStakeFormula: "min(declaredStake, MAX_STAKE * reputation)",
        weightFormula: "effectiveStake * reputation",
      },
      slashingRules: [
        { rule: "Against consensus", trigger: "direction != consensus", slash: "50% of stake * confidence", repImpact: -0.08 },
        { rule: "With consensus", trigger: "direction == consensus", reward: "+30% of stake * confidence", repImpact: +0.05 },
        { rule: "High confidence wrong", trigger: "wrong AND confidence > 0.7", extraSlash: "20% of stake", extraRepImpact: -0.05 },
        { rule: "High confidence correct", trigger: "correct AND confidence > 0.7", extraReward: "15% of stake", extraRepImpact: +0.03 },
      ],
      endpoints: {
        "GET /acp/status": "Protocol stats, leaderboard, recent rounds",
        "GET /acp/round/:id": "Individual round detail",
        "GET /acp/slashes": "Slash event log (query: limit)",
        "GET /acp/rewards": "Reward event log (query: limit)",
        "GET /acp/agent/:key": "Agent-specific ACP stats",
        "GET /acp/spec": "This specification",
      },
    });
  });
}
