"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAIDashboardRecommendations,
  getAIStatus,
  getHoldings,
  getPortfolioNewsImpact,
  getRecommendations,
  getRulebook,
  getSeries,
  getSummary,
  runRecommendations,
} from "@/lib/api";
import type {
  HoldingsSnapshot,
  NewsPortfolioImpact,
  PortfolioInsights,
  PortfolioSeriesRow,
  PortfolioSummary,
  Recommendation,
  Rulebook,
} from "@/lib/types";
import { MetricCard } from "@/components/MetricCard";
import { RecommendationCard } from "@/components/RecommendationCard";
import { RecommendationModal } from "@/components/RecommendationModal";
import { ValueChart } from "@/components/charts/ValueChart";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { AlphaChart } from "@/components/charts/AlphaChart";
import { VolatilityChart } from "@/components/charts/VolatilityChart";
import {
  bumpAIEpoch,
  getAIEpoch,
  readLatestAssistantInsights,
  readLatestDashboardRecommendations,
  readLatestNewsSummary,
  startGlobalAIPrewarm,
  writeLatestDashboardRecommendations,
} from "@/lib/ai-session";
import { useCurrency } from "@/lib/currency";
import { cn, fmt, fmtPct, signedClass } from "@/lib/utils";

const DEFAULT_RECOMMENDER_MODEL = "gpt-4o-mini";
const RECS_CACHE_PREFIX = "lnz_weekly_ai_recs_v2";
const TICKER_PATTERN = /\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/g;
const TICKER_STOPWORDS = new Set([
  "BUY",
  "SELL",
  "HOLD",
  "TRIM",
  "ADD",
  "USD",
  "CAD",
  "AI",
  "ETF",
  "ALL",
  "NOW",
]);
const POSITIVE_NEWS_WORDS = [
  "bullish",
  "upside",
  "tailwind",
  "strong",
  "beat",
  "upgrade",
  "positive",
  "outperform",
  "support",
];
const NEGATIVE_NEWS_WORDS = [
  "bearish",
  "downside",
  "headwind",
  "weak",
  "miss",
  "downgrade",
  "negative",
  "underperform",
  "risk",
  "pressure",
  "volatility",
];

type RecommendationSource = "Rules" | "AI";
type DashboardChartId = "value" | "drawdown" | "alpha" | "volatility";

const DASHBOARD_CHARTS: Array<{ id: DashboardChartId; title: string; subtitle: string }> = [
  {
    id: "value",
    title: "Portfolio Value vs Peak",
    subtitle: "Track equity curve and running peak.",
  },
  {
    id: "drawdown",
    title: "Drawdown vs Rulebook",
    subtitle: "Compare live drawdown to defensive and hard-stop levels.",
  },
  {
    id: "alpha",
    title: "Rolling Alpha",
    subtitle: "Weekly, rolling, and cumulative alpha context.",
  },
  {
    id: "volatility",
    title: "Rolling 8W Volatility",
    subtitle: "Portfolio volatility vs threshold budget.",
  },
];

interface WeeklyAIContext {
  summary: {
    date: string;
    row_count: number;
    total_value: number;
    regime: string;
    regime_explanation: string;
    drawdown: number;
    rolling_4w_alpha: number | null;
    rolling_8w_vol: number | null;
    beta_12w: number | null;
    cumulative_alpha: number;
  };
  series_tail: Array<{
    date: string;
    period_return: number;
    benchmark_return: number;
    alpha: number | null;
    rolling_4w_alpha: number | null;
    rolling_8w_vol: number | null;
    drawdown: number | null;
  }>;
  risk_profile: string;
  thresholds: Record<string, number | undefined>;
  holdings: Array<{
    ticker: string;
    name: string | null;
    weight: number | null;
    total_value: number | null;
    unrealized_pnl_pct: number | null;
    day_change_pct: number | null;
    shares: number;
  }>;
  holdings_totals: {
    total_value: number | null;
    total_cost_basis: number;
    total_unrealized_pnl_pct: number | null;
    total_day_change_pct: number | null;
  };
  top_news: Array<{
    id: string;
    headline: string;
    source: string;
    event_type: string;
    rank_score: number;
    portfolio_impact_score: number;
    impacted: string[];
  }>;
  top_impacted_holdings: Array<{
    ticker: string;
    impact_score: number;
    direction: "positive" | "negative" | "mixed";
    reason: string;
    weight: number | null;
  }>;
}

function inferRiskProfile(thresholds: Rulebook["thresholds"]): string {
  const concentration = Number(thresholds?.concentration_trim ?? 0.15);
  const hardStop = Number(thresholds?.drawdown_hard_stop ?? -0.1);
  if (concentration <= 0.11 || hardStop >= -0.09) return "Conservative";
  if (concentration <= 0.17 || hardStop >= -0.11) return "Balanced";
  return "Growth";
}

function clampConfidence(value: unknown): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

function normalizeRiskLevel(value: unknown): Recommendation["risk_level"] {
  const v = String(value ?? "").toLowerCase();
  if (v.startsWith("h")) return "High";
  if (v.startsWith("m")) return "Medium";
  return "Low";
}

function normalizeCategory(value: unknown): Recommendation["category"] {
  const v = String(value ?? "").toLowerCase();
  if (v.includes("profit") || v.includes("trim") || v.includes("take")) return "Profit Taking";
  if (v.includes("risk") || v.includes("drawdown") || v.includes("vol")) return "Risk Control";
  if (v.includes("news") || v.includes("macro")) return "News/Macro";
  if (v.includes("month")) return "Monthly Mode";
  return "Deployment";
}

function buildAIContext(
  summary: PortfolioSummary,
  series: PortfolioSeriesRow[],
  rulebook: Rulebook,
  holdings: HoldingsSnapshot,
  newsImpact: NewsPortfolioImpact,
): WeeklyAIContext {
  return {
    summary: {
      date: summary.date,
      row_count: summary.row_count,
      total_value: summary.total_value,
      regime: summary.regime,
      regime_explanation: summary.regime_explanation,
      drawdown: summary.drawdown,
      rolling_4w_alpha: summary.rolling_4w_alpha,
      rolling_8w_vol: summary.rolling_8w_vol,
      beta_12w: summary.beta_12w,
      cumulative_alpha: summary.cumulative_alpha,
    },
    series_tail: series.slice(-16).map((r) => ({
      date: r.date,
      period_return: r.period_return,
      benchmark_return: r.benchmark_return,
      alpha: r.alpha,
      rolling_4w_alpha: r.rolling_4w_alpha,
      rolling_8w_vol: r.rolling_8w_vol,
      drawdown: r.drawdown,
    })),
    risk_profile: inferRiskProfile(rulebook.thresholds),
    thresholds: rulebook.thresholds,
    holdings: [...holdings.holdings]
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .slice(0, 16)
      .map((h) => ({
        ticker: h.ticker,
        name: h.name,
        weight: h.weight,
        total_value: h.total_value,
        unrealized_pnl_pct: h.unrealized_pnl_pct,
        day_change_pct: h.day_change_pct,
        shares: h.shares,
      })),
    holdings_totals: {
      total_value: holdings.total_value,
      total_cost_basis: holdings.total_cost_basis,
      total_unrealized_pnl_pct: holdings.total_unrealized_pnl_pct,
      total_day_change_pct: holdings.total_day_change_pct,
    },
    top_news: newsImpact.events.slice(0, 20).map((e) => ({
      id: e.event.id,
      headline: e.event.headline,
      source: e.event.source,
      event_type: e.event.event_type,
      rank_score: e.rank_score,
      portfolio_impact_score: e.portfolio_impact_score,
      impacted: e.impacted_holdings.slice(0, 5).map((h) => h.ticker),
    })),
    top_impacted_holdings: newsImpact.top_impacted_holdings.slice(0, 12),
  };
}

function contextSignature(context: WeeklyAIContext): string {
  const holdingsSig = context.holdings
    .map((h) => `${h.ticker}:${Number(h.weight ?? 0).toFixed(4)}`)
    .join("|");
  const newsSig = context.top_news
    .slice(0, 12)
    .map((n) => `${n.id}:${n.rank_score.toFixed(3)}:${n.portfolio_impact_score.toFixed(3)}`)
    .join("|");
  return [
    context.summary.date,
    String(context.summary.row_count),
    context.summary.regime,
    context.risk_profile,
    holdingsSig,
    newsSig,
  ].join("::");
}

function cacheKey(signature: string): string {
  return `${RECS_CACHE_PREFIX}:e${getAIEpoch()}:${signature}`;
}

function readCachedRecommendations(signature: string): { recommendations: Recommendation[]; model: string } | null {
  try {
    const raw = window.sessionStorage.getItem(cacheKey(signature));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { recommendations?: Recommendation[]; model?: string };
    if (!Array.isArray(parsed.recommendations) || !parsed.model) return null;
    return { recommendations: parsed.recommendations, model: parsed.model };
  } catch {
    return null;
  }
}

function writeCachedRecommendations(signature: string, recommendations: Recommendation[], model: string): void {
  try {
    window.sessionStorage.setItem(cacheKey(signature), JSON.stringify({ recommendations, model }));
  } catch {
    // Ignore storage failures.
  }
}

function coerceRecommendations(raw: Record<string, unknown>): Recommendation[] {
  const list = Array.isArray(raw.recommendations)
    ? raw.recommendations
    : Array.isArray(raw.recs)
      ? raw.recs
      : [];
  const now = new Date().toISOString();

  const out: Recommendation[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;

    const title = String(row.title ?? "").trim();
    const explanation = String(row.explanation ?? "").trim();
    const actions = Array.isArray(row.actions)
      ? row.actions.map((a) => String(a)).filter(Boolean)
      : [];

    if (!title || !explanation || actions.length === 0) continue;

    const triggers = Array.isArray(row.triggers)
      ? row.triggers.map((t) => String(t)).filter(Boolean)
      : [];

    const supportingMetrics =
      row.supporting_metrics && typeof row.supporting_metrics === "object" && !Array.isArray(row.supporting_metrics)
        ? (row.supporting_metrics as Record<string, unknown>)
        : {};

    out.push({
      id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
      created_at: now,
      title,
      risk_level: normalizeRiskLevel(row.risk_level),
      category: normalizeCategory(row.category),
      triggers,
      explanation,
      supporting_metrics: supportingMetrics,
      actions,
      confidence: clampConfidence(row.confidence),
    });
  }

  return out.slice(0, 10);
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono text-muted">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.2s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.1s]" />
        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-bounce" />
      </span>
    </div>
  );
}

function extractTickerCandidates(text: string): string[] {
  const matches = text.toUpperCase().match(TICKER_PATTERN) ?? [];
  return matches.filter((token) => !TICKER_STOPWORDS.has(token));
}

function keywordScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((acc, word) => acc + (lower.includes(word) ? 1 : 0), 0);
}

export default function DashboardPage() {
  const { fromCad, currencyLabel } = useCurrency();
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [series, setSeries] = useState<PortfolioSeriesRow[]>([]);
  const [rulebook, setRulebook] = useState<Rulebook | null>(null);

  const [ruleRecs, setRuleRecs] = useState<Recommendation[]>([]);
  const [recs, setRecs] = useState<Recommendation[]>([]);
  const [recSource, setRecSource] = useState<RecommendationSource>("Rules");

  const [selectedRec, setSelectedRec] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runningRules, setRunningRules] = useState(false);
  const [holdingsSnapshot, setHoldingsSnapshot] = useState<HoldingsSnapshot | null>(null);
  const [newsImpact, setNewsImpact] = useState<NewsPortfolioImpact | null>(null);

  const [aiStatusReady, setAiStatusReady] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<string>("deterministic");
  const [aiError, setAiError] = useState<string | null>(null);

  const [aiContext, setAiContext] = useState<WeeklyAIContext | null>(null);
  const [latestDashboardSummary, setLatestDashboardSummary] = useState<{
    recommendations: Recommendation[];
    model: string;
  } | null>(null);
  const [latestNewsSummary, setLatestNewsSummary] = useState<{ text: string; model: string } | null>(null);
  const [latestAssistantSummary, setLatestAssistantSummary] = useState<
    (PortfolioInsights & { model_used?: string }) | null
  >(null);
  const [chartIndex, setChartIndex] = useState(0);
  const chartWheelLock = useRef(false);

  useEffect(() => {
    const syncCaches = () => {
      setLatestDashboardSummary(readLatestDashboardRecommendations());
      setLatestNewsSummary(readLatestNewsSummary());
      setLatestAssistantSummary(readLatestAssistantInsights());
    };
    syncCaches();
    const id = window.setInterval(syncCaches, 1200);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (aiEnabled) void startGlobalAIPrewarm();
  }, [aiEnabled]);

  const modeLabel = useMemo(() => {
    if (!aiStatusReady) return "Checking AI API status...";
    if (!aiEnabled) return "AI disabled - add OPENAI_API_KEY on backend";
    return `${aiProvider} (${aiModel ?? DEFAULT_RECOMMENDER_MODEL})`;
  }, [aiStatusReady, aiEnabled, aiModel, aiProvider]);

  const generateAIRecommendations = useCallback(
    async (context: WeeklyAIContext, force = false) => {
      const signature = contextSignature(context);
      if (!force) {
        const cached = readCachedRecommendations(signature);
        if (cached) {
          setRecs(cached.recommendations);
          setRecSource("AI");
          setAiModel(cached.model);
          setAiError(null);
          return;
        }
        const latest = readLatestDashboardRecommendations();
        if (latest) {
          setRecs(latest.recommendations);
          setRecSource("AI");
          setAiModel(latest.model);
          setAiError(null);
          return;
        }
      }
      if (!aiEnabled) {
        setAiError("AI API is disabled. Add OPENAI_API_KEY to backend and restart.");
        return;
      }

      setAiGenerating(true);
      setAiError(null);
      try {
        const apiPayload = await getAIDashboardRecommendations();
        const generated = apiPayload.recommendations;
        const model = apiPayload.model;
        if (!generated || generated.length === 0) throw new Error("No dashboard recommendations returned.");

        setRecs(generated);
        setRecSource("AI");
        setAiModel(model);
        setLatestDashboardSummary({ recommendations: generated, model });
        writeCachedRecommendations(signature, generated, model);
        writeLatestDashboardRecommendations(generated, model);
      } catch (e: unknown) {
        setAiError(
          e instanceof Error
            ? `AI recommendation generation failed: ${e.message}`
            : "AI recommendation generation failed.",
        );
      } finally {
        setAiGenerating(false);
      }
    },
    [],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setAiError(null);

    try {
      const [sum, ser, recommendations, rb, holdingsSnapshot, newsImpact] = await Promise.all([
        getSummary(),
        getSeries(),
        getRecommendations(),
        getRulebook(),
        getHoldings(),
        getPortfolioNewsImpact({ limit: 60, refresh: false }),
      ]);

      setSummary(sum);
      setSeries(ser);
      setRulebook(rb);
      setRuleRecs(recommendations);
      setRecs(recommendations);
      setRecSource("Rules");
      setHoldingsSnapshot(holdingsSnapshot);
      setNewsImpact(newsImpact);

      const context = buildAIContext(sum, ser, rb, holdingsSnapshot, newsImpact);
      setAiContext(context);

      const status = await getAIStatus().catch(() => null);
      const signedIn = Boolean(status?.ai_enabled);
      setAiStatusReady(true);
      setAiEnabled(signedIn);
      setAiProvider(status?.provider ?? "deterministic");

      if (signedIn) {
        void startGlobalAIPrewarm();
        void generateAIRecommendations(context, false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, [generateAIRecommendations]);

  useEffect(() => {
    load();
  }, [load]);

  const handleRunRules = async () => {
    setRunningRules(true);
    try {
      const newRecs = await runRecommendations();
      setRuleRecs(newRecs);
      if (recSource === "Rules") {
        setRecs(newRecs);
      }
    } catch (err) {
      setAiError(err instanceof Error ? err.message : "Failed to run rule engine");
    } finally {
      setRunningRules(false);
    }
  };

  const handleRefreshAI = async () => {
    if (!aiContext) return;
    setAiGenerating(true);
    setAiError(null);
    try {
      bumpAIEpoch();
      await startGlobalAIPrewarm(true);

      const latestDashboard = readLatestDashboardRecommendations();
      if (latestDashboard) {
        setRecs(latestDashboard.recommendations);
        setRecSource("AI");
        setAiModel(latestDashboard.model);
        setLatestDashboardSummary(latestDashboard);
      } else {
        await generateAIRecommendations(aiContext, true);
      }

      setLatestNewsSummary(readLatestNewsSummary());
      setLatestAssistantSummary(readLatestAssistantInsights());
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Failed to refresh all AI summaries.");
    } finally {
      setAiGenerating(false);
    }
  };

  const goToChart = useCallback((index: number) => {
    const total = DASHBOARD_CHARTS.length;
    setChartIndex((index + total) % total);
  }, []);

  const goToNextChart = useCallback(() => {
    setChartIndex((prev) => (prev + 1) % DASHBOARD_CHARTS.length);
  }, []);

  const goToPrevChart = useCallback(() => {
    setChartIndex((prev) => (prev - 1 + DASHBOARD_CHARTS.length) % DASHBOARD_CHARTS.length);
  }, []);

  const handleChartWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      if (Math.abs(event.deltaY) < 12 && Math.abs(event.deltaX) < 12) return;
      event.preventDefault();
      if (chartWheelLock.current) return;
      chartWheelLock.current = true;
      if (event.deltaY > 0 || event.deltaX > 0) {
        goToNextChart();
      } else {
        goToPrevChart();
      }
      window.setTimeout(() => {
        chartWheelLock.current = false;
      }, 320);
    },
    [goToNextChart, goToPrevChart],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-panel border border-border rounded-lg animate-pulse" />
          ))}
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <ThinkingIndicator label="Loading weekly dashboard context" />
        </div>
      </div>
    );
  }

  if (error || !summary || !rulebook) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted font-mono text-sm">{error ?? "No portfolio data found."}</p>
        <Link href="/import" className="text-accent font-mono text-sm hover:underline">
          Import your portfolio
        </Link>
      </div>
    );
  }

  const drawdownDefensive = rulebook.thresholds?.drawdown_defensive;
  const drawdownHardStop = rulebook.thresholds?.drawdown_hard_stop;
  const volThreshold = rulebook.thresholds?.vol8_high;
  const totalValueConverted = fromCad(summary.total_value);
  const valuePrefix = currencyLabel === "CAD" ? "CA$" : "US$";
  const totalValueDisplay =
    totalValueConverted == null
      ? "-"
      : `${valuePrefix}${new Intl.NumberFormat("en-CA", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(totalValueConverted)}`;

  const convertedSeries = series.map((r) => ({
    ...r,
    total_value: fromCad(r.total_value) ?? r.total_value,
    running_peak: r.running_peak != null ? (fromCad(r.running_peak) ?? r.running_peak) : null,
  }));

  const baseImpactRows =
    newsImpact?.top_impacted_holdings?.slice(0, 5).map((row) => ({
      ticker: row.ticker,
      reason: row.reason,
      conviction: Math.max(18, Math.min(95, Math.round(row.impact_score * 100))),
      direction: row.direction,
      source: "News Model",
    })) ?? [];

  const catalystRows =
    newsImpact?.events?.slice(0, 3).map((event) => ({
      headline: event.event.headline,
      ticker: event.impacted_holdings[0]?.ticker ?? "MKT",
      impact: event.portfolio_impact_score,
      direction:
        event.net_sentiment_impact == null
          ? "mixed"
          : event.net_sentiment_impact > 0
            ? "positive"
            : "negative",
    })) ?? [];

  const tapeRows =
    holdingsSnapshot?.holdings
      .slice()
      .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))
      .slice(0, 6)
      .map((holding) => ({
        ticker: holding.ticker,
        value: holding.day_change_pct ?? 0,
      })) ?? [];

  const allAISummariesReady = Boolean(
    aiEnabled && latestDashboardSummary && latestNewsSummary && latestAssistantSummary,
  );
  const aiSummaryRecommendationSet = latestDashboardSummary?.recommendations ?? [];
  const aiInsights = latestAssistantSummary;
  const newsSummaryText = latestNewsSummary?.text ?? "";

  const signalMap = new Map<
    string,
    { buy: number; sell: number; impact: number; reasons: Set<string>; sources: Set<string> }
  >();

  const addSignal = (ticker: string, buy: number, sell: number, impact: number, reason: string, source: string) => {
    if (!ticker) return;
    const key = ticker.toUpperCase();
    const current = signalMap.get(key) ?? {
      buy: 0,
      sell: 0,
      impact: 0,
      reasons: new Set<string>(),
      sources: new Set<string>(),
    };
    current.buy += buy;
    current.sell += sell;
    current.impact += impact;
    if (reason) current.reasons.add(reason);
    if (source) current.sources.add(source);
    signalMap.set(key, current);
  };

  if (allAISummariesReady) {
    for (const rec of aiSummaryRecommendationSet) {
      const lines = [rec.title, rec.explanation, ...rec.actions, ...rec.triggers];
      for (const line of lines) {
        const lower = line.toLowerCase();
        const buyIntent =
          lower.includes("buy") ||
          lower.includes("add") ||
          lower.includes("accumulate") ||
          lower.includes("initiate") ||
          lower.includes("overweight") ||
          lower.includes("long");
        const sellIntent =
          lower.includes("sell") ||
          lower.includes("trim") ||
          lower.includes("reduce") ||
          lower.includes("exit") ||
          lower.includes("underweight");
        if (!buyIntent && !sellIntent) continue;

        for (const ticker of extractTickerCandidates(line)) {
          const strength = 0.25 + rec.confidence * 0.75;
          addSignal(
            ticker,
            buyIntent ? strength : 0,
            sellIntent ? strength : 0,
            (buyIntent ? 0.2 : 0) - (sellIntent ? 0.2 : 0),
            rec.title,
            "Weekly AI",
          );
        }
      }
    }

    if (aiInsights) {
      for (const suggestion of aiInsights.suggestions ?? []) {
        const conf = Math.max(0.15, Math.min(1, suggestion.confidence));
        addSignal(
          suggestion.ticker,
          suggestion.action === "buy" ? conf * 1.15 : 0,
          suggestion.action === "sell" ? conf * 1.15 : 0,
          suggestion.action === "hold" ? conf * 0.25 : 0,
          suggestion.rationale,
          "Assistant",
        );
      }
      for (const ticker of aiInsights.watchlist ?? []) {
        addSignal(ticker, 0.22, 0, 0.12, "Assistant watchlist", "Assistant");
      }
      for (const riskLine of aiInsights.key_risks ?? []) {
        for (const ticker of extractTickerCandidates(riskLine)) {
          addSignal(ticker, 0, 0.28, -0.15, riskLine, "Assistant Risks");
        }
      }
      for (const opportunityLine of aiInsights.key_opportunities ?? []) {
        for (const ticker of extractTickerCandidates(opportunityLine)) {
          addSignal(ticker, 0.3, 0, 0.12, opportunityLine, "Assistant Opportunities");
        }
      }
    }

    for (const line of newsSummaryText.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
      const tickers = extractTickerCandidates(line);
      if (tickers.length === 0) continue;
      const pos = keywordScore(line, POSITIVE_NEWS_WORDS);
      const neg = keywordScore(line, NEGATIVE_NEWS_WORDS);
      const bias = pos === neg ? 0 : pos > neg ? 1 : -1;
      for (const ticker of tickers) {
        addSignal(
          ticker,
          bias > 0 ? 0.4 : 0,
          bias < 0 ? 0.4 : 0,
          bias * 0.2,
          line,
          "News AI",
        );
      }
    }
  }

  const holdingsTickerSet = new Set((holdingsSnapshot?.holdings ?? []).map((h) => h.ticker.toUpperCase()));
  const aiHoldingImpactRows = Array.from(signalMap.entries())
    .filter(([ticker]) => holdingsTickerSet.has(ticker))
    .map(([ticker, meta]) => {
      const net = meta.buy - meta.sell + meta.impact * 0.35;
      const magnitude = Math.abs(net) + Math.abs(meta.impact) * 0.4 + Math.max(meta.buy, meta.sell) * 0.25;
      const conviction = Math.max(18, Math.min(95, Math.round((1 - Math.exp(-magnitude)) * 100)));
      const direction: "positive" | "negative" | "mixed" = net > 0.08 ? "positive" : net < -0.08 ? "negative" : "mixed";
      return {
        ticker,
        reason: Array.from(meta.reasons)[0] ?? "Cross-summary AI signal aggregation.",
        conviction,
        direction,
        source: Array.from(meta.sources).join(" + "),
      };
    })
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, 5);

  const impactRows = allAISummariesReady ? aiHoldingImpactRows : baseImpactRows;

  const drawdownClass = summary.drawdown < 0 ? "text-negative" : "text-positive";
  const drawdownSubtitleParts = [
    typeof drawdownDefensive === "number" ? `Defensive ${fmtPct(drawdownDefensive, 1)}` : null,
    typeof drawdownHardStop === "number" ? `Hard stop ${fmtPct(drawdownHardStop, 1)}` : null,
  ].filter(Boolean);
  const drawdownSubtitle = drawdownSubtitleParts.length > 0 ? drawdownSubtitleParts.join(" • ") : undefined;

  const aiSignal =
    allAISummariesReady && aiSummaryRecommendationSet.length > 0
      ? aiSummaryRecommendationSet[0].explanation
      : recSource === "AI" && recs.length > 0
        ? recs[0].explanation
      : "Tilt into quality growth, trim cyclical beta if macro volatility accelerates.";

  const signalChips = impactRows.slice(0, 3).map((row) => {
    const action = row.direction === "positive" ? "BUY" : row.direction === "negative" ? "TRIM" : "HOLD";
    return `${action} ${row.ticker}`;
  });

  const watchlistRows = Array.from(signalMap.entries())
    .map(([ticker, meta]) => {
      const net = meta.buy - meta.sell + meta.impact * 0.35;
      const magnitude = Math.abs(net) + Math.max(meta.buy, meta.sell) * 0.3;
      const conviction = Math.max(20, Math.min(95, Math.round((1 - Math.exp(-magnitude)) * 100)));
      return {
        ticker,
        conviction,
        net,
        reason: Array.from(meta.reasons)[0] ?? "Cross-summary AI signal aggregation.",
        source: Array.from(meta.sources).join(" + "),
      };
    })
    .filter((row) => row.net > 0.05)
    .sort((a, b) => b.conviction - a.conviction)
    .slice(0, 6);
  const activeChart = DASHBOARD_CHARTS[chartIndex] ?? DASHBOARD_CHARTS[0];

  return (
    <div className="space-y-6">
      <section className="hf-card px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Weekly Alpha Command Center</h1>
            <p className="text-sm text-muted">
              Professional hedge fund monitoring across risk, execution, and alpha signals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-10 min-w-[220px] items-center gap-2 rounded-lg border border-border bg-[#101013] px-3 text-xs text-muted">
              <span className="text-neutral">⌕</span>
              <span>Search ticker or theme</span>
            </div>
            <div className="rounded-lg border border-border bg-[#101013] px-3 py-2 text-xs font-mono text-neutral">
              {summary.date}
            </div>
            <button
              onClick={load}
              className="rounded-lg border border-border bg-[#101013] px-3 py-2 text-xs font-medium text-white transition hover:bg-white/[0.03]"
            >
              Refresh
            </button>
            <Link
              href="/holdings"
              className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
            >
              New Allocation
            </Link>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <MetricCard label={`Total Value (${currencyLabel})`} value={totalValueDisplay} valueClass="text-accent" />
        <MetricCard
          label="Weekly Alpha vs SPY"
          value={fmtPct(summary.alpha_latest, 3)}
          valueClass={signedClass(summary.alpha_latest)}
        />
        <MetricCard
          label="4W Rolling Alpha"
          value={fmtPct(summary.rolling_4w_alpha, 2)}
          subValue={`Cumulative ${fmtPct(summary.cumulative_alpha, 2)}`}
          valueClass={signedClass(summary.rolling_4w_alpha)}
        />
        <MetricCard
          label="Current Drawdown"
          value={fmtPct(summary.drawdown, 2)}
          subValue={drawdownSubtitle}
          valueClass={drawdownClass}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-4">
        <div className="hf-card p-5">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-white">{activeChart.title}</h2>
              <p className="text-[11px] text-muted">{activeChart.subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={goToPrevChart}
                className="rounded-md border border-border bg-[#101013] px-2 py-1 text-[11px] font-medium text-neutral transition hover:bg-white/[0.03]"
              >
                Prev
              </button>
              <button
                onClick={goToNextChart}
                className="rounded-md border border-border bg-[#101013] px-2 py-1 text-[11px] font-medium text-neutral transition hover:bg-white/[0.03]"
              >
                Next
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-border bg-[#101013]" onWheel={handleChartWheel}>
            <div
              className="flex transition-transform duration-500 ease-out will-change-transform"
              style={{ transform: `translateX(-${chartIndex * 100}%)` }}
            >
              <div className="w-full shrink-0 p-3">
                <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-muted">Portfolio Value vs Peak</h3>
                <ValueChart data={convertedSeries} currencyLabel={currencyLabel} />
              </div>
              <div className="w-full shrink-0 p-3">
                <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-muted">Drawdown - Rulebook Thresholds</h3>
                <DrawdownChart
                  key={`carousel-dd-${String(drawdownDefensive)}-${String(drawdownHardStop)}`}
                  data={series}
                  defensiveThreshold={drawdownDefensive}
                  hardStopThreshold={drawdownHardStop}
                />
              </div>
              <div className="w-full shrink-0 p-3">
                <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-muted">Rolling Alpha</h3>
                <AlphaChart data={series} />
              </div>
              <div className="w-full shrink-0 p-3">
                <h3 className="mb-2 text-[11px] font-mono uppercase tracking-wider text-muted">Rolling 8W Volatility</h3>
                <VolatilityChart
                  key={`carousel-vol-${String(volThreshold)}`}
                  data={series}
                  volThreshold={volThreshold}
                />
              </div>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-[11px] text-muted">Scroll, swipe, or use arrows to cycle charts.</p>
            <div className="flex items-center gap-1.5">
              {DASHBOARD_CHARTS.map((chart, idx) => (
                <button
                  key={chart.id}
                  onClick={() => goToChart(idx)}
                  aria-label={`Go to ${chart.title}`}
                  className={cn(
                    "h-1.5 rounded-full transition-all duration-300",
                    idx === chartIndex ? "w-6 bg-accent" : "w-2 bg-border hover:bg-muted",
                  )}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="hf-card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Holdings Impact Matrix</h2>
            <span className="text-[11px] text-muted">Cross-summary AI impact</span>
          </div>
          <div className="mb-3 rounded-lg border border-border bg-[#101013] px-2.5 py-2">
            <p className="text-[10px] text-muted">
              Legend: <span className="text-positive">+conviction</span> positive portfolio impact,{" "}
              <span className="text-negative">-conviction</span> negative impact. Scores are 0-100 confidence.
            </p>
          </div>
          {aiEnabled && !allAISummariesReady ? (
            <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
              <ThinkingIndicator label="Waiting for all AI summaries before scoring impact matrix" />
            </div>
          ) : (
            <div className="space-y-2">
              {impactRows.length === 0 ? (
                <div className="rounded-lg border border-border bg-[#101013] px-3 py-2">
                  <p className="text-[11px] text-muted">No holdings impact signals detected in this AI cycle.</p>
                </div>
              ) : (
                impactRows.map((row) => (
                  <div
                    key={row.ticker + row.reason}
                    className="flex items-center justify-between rounded-lg border border-border bg-[#101013] px-3 py-2"
                  >
                    <div>
                      <p className="text-xs font-medium text-neutral">{row.ticker}</p>
                      <p className="text-[11px] text-muted line-clamp-1">{row.reason}</p>
                      <p className="text-[10px] text-muted">{row.source}</p>
                    </div>
                    <p
                      className={cn(
                        "text-xs font-mono font-medium",
                        row.direction === "negative" ? "text-negative" : row.direction === "positive" ? "text-positive" : "text-caution",
                      )}
                    >
                      {row.direction === "negative" ? "-" : row.direction === "positive" ? "+" : "±"}
                      {row.conviction}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-4">
        <div className="hf-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">Catalyst Monitor</h2>
            <span className="text-[11px] text-muted">Relevance x recency</span>
          </div>
          <div className="rounded-lg border border-border bg-[#101013]">
            <div className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-border px-3 py-2 text-[11px] font-semibold text-muted">
              <span>Headline</span>
              <span>Ticker</span>
              <span>Impact</span>
            </div>
            {(catalystRows.length > 0
              ? catalystRows
              : [
                  { headline: "US CPI cools; duration bid strengthens", ticker: "VFV", impact: 0.37, direction: "positive" as const },
                  { headline: "AI capex cycle extends into H2", ticker: "NVDA", impact: 0.54, direction: "positive" as const },
                  { headline: "Silver volatility spikes on real rates", ticker: "PHYS", impact: 0.18, direction: "negative" as const },
                ]
            ).map((row) => (
              <div key={row.headline} className="grid grid-cols-[1fr_auto_auto] gap-2 border-b border-border/70 px-3 py-2 text-xs last:border-b-0">
                <span className="line-clamp-1 text-neutral">{row.headline}</span>
                <span className="font-mono text-white">{row.ticker}</span>
                <span className={row.direction === "negative" ? "font-mono text-negative" : "font-mono text-positive"}>
                  {row.direction === "negative" ? "-" : "+"}
                  {fmt(row.impact, 2)}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <div className="hf-card p-5 space-y-3">
            <h2 className="text-sm font-semibold text-white">AI Allocation Signal</h2>
            <p className="text-xs text-neutral leading-relaxed">{aiSignal}</p>
            <div className="flex flex-wrap gap-2">
              {(signalChips.length > 0 ? signalChips : ["BUY NVDA", "HOLD VFV", "TRIM PHYS"]).map((chip) => (
                <span key={chip} className="rounded-full border border-border bg-[#101013] px-2.5 py-1 text-[11px] font-medium text-neutral">
                  {chip}
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#FF8A4C] animate-pulse [animation-delay:0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#FFB48C] animate-pulse [animation-delay:0.25s]" />
              <span>Adaptive model is continuously re-scoring</span>
            </div>
            <button
              onClick={handleRefreshAI}
              disabled={!aiEnabled || aiGenerating || !aiContext}
              className="w-full rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
            >
              {aiGenerating ? "Generating..." : "Run Scenario"}
            </button>
          </div>

          <div className="hf-card p-5 space-y-2">
            <h2 className="text-sm font-semibold text-white">AI Buy Watchlist</h2>
            <p className="text-[11px] text-muted">Generated only after dashboard, news, and assistant AI summaries are all ready.</p>
            {aiEnabled && !allAISummariesReady ? (
              <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
                <ThinkingIndicator label="Building buy watchlist from all AI summaries" />
              </div>
            ) : watchlistRows.length > 0 ? (
              watchlistRows.map((row) => (
                <div key={row.ticker + row.source} className="rounded-lg border border-border bg-[#101013] px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-semibold text-white">{row.ticker}</p>
                    <p className="text-[11px] font-mono text-accent">Conviction {row.conviction}/100</p>
                  </div>
                  <p className="mt-1 text-[10px] text-muted">{row.source}</p>
                  <p className="mt-1 text-[11px] text-neutral line-clamp-2">{row.reason}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-border bg-[#101013] px-3 py-2">
                <p className="text-[11px] text-muted">
                  {aiEnabled
                    ? "No positive buy signals across all AI summaries for this cycle."
                    : "Enable AI API to generate AI watchlist signals."}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="hf-card px-3 py-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full bg-positive/10 px-2.5 py-1 text-[11px] font-medium text-positive">
          <span className="h-1.5 w-1.5 rounded-full bg-positive hf-pulse-dot" />
          LIVE TAPE
        </span>
        {(tapeRows.length > 0
          ? tapeRows
          : [
              { ticker: "NVDA", value: 0.0207 },
              { ticker: "UNH", value: -0.0092 },
              { ticker: "MU", value: 0.0155 },
              { ticker: "VIX", value: 0.0018 },
            ]
        ).map((row) => (
          <span
            key={row.ticker}
            className={cn(
              "rounded-full px-2.5 py-1 text-[11px] font-mono font-medium",
              row.value < 0 ? "bg-negative/10 text-negative" : "bg-positive/10 text-positive",
            )}
          >
            {row.ticker} {row.value < 0 ? "" : "+"}
            {(row.value * 100).toFixed(2)}%
          </span>
        ))}
      </div>

      <section className="space-y-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-base font-semibold text-white">
            Recommendations
            <span className="ml-2 text-xs font-mono text-muted">{recs.length}</span>
            <span className="ml-2 text-[11px] font-mono text-muted">Source: {recSource}</span>
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono text-muted">{modeLabel}</span>
          <button
            onClick={handleRefreshAI}
            disabled={aiGenerating || !aiContext}
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {aiGenerating ? "Generating..." : "Refresh AI Recs"}
          </button>
          <button
            onClick={handleRunRules}
            disabled={runningRules}
            className="rounded-lg border border-border bg-[#101013] px-3 py-1.5 text-xs font-medium text-neutral transition hover:bg-white/[0.03] disabled:opacity-50"
          >
            {runningRules ? "Running Rules..." : "Run Rules"}
          </button>
        </div>

        {aiGenerating && <ThinkingIndicator label="Generating AI recommendations for alpha optimization" />}

        {aiError && (
          <div className="hf-card border-caution/40 p-3">
            <p className="text-xs font-mono text-caution">{aiError}</p>
          </div>
        )}

        {aiModel && recSource === "AI" && (
          <p className="text-[11px] font-mono text-muted">Active model: {aiModel}</p>
        )}

        {recs.length === 0 ? (
          <p className="text-sm text-muted py-4">
            No recommendations yet. Enable AI API and run AI recs, or run rule-based recompute.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recs.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} onClick={() => setSelectedRec(rec)} />
            ))}
          </div>
        )}
      </section>

      <RecommendationModal rec={selectedRec} onClose={() => setSelectedRec(null)} />
    </div>
  );
}
