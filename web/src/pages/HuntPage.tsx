import { useState, useEffect, useCallback } from "react";
import { api } from "../api/client.ts";
import { useHuntStream } from "../hooks/useHuntStream.ts";
import { PageHeader } from "../components/shared/PageHeader.tsx";
import { HuntBox } from "../components/shared/HuntBox.tsx";
import { StreamLog } from "../components/shared/StreamLog.tsx";
import { shortHash } from "../lib/utils.ts";
import { SERVICE_LABELS } from "../lib/constants.ts";
import type {
  PingResponse,
  DynamicPrice,
  HuntAlphaEvent,
  HuntStakingEvent,
  HuntCompetitionEvent,
  BreakdownSection,
  StakeResult,
  ACPConsensusResult,
  ACPSettlementResult,
  ACPAgentVote,
} from "../api/types.ts";

// ─── Sub-components ──────────────────────────────────────────────────────────

function PricingTable({ pricing, totalBuyCost }: { pricing: DynamicPrice[]; totalBuyCost: string }) {
  return (
    <div className="panel" style={{ marginBottom: "2rem" }}>
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
          {pricing.map((p) => (
            <tr key={p.service}>
              <td style={{ color: "var(--text)" }}>{SERVICE_LABELS[p.service] ?? p.service}</td>
              <td>{p.basePrice}</td>
              <td style={{ color: "var(--accent2)" }}>{p.effectivePrice}</td>
              <td>{p.multiplier.toFixed(2)}x</td>
              <td>{(p.reputation * 100).toFixed(0)}%</td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--border2)" }}>
            <td style={{ color: "var(--text)", fontWeight: 700 }}>Total</td>
            <td />
            <td style={{ color: "var(--green)", fontWeight: 700 }}>{totalBuyCost}</td>
            <td />
            <td />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function AlphaResult({ alpha }: { alpha: HuntAlphaEvent }) {
  return (
    <div className="alpha-result" style={{ display: "block", marginBottom: "2rem" }}>
      <div className="alpha-header">
        <div className="alpha-rec">{alpha.recommendation}</div>
        <div className="alpha-conf">
          Confidence: {alpha.confidence}
          {alpha.weightedConfidence != null && ` (weighted: ${alpha.weightedConfidence.toFixed(1)}%)`}
        </div>
      </div>
      <div className="alpha-signals">
        {alpha.signals.map((s) => (
          <span key={s} className="signal-tag">{s}</span>
        ))}
      </div>
    </div>
  );
}

function BreakdownPanel({ breakdown }: { breakdown: BreakdownSection }) {
  const hasContent =
    breakdown.news || breakdown.sentiment || breakdown.polymarket || breakdown.defi || breakdown.whale;
  if (!hasContent) return null;

  return (
    <div className="panel" style={{ marginBottom: "2rem" }}>
      <div className="section-title" style={{ marginBottom: "1rem" }}>Signal Breakdown</div>

      {breakdown.news && (
        <div className="info-card">
          <div style={{ fontWeight: 600, fontSize: ".85rem", marginBottom: ".5rem", color: "var(--accent2)" }}>
            News
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Top headline</span>
            <span className="breakdown-val">{breakdown.news.topHeadline}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Articles</span>
            <span className="breakdown-val">{breakdown.news.articleCount}</span>
          </div>
        </div>
      )}

      {breakdown.sentiment && (
        <div className="info-card">
          <div style={{ fontWeight: 600, fontSize: ".85rem", marginBottom: ".5rem", color: "var(--accent2)" }}>
            Sentiment
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Label</span>
            <span className="breakdown-val">{breakdown.sentiment.label}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Score</span>
            <span className="breakdown-val">{breakdown.sentiment.score}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Confidence</span>
            <span className="breakdown-val">{breakdown.sentiment.confidence}</span>
          </div>
        </div>
      )}

      {breakdown.polymarket && (
        <div className="info-card">
          <div style={{ fontWeight: 600, fontSize: ".85rem", marginBottom: ".5rem", color: "var(--accent2)" }}>
            Polymarket
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Market</span>
            <span className="breakdown-val">{breakdown.polymarket.market}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Signal</span>
            <span className="breakdown-val">{breakdown.polymarket.signal}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">YES price</span>
            <span className="breakdown-val">{breakdown.polymarket.yesPrice}</span>
          </div>
        </div>
      )}

      {breakdown.defi && (
        <div className="info-card">
          <div style={{ fontWeight: 600, fontSize: ".85rem", marginBottom: ".5rem", color: "var(--accent2)" }}>
            DeFi
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Asset</span>
            <span className="breakdown-val">{breakdown.defi.asset}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Action</span>
            <span className="breakdown-val">{breakdown.defi.action}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">24h change</span>
            <span className="breakdown-val">{breakdown.defi.change24h}</span>
          </div>
        </div>
      )}

      {breakdown.whale && (
        <div className="info-card">
          <div style={{ fontWeight: 600, fontSize: ".85rem", marginBottom: ".5rem", color: "var(--accent2)" }}>
            Whale Activity
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Signal</span>
            <span className="breakdown-val">{breakdown.whale.signal}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Whale count</span>
            <span className="breakdown-val">{breakdown.whale.whaleCount}</span>
          </div>
          <div className="breakdown-item">
            <span className="breakdown-key">Total volume</span>
            <span className="breakdown-val">{breakdown.whale.totalVolume}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function StakingCard({ staking }: { staking: HuntStakingEvent }) {
  return (
    <div className="stake-card visible">
      <div className="stake-header">
        <span className="stake-title">Staking Results</span>
        <span className={`consensus-badge consensus-${staking.consensus}`}>
          {staking.consensus.toUpperCase()}
        </span>
      </div>
      {staking.results.map((r: StakeResult) => (
        <div className="stake-row" key={r.service}>
          <span className="stake-svc">{SERVICE_LABELS[r.service] ?? r.service}</span>
          <span className={`stake-dir ${r.direction}`}>{r.direction}</span>
          <span className="stake-num">{r.staked.toFixed(0)}</span>
          <span className={`stake-num ${r.correct ? "stake-correct" : "stake-incorrect"}`}>
            {r.correct ? "+" : ""}
            {(r.returned - r.staked).toFixed(1)}
          </span>
          <span className="stake-num">{(r.reputationAfter * 100).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function ACPCard({ consensus, settlement, votes }: { consensus: ACPConsensusResult; settlement?: ACPSettlementResult | null; votes?: ACPAgentVote[] | null }) {
  const dirColor = consensus.direction === "bullish" ? "var(--green)" : consensus.direction === "bearish" ? "var(--red)" : "var(--text3)";
  return (
    <div className="panel" style={{ marginBottom: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".75rem" }}>
        <div style={{ fontWeight: 700, fontSize: ".85rem", color: "var(--text)" }}>
          ACP Consensus
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
          <span style={{ color: dirColor, fontWeight: 700, fontSize: ".85rem", textTransform: "uppercase" }}>
            {consensus.direction}
          </span>
          {consensus.unanimity && (
            <span style={{ fontSize: ".65rem", background: "var(--green)", color: "#000", borderRadius: 4, padding: "1px 5px", fontWeight: 600 }}>
              UNANIMOUS
            </span>
          )}
        </div>
      </div>

      {/* Strength bar */}
      <div style={{ marginBottom: ".75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: ".65rem", color: "var(--text3)", marginBottom: 2 }}>
          <span>Consensus Strength</span>
          <span>{(consensus.strength * 100).toFixed(0)}%</span>
        </div>
        <div style={{ background: "var(--bg3)", borderRadius: 4, height: 6, overflow: "hidden" }}>
          <div style={{
            width: `${consensus.strength * 100}%`,
            height: "100%",
            background: consensus.strength > 0.7 ? "var(--green)" : consensus.strength > 0.4 ? "var(--yellow, #eab308)" : "var(--red)",
            borderRadius: 4,
          }} />
        </div>
      </div>

      {/* Weight breakdown */}
      <div style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", marginBottom: votes ? ".75rem" : 0 }}>
        {Object.entries(consensus.weightBreakdown).sort((a, b) => b[1] - a[1]).map(([dir, weight]) => {
          const total = Object.values(consensus.weightBreakdown).reduce((s, v) => s + v, 0) || 1;
          return (
            <div key={dir} style={{
              flex: `${weight / total}`,
              minWidth: 50,
              background: dir === "bullish" ? "var(--green)" : dir === "bearish" ? "var(--red)" : "var(--text3)",
              borderRadius: 6,
              padding: ".25rem .4rem",
              textAlign: "center",
              fontSize: ".65rem",
              fontWeight: 700,
              color: "#000",
            }}>
              {dir} {((weight / total) * 100).toFixed(0)}%
            </div>
          );
        })}
      </div>

      {/* Votes grid */}
      {votes && votes.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: ".4rem", marginBottom: settlement ? ".75rem" : 0 }}>
          {votes.map((v) => (
            <div key={v.key} style={{
              background: "var(--bg3)",
              border: `1px solid ${v.agreedWithConsensus ? "var(--green)" : "var(--red)"}`,
              borderRadius: 6,
              padding: ".3rem .5rem",
              fontSize: ".65rem",
              fontFamily: "var(--mono)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span style={{ fontWeight: 700, color: "var(--text)" }}>{SERVICE_LABELS[v.key] ?? v.key}</span>
                <span style={{ color: v.direction === "bullish" ? "var(--green)" : v.direction === "bearish" ? "var(--red)" : "var(--text3)", fontWeight: 600 }}>{v.direction}</span>
              </div>
              <div style={{ color: "var(--text3)" }}>w: {v.weight.toFixed(1)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Settlement */}
      {settlement && (
        <div style={{ display: "flex", gap: "1rem", fontSize: ".7rem", fontFamily: "var(--mono)", color: "var(--text3)" }}>
          <span>Staked: {settlement.totalStaked.toFixed(0)}</span>
          <span>Returned: {settlement.totalReturned.toFixed(0)}</span>
          <span style={{ color: settlement.netPnl >= 0 ? "var(--green)" : "var(--red)", fontWeight: 700 }}>
            Net: {settlement.netPnl >= 0 ? "+" : ""}{settlement.netPnl.toFixed(1)}
          </span>
          {settlement.slashedAgents.length > 0 && (
            <span style={{ color: "var(--red)" }}>Slashed: {settlement.slashedAgents.join(", ")}</span>
          )}
        </div>
      )}
    </div>
  );
}

function CompetitionCard({ competition }: { competition: HuntCompetitionEvent }) {
  const v1IsWinner = competition.winner === "sentiment";
  return (
    <div className="comp-card visible">
      <div className="comp-header">Sentiment Agent Competition</div>
      <div className="comp-matchup">
        <div className={`comp-agent ${v1IsWinner ? "winner" : "loser"}`}>
          <div className="comp-agent-name">Sentiment v1</div>
          <div className="comp-agent-ratio">
            {v1IsWinner ? competition.winnerRatio : competition.loserRatio}
          </div>
        </div>
        <div className="comp-vs">VS</div>
        <div className={`comp-agent ${v1IsWinner ? "loser" : "winner"}`}>
          <div className="comp-agent-name">Sentiment v2</div>
          <div className="comp-agent-ratio">
            {v1IsWinner ? competition.loserRatio : competition.winnerRatio}
          </div>
        </div>
      </div>
      <div className="comp-reason">{competition.reason}</div>
    </div>
  );
}

interface TxEntry {
  service: string;
  txHash?: string;
  amount: string;
}

function PaymentLog({ txLog }: { txLog: TxEntry[] }) {
  if (txLog.length === 0) return null;
  return (
    <div className="tx-feed" style={{ display: "block" }}>
      <div className="tx-header">
        <span className="tx-title">Payment Log</span>
        <span className="badge badge-green" style={{ fontSize: ".7rem" }}>
          <span className="dot" /> Base Sepolia
        </span>
      </div>
      {txLog.map((tx, i) => (
        <div className="tx-item" key={i}>
          <span className="tx-dir">OUT</span>
          <span className="tx-addr">{tx.service}</span>
          <span className="tx-hash">{shortHash(tx.txHash)}</span>
          <span className="tx-amount">{tx.amount || "USDC"}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export function HuntPage() {
  // SSE hunt stream
  const { hunting, logs, alpha, breakdown, staking, competition, acpConsensus, acpSettlement, acpVotes, txLog, startHunt } =
    useHuntStream();

  // Dynamic pricing (loaded once on mount)
  const [pricing, setPricing] = useState<DynamicPrice[]>([]);
  const [totalBuyCost, setTotalBuyCost] = useState("$0.039");

  useEffect(() => {
    api<PingResponse>("/ping")
      .then((d) => {
        setPricing(d.dynamicPricing ?? []);
        setTotalBuyCost(d.totalBuyCost);
      })
      .catch(() => {});
  }, []);

  // Track whether we ever started hunting for showing sections
  const [hasHunted, setHasHunted] = useState(false);
  useEffect(() => {
    if (hunting) setHasHunted(true);
  }, [hunting]);

  const handleHunt = useCallback(
    (topic: string) => {
      startHunt(topic);
    },
    [startHunt],
  );

  return (
    <>
      <PageHeader description="Query all 5 data sources simultaneously, synthesize intelligence, and get actionable alpha.">
        <span>Hunt</span> Alpha
      </PageHeader>

      {/* Hunt Form */}
      <HuntBox onHunt={handleHunt} hunting={hunting} />

      {/* Dynamic Pricing */}
      <div className="section-title">Dynamic Pricing</div>
      {pricing.length > 0 ? (
        <PricingTable pricing={pricing} totalBuyCost={totalBuyCost} />
      ) : (
        <div className="panel" style={{ marginBottom: "2rem" }}>
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
              <tr>
                <td colSpan={5} style={{ textAlign: "center", color: "var(--text3)" }}>
                  Loading pricing...
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Live Stream */}
      <div className="section-title">Live Stream</div>
      {hasHunted ? (
        <div style={{ marginBottom: "2rem" }}>
          <StreamLog logs={logs} maxHeight="500px" />
        </div>
      ) : (
        <div
          style={{
            color: "var(--text3)",
            fontSize: ".85rem",
            padding: "2rem",
            textAlign: "center",
            background: "var(--bg2)",
            border: "1px solid var(--border)",
            borderRadius: "12px",
            marginBottom: "2rem",
          }}
        >
          Run a hunt to see the live event stream
        </div>
      )}

      {/* Alpha Result */}
      {alpha && <AlphaResult alpha={alpha} />}

      {/* Signal Breakdown */}
      {breakdown && <BreakdownPanel breakdown={breakdown} />}

      {/* Staking Results */}
      {staking && <StakingCard staking={staking} />}

      {/* ACP Consensus */}
      {acpConsensus && <ACPCard consensus={acpConsensus} settlement={acpSettlement} votes={acpVotes} />}

      {/* Competition */}
      {competition && <CompetitionCard competition={competition} />}

      {/* Payment Log */}
      <PaymentLog txLog={txLog} />
    </>
  );
}
