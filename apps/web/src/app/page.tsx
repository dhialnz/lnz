"use client";

import { useState, useEffect } from "react";
import { getSummary, getSeries, getRecommendations, runRecommendations } from "@/lib/api";
import type { PortfolioSummary, PortfolioSeriesRow, Recommendation } from "@/lib/types";
import { MetricCard } from "@/components/MetricCard";
import { RegimeBadge } from "@/components/RegimeBadge";
import { RecommendationCard } from "@/components/RecommendationCard";
import { RecommendationModal } from "@/components/RecommendationModal";
import { ValueChart } from "@/components/charts/ValueChart";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { AlphaChart } from "@/components/charts/AlphaChart";
import { VolatilityChart } from "@/components/charts/VolatilityChart";
import { fmtCurrency, fmtPct, fmt, signedClass } from "@/lib/utils";
import Link from "next/link";

export default function DashboardPage() {
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [series, setSeries] = useState<PortfolioSeriesRow[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const [sum, ser, recommendations] = await Promise.all([
          getSummary(),
          getSeries(),
          getRecommendations(),
        ]);
        setSummary(sum);
        setSeries(ser);
        setRecs(recommendations);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleRunRecs = async () => {
    setRunning(true);
    try {
      const newRecs = await runRecommendations();
      setRecs(newRecs);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to run recommendations");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted font-mono text-sm">
        Loading…
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted font-mono text-sm">
          {error ?? "No portfolio data found."}
        </p>
        <Link
          href="/import"
          className="text-accent font-mono text-sm hover:underline"
        >
          → Import your portfolio
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">Dashboard</h1>
          <p className="text-xs font-mono text-muted mt-0.5">
            As of {summary.date} · {summary.row_count} weekly observations
          </p>
        </div>
        <RegimeBadge regime={summary.regime} explanation={summary.regime_explanation} large />
      </div>

      {/* Key metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <MetricCard
          label="Total Value"
          value={fmtCurrency(summary.total_value)}
          valueClass="text-accent"
        />
        <MetricCard
          label="4w Alpha"
          value={fmtPct(summary.rolling_4w_alpha, 3)}
          valueClass={signedClass(summary.rolling_4w_alpha)}
        />
        <MetricCard
          label="Drawdown"
          value={fmtPct(summary.drawdown, 2)}
          subValue={`Max: ${fmtPct(summary.max_drawdown, 2)}`}
          valueClass={signedClass(summary.drawdown)}
        />
        <MetricCard
          label="8w Vol"
          value={fmtPct(summary.rolling_8w_vol, 3)}
          valueClass={
            summary.rolling_8w_vol != null && summary.rolling_8w_vol > 0.04
              ? "text-caution"
              : "text-gray-100"
          }
        />
        <MetricCard
          label="Beta (12w)"
          value={summary.beta_12w != null ? fmt(summary.beta_12w, 3) : "—"}
        />
        <MetricCard
          label="Cum. Alpha"
          value={fmtPct(summary.cumulative_alpha, 3)}
          valueClass={signedClass(summary.cumulative_alpha)}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-xs font-mono text-muted uppercase tracking-wider mb-3">
            Portfolio Value vs Peak
          </h2>
          <ValueChart data={series} />
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-xs font-mono text-muted uppercase tracking-wider mb-3">
            Drawdown — Reference lines: −8% / −10%
          </h2>
          <DrawdownChart data={series} />
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-xs font-mono text-muted uppercase tracking-wider mb-3">
            Rolling Alpha (weekly / 4w / cumulative)
          </h2>
          <AlphaChart data={series} />
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-xs font-mono text-muted uppercase tracking-wider mb-3">
            Rolling 8w Volatility — threshold 4%
          </h2>
          <VolatilityChart data={series} />
        </div>
      </div>

      {/* Recommendations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-100">
            Recommendations
            <span className="ml-2 text-xs font-mono text-muted">{recs.length}</span>
          </h2>
          <button
            onClick={handleRunRecs}
            disabled={running}
            className="text-xs font-mono bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {running ? "Running…" : "↻ Recompute"}
          </button>
        </div>
        {recs.length === 0 ? (
          <p className="text-muted font-mono text-sm py-4">
            No recommendations yet. Click Recompute to run the rule engine.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recs.map((rec) => (
              <RecommendationCard
                key={rec.id}
                rec={rec}
                onClick={() => setSelectedRec(rec)}
              />
            ))}
          </div>
        )}
      </div>

      <RecommendationModal rec={selectedRec} onClose={() => setSelectedRec(null)} />
    </div>
  );
}
