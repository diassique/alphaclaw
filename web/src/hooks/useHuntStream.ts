import { useState, useCallback, useRef } from "react";
import type {
  HuntStartEvent,
  HuntPayingEvent,
  HuntResultEvent,
  HuntAlphaEvent,
  HuntStakingEvent,
  HuntCompetitionEvent,
  BreakdownSection,
  ACPConsensusResult,
  ACPSettlementResult,
  ACPAgentVote,
} from "../api/types.ts";

export interface LogEntry {
  time: string;
  cls: "ok" | "pay" | "alpha" | "err";
  icon: string;
  msg: string;
}

export interface HuntStreamState {
  hunting: boolean;
  logs: LogEntry[];
  alpha: HuntAlphaEvent | null;
  breakdown: BreakdownSection | null;
  staking: HuntStakingEvent | null;
  competition: HuntCompetitionEvent | null;
  acpConsensus: ACPConsensusResult | null;
  acpSettlement: ACPSettlementResult | null;
  acpVotes: ACPAgentVote[] | null;
  txLog: { service: string; txHash?: string; amount: string }[];
}

function now(): string {
  return new Date().toLocaleTimeString("en", { hour12: false });
}

export function useHuntStream() {
  const [state, setState] = useState<HuntStreamState>({
    hunting: false,
    logs: [],
    alpha: null,
    breakdown: null,
    staking: null,
    competition: null,
    acpConsensus: null,
    acpSettlement: null,
    acpVotes: null,
    txLog: [],
  });
  const esRef = useRef<EventSource | null>(null);

  const addLog = useCallback((cls: LogEntry["cls"], icon: string, msg: string) => {
    setState((s) => ({
      ...s,
      logs: [...s.logs, { time: now(), cls, icon, msg }],
    }));
  }, []);

  const startHunt = useCallback(
    (topic: string) => {
      if (esRef.current) esRef.current.close();

      setState({
        hunting: true,
        logs: [],
        alpha: null,
        breakdown: null,
        staking: null,
        competition: null,
        acpConsensus: null,
        acpSettlement: null,
        acpVotes: null,
        txLog: [],
      });

      const log = (cls: LogEntry["cls"], icon: string, msg: string) => {
        setState((s) => ({
          ...s,
          logs: [...s.logs, { time: now(), cls, icon, msg }],
        }));
      };

      log("ok", "\u26a1", `Starting hunt: "${topic}"`);

      const es = new EventSource(`/stream?topic=${encodeURIComponent(topic)}`);
      esRef.current = es;

      es.addEventListener("start", (e) => {
        const d = JSON.parse(e.data) as HuntStartEvent;
        log("ok", "\u26a1", `Coordinator online \u00b7 ${d.services} agents ready`);
      });

      es.addEventListener("paying", (e) => {
        const d = JSON.parse(e.data) as HuntPayingEvent;
        const mult = d.multiplier ? ` (${d.multiplier.toFixed(2)}x)` : "";
        log("pay", "\ud83d\udcb3", `Paying ${d.service} \u2026 ${d.amount} USDC${mult}`);
      });

      es.addEventListener("result", (e) => {
        const d = JSON.parse(e.data) as HuntResultEvent;
        const tx = d.txHash
          ? ` \u00b7 tx: ${d.txHash.slice(0, 10)}\u2026`
          : d.paid
            ? ""
            : " (demo)";
        log("ok", "\u2705", `${d.service} responded${tx}`);
        if (d.paid && d.txHash) {
          setState((s) => ({
            ...s,
            txLog: [{ service: d.service, txHash: d.txHash, amount: d.amount || "USDC" }, ...s.txLog],
          }));
        }
      });

      es.addEventListener("alpha", (e) => {
        const d = JSON.parse(e.data) as HuntAlphaEvent;
        log("alpha", "\ud83c\udfaf", `Alpha synthesis complete \u00b7 ${d.confidence} confidence`);
        setState((s) => ({ ...s, alpha: d, breakdown: d.breakdown ?? null }));
      });

      es.addEventListener("staking", (e) => {
        const d = JSON.parse(e.data) as HuntStakingEvent;
        log(
          "alpha",
          "\u2696\ufe0f",
          `Staking: ${d.consensus.toUpperCase()} \u00b7 ${d.totalStaked.toFixed(0)} staked \u2192 ${d.totalReturned.toFixed(0)} returned`,
        );
        setState((s) => ({ ...s, staking: d }));
      });

      es.addEventListener("competition", (e) => {
        const d = JSON.parse(e.data) as HuntCompetitionEvent;
        log("alpha", "\u2694\ufe0f", `Competition: ${d.winner} wins (${d.winnerRatio} vs ${d.loserRatio})`);
        setState((s) => ({ ...s, competition: d }));
      });

      es.addEventListener("acp:consensus", (e) => {
        const d = JSON.parse(e.data) as ACPConsensusResult;
        const strength = (d.strength * 100).toFixed(0);
        log("alpha", "\ud83e\udd1d", `ACP Consensus: ${d.direction.toUpperCase()} \u00b7 ${strength}% strength${d.unanimity ? " (unanimous)" : ""} \u00b7 ${d.quorum} agents`);
        setState((s) => ({ ...s, acpConsensus: d }));
      });

      es.addEventListener("acp:settle", (e) => {
        const d = JSON.parse(e.data) as ACPSettlementResult;
        const pnl = d.netPnl >= 0 ? `+${d.netPnl.toFixed(1)}` : d.netPnl.toFixed(1);
        log("alpha", "\u2696\ufe0f", `ACP Settlement: ${d.totalStaked.toFixed(0)} staked \u2192 ${d.totalReturned.toFixed(0)} returned (${pnl})${d.slashedAgents.length > 0 ? ` \u00b7 slashed: ${d.slashedAgents.join(", ")}` : ""}`);
        setState((s) => ({ ...s, acpSettlement: d }));
      });

      es.addEventListener("acp:votes", (e) => {
        const d = JSON.parse(e.data) as ACPAgentVote[];
        log("ok", "\ud83d\uddf3\ufe0f", `ACP Votes: ${d.length} agents voted`);
        setState((s) => ({ ...s, acpVotes: d }));
      });

      es.addEventListener("reputation", (e) => {
        try {
          const d = JSON.parse(e.data) as Record<string, { score: number }>;
          const entries = Object.entries(d);
          if (entries.length > 0) {
            const avg = entries.reduce((s, [, v]) => s + v.score, 0) / entries.length;
            log("ok", "\u2b50", `Reputation updated \u00b7 avg: ${(avg * 100).toFixed(0)}%`);
          }
        } catch { /* ignore */ }
      });

      es.addEventListener("settlement", (e) => {
        try {
          const d = JSON.parse(e.data) as { id: string; status: string };
          log("ok", "\ud83c\udfe6", `Settlement: ${d.id?.slice(0, 8) ?? "?"}\u2026 ${d.status}`);
        } catch { /* ignore */ }
      });

      es.addEventListener("cached", (e) => {
        const d = JSON.parse(e.data) as { reportId: string };
        log("ok", "\ud83d\udce6", `Report cached: ${d.reportId}`);
      });

      es.addEventListener("error", (e) => {
        try {
          const d = JSON.parse((e as MessageEvent).data) as { message: string };
          log("err", "\u274c", d.message);
        } catch {
          /* ignore */
        }
      });

      es.addEventListener("done", () => {
        es.close();
        esRef.current = null;
        log("ok", "\ud83c\udfc1", "Hunt complete");
        setState((s) => ({ ...s, hunting: false }));
      });

      es.onerror = () => {
        es.close();
        esRef.current = null;
        setState((s) => ({ ...s, hunting: false }));
      };
    },
    [addLog],
  );

  const stopHunt = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setState((s) => ({ ...s, hunting: false }));
  }, []);

  return { ...state, startHunt, stopHunt };
}
