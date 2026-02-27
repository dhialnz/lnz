"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getAIDashboardRecommendations,
  getAIStatus,
  getFearAndGreed,
  getHoldings,
  getPortfolioNewsImpact,
  getRecommendations,
  getRulebook,
  getSeries,
  getSummary,
  runRecommendations,
} from "@/lib/api";
import type {
  AIStatus,
  FearGreedData,
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
import { LLMText } from "@/components/LLMText";
import { ValueChart } from "@/components/charts/ValueChart";
import { DrawdownChart } from "@/components/charts/DrawdownChart";
import { AlphaChart } from "@/components/charts/AlphaChart";
import { VolatilityChart } from "@/components/charts/VolatilityChart";
import {
  getAIEpoch,
  readAIPrewarmState,
  readLatestAssistantInsights,
  readLatestDashboardRecommendations,
  readLatestNewsSummary,
  subscribeAIPrewarm,
  writeLatestDashboardRecommendations,
} from "@/lib/ai-session";
import { sanitizePortfolioInsights } from "@/lib/ai-format";
import { useCurrency } from "@/lib/currency";
import { cn, fmt, fmtPct, signedClass } from "@/lib/utils";

const DEFAULT_RECOMMENDER_MODEL = "gpt-4o-mini";
const RECS_CACHE_PREFIX = "lnz_weekly_ai_recs_v2";
const TICKER_PATTERN = /\b[A-Z]{1,5}(?:\.[A-Z]{1,2})?\b/g;
const TICKER_TOKEN_PATTERN = /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/;
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
  "THE",
  "FOR",
  "AND",
  "WITH",
  "FROM",
  "THIS",
  "THAT",
  "THEN",
  "WHEN",
  "WEEK",
  "IN",
  "ON",
  "AT",
  "OF",
  "TO",
  "BY",
  "OR",
  "AS",
  "ACT",
  "MONITOR",
  "RISK",
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
type RiskPressureLevel = "Low" | "Moderate" | "High" | "Critical";
type AIRiskBoardRow = {
  id: string;
  label: string;
  score: number;
  level: RiskPressureLevel;
  detail: string;
  catalyst: string;
};
type AIExecutionBucket = "Act Now" | "This Week" | "Monitor";
type AIExecutionRow = {
  id: string;
  ticker: string;
  action: "BUY" | "TRIM" | "HOLD";
  urgency: number;
  bucket: AIExecutionBucket;
  thesis: string;
  context: string;
  source: string;
};

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

function emptyHoldingsSnapshot(): HoldingsSnapshot {
  return {
    holdings: [],
    total_cost_basis: 0,
    total_value: null,
    total_unrealized_pnl: null,
    total_unrealized_pnl_pct: null,
    total_day_change: null,
    total_day_change_pct: null,
    total_week_change: null,
    total_week_change_pct: null,
    total_month_change: null,
    total_month_change_pct: null,
    total_year_change: null,
    total_year_change_pct: null,
    sharpe_30d: null,
    sortino_30d: null,
    as_of: new Date().toISOString(),
  };
}

function emptyNewsImpact(): NewsPortfolioImpact {
  return {
    generated_at: new Date().toISOString(),
    events: [],
    top_impacted_holdings: [],
  };
}

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

function fgColor(score: number): string {
  if (score < 25) return "text-negative";
  if (score < 45) return "text-caution";
  if (score < 56) return "text-muted";
  if (score < 76) return "text-positive";
  return "text-positive";
}

function fgBarColor(score: number): string {
  if (score < 25) return "bg-negative/70";
  if (score < 45) return "bg-[#F97316]/70";
  if (score < 56) return "bg-neutral/40";
  if (score < 76) return "bg-positive/60";
  return "bg-positive/80";
}

function fgDelta(current: number, previous: number | null): string | null {
  if (previous == null) return null;
  const d = current - previous;
  if (Math.abs(d) < 0.5) return null;
  return (d > 0 ? "+" : "") + d.toFixed(1);
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

function normalizeTickerToken(token: string, allowedTickers?: Set<string>): string | null {
  const normalized = String(token || "").trim().toUpperCase();
  if (!normalized) return null;
  if (!TICKER_TOKEN_PATTERN.test(normalized)) return null;
  if (TICKER_STOPWORDS.has(normalized) && !(allowedTickers && allowedTickers.has(normalized))) return null;
  if (allowedTickers && allowedTickers.size > 0 && !allowedTickers.has(normalized)) return null;
  return normalized;
}

function extractTickerCandidates(text: string, allowedTickers?: Set<string>): string[] {
  const matches = text.toUpperCase().match(TICKER_PATTERN) ?? [];
  const unique = new Set<string>();
  for (const token of matches) {
    const normalized = normalizeTickerToken(token, allowedTickers);
    if (normalized) unique.add(normalized);
  }
  return Array.from(unique);
}

function recommendationIntent(rec: Recommendation): "buy" | "sell" | "hold" | "neutral" {
  const corpus = [rec.title, rec.explanation, ...rec.actions, ...rec.triggers].join(" ").toLowerCase();
  if (/\b(sell|trim|reduce|exit|underweight)\b/.test(corpus)) return "sell";
  if (/\b(buy|add|accumulate|initiate|overweight|long)\b/.test(corpus)) return "buy";
  if (/\b(hold|maintain|keep)\b/.test(corpus)) return "hold";
  return "neutral";
}

function metricNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function recommendationPrimaryTicker(
  rec: Recommendation,
  allowedTickers?: Set<string>,
  holdingsTickers?: Set<string>,
): string | null {
  const metrics = rec.supporting_metrics ?? {};
  const validated = normalizeTickerToken(
    typeof metrics.validated_ticker === "string" ? metrics.validated_ticker : "",
    allowedTickers,
  );
  if (validated) return validated;

  const corpus = [rec.title, rec.explanation, ...rec.actions, ...rec.triggers].join(" ");

  const fromHoldings = holdingsTickers ? extractTickerCandidates(corpus, holdingsTickers)[0] : null;
  if (fromHoldings) return fromHoldings;

  const fromAllowed = extractTickerCandidates(corpus, allowedTickers)[0];
  if (fromAllowed) return fromAllowed;

  const fromTitle = extractTickerCandidates(rec.title, allowedTickers)[0];
  return fromTitle ?? null;
}

function keywordScore(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.reduce((acc, word) => acc + (lower.includes(word) ? 1 : 0), 0);
}

function clampScore(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function pressureLevel(score: number): RiskPressureLevel {
  if (score >= 85) return "Critical";
  if (score >= 67) return "High";
  if (score >= 40) return "Moderate";
  return "Low";
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
  const [fearGreed, setFearGreed] = useState<FearGreedData | null>(null);

  const [aiStatusReady, setAiStatusReady] = useState(false);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiGenerating, setAiGenerating] = useState(false);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<string>("deterministic");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPrewarmStarted, setAiPrewarmStarted] = useState(() => readAIPrewarmState().started);

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
  const loadRequestRef = useRef(0);

  useEffect(() => {
    const syncCaches = () => {
      setLatestDashboardSummary(readLatestDashboardRecommendations());
      setLatestNewsSummary(readLatestNewsSummary());
      setLatestAssistantSummary(sanitizePortfolioInsights(readLatestAssistantInsights()));
      setAiPrewarmStarted(readAIPrewarmState().started);
    };
    syncCaches();
    const unsubscribe = subscribeAIPrewarm((state) => {
      setAiPrewarmStarted(state.started);
      setLatestDashboardSummary(readLatestDashboardRecommendations());
      setLatestNewsSummary(readLatestNewsSummary());
      setLatestAssistantSummary(sanitizePortfolioInsights(readLatestAssistantInsights()));
      if (!state.started) {
        setRecs([]);
        setRecSource("AI");
        setAiModel(null);
        setAiError(null);
        setSelectedRec(null);
      }
    });
    const id = window.setInterval(syncCaches, 1200);
    return () => {
      window.clearInterval(id);
      unsubscribe();
    };
  }, []);
  const modeLabel = useMemo(() => {
    if (!aiStatusReady) return "Checking AI API status...";
    if (!aiEnabled) return "AI status unavailable";
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
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    setError(null);
    setAiError(null);
    setAiStatusReady(false);

    const pause = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));
    const fetchCore = async () =>
      Promise.all([getSummary(), getSeries(), getRecommendations(), getRulebook()]);

    try {
      let core: Awaited<ReturnType<typeof fetchCore>>;
      try {
        core = await fetchCore();
      } catch {
        // One immediate retry resolves transient startup/cold-path failures after refresh.
        await pause(450);
        core = await fetchCore();
      }

      if (requestId !== loadRequestRef.current) return;

      const [sum, ser, recommendations, rb] = core;
      setSummary(sum);
      setSeries(ser);
      setRulebook(rb);
      setRuleRecs(recommendations);
      setRecs(recommendations);
      setRecSource("Rules");
      setLoading(false);

      void (async () => {
        const [holdingsRes, newsRes, statusRes, fgRes] = await Promise.allSettled([
          getHoldings(),
          getPortfolioNewsImpact({ limit: 60, refresh: false }),
          getAIStatus(),
          getFearAndGreed(),
        ]);

        if (requestId !== loadRequestRef.current) return;

        const holdingsData =
          holdingsRes.status === "fulfilled" ? holdingsRes.value : emptyHoldingsSnapshot();
        const newsData = newsRes.status === "fulfilled" ? newsRes.value : emptyNewsImpact();
        const status: AIStatus | null = statusRes.status === "fulfilled" ? statusRes.value : null;
        if (fgRes.status === "fulfilled") setFearGreed(fgRes.value);

        setHoldingsSnapshot(holdingsData);
        setNewsImpact(newsData);

        const context = buildAIContext(sum, ser, rb, holdingsData, newsData);
        setAiContext(context);

        // If status probe is transiently unavailable, proceed optimistically and let AI endpoint decide.
        const signedIn = status ? Boolean(status.ai_enabled) : true;
        setAiStatusReady(true);
        setAiEnabled(signedIn);
        setAiProvider(status?.provider ?? "unknown");
        if (signedIn) void generateAIRecommendations(context, false);
      })();
    } catch (err) {
      if (requestId !== loadRequestRef.current) return;
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
      setLoading(false);
    }
  }, [generateAIRecommendations]);

  useEffect(() => {
    void load();
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
      await generateAIRecommendations(aiContext, true);
    } catch (e: unknown) {
      setAiError(e instanceof Error ? e.message : "Failed to refresh dashboard AI recommendations.");
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
  const aiSummariesStarted = Boolean(aiEnabled && aiPrewarmStarted);
  const aiPipelineReady = Boolean(aiSummariesStarted && allAISummariesReady);
  const aiSummaryRecommendationSet = latestDashboardSummary?.recommendations ?? [];
  const aiInsights = sanitizePortfolioInsights(latestAssistantSummary);
  const newsSummaryText = latestNewsSummary?.text ?? "";
  const holdingsByTicker = new Map(
    (holdingsSnapshot?.holdings ?? []).map((holding) => [holding.ticker.toUpperCase(), holding]),
  );
  const holdingsTickerSet = new Set(holdingsByTicker.keys());
  const dashboardValidatedTickerSet = new Set<string>();
  for (const rec of aiSummaryRecommendationSet) {
    const metrics = rec.supporting_metrics ?? {};
    const yahooValidated = metrics.yahoo_validation === true;
    if (!yahooValidated) continue;
    const ticker = normalizeTickerToken(typeof metrics.validated_ticker === "string" ? metrics.validated_ticker : "");
    if (ticker) dashboardValidatedTickerSet.add(ticker);
  }

  const newsTickerSet = new Set<string>();
  for (const row of newsImpact?.top_impacted_holdings ?? []) {
    const ticker = normalizeTickerToken(row.ticker);
    if (ticker) newsTickerSet.add(ticker);
  }
  for (const event of newsImpact?.events ?? []) {
    for (const row of event.impacted_holdings ?? []) {
      const ticker = normalizeTickerToken(row.ticker);
      if (ticker) newsTickerSet.add(ticker);
    }
  }

  const allowedDashboardTickerSet = new Set<string>(Array.from(holdingsTickerSet));
  dashboardValidatedTickerSet.forEach((ticker) => allowedDashboardTickerSet.add(ticker));
  newsTickerSet.forEach((ticker) => allowedDashboardTickerSet.add(ticker));

  const signalMap = new Map<
    string,
    { buy: number; sell: number; impact: number; reasons: Set<string>; sources: Set<string> }
  >();

  const addSignal = (ticker: string, buy: number, sell: number, impact: number, reason: string, source: string) => {
    const key = normalizeTickerToken(ticker, allowedDashboardTickerSet);
    if (!key) return;
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

        for (const ticker of extractTickerCandidates(line, allowedDashboardTickerSet)) {
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
        for (const ticker of extractTickerCandidates(riskLine, allowedDashboardTickerSet)) {
          addSignal(ticker, 0, 0.28, -0.15, riskLine, "Assistant Risks");
        }
      }
      for (const opportunityLine of aiInsights.key_opportunities ?? []) {
        for (const ticker of extractTickerCandidates(opportunityLine, allowedDashboardTickerSet)) {
          addSignal(ticker, 0.3, 0, 0.12, opportunityLine, "Assistant Opportunities");
        }
      }
    }

    for (const line of newsSummaryText.split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
      const tickers = extractTickerCandidates(line, allowedDashboardTickerSet);
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
    .slice(0, 8);

  const drawdownClass = summary.drawdown < 0 ? "text-negative" : "text-positive";
  const drawdownSubtitleParts = [
    typeof drawdownDefensive === "number" ? `Defensive ${fmtPct(drawdownDefensive, 1)}` : null,
    typeof drawdownHardStop === "number" ? `Hard stop ${fmtPct(drawdownHardStop, 1)}` : null,
  ].filter(Boolean);
  const drawdownSubtitle = drawdownSubtitleParts.length > 0 ? drawdownSubtitleParts.join(" • ") : undefined;

  const recommendationRows = aiPipelineReady
    ? aiSummaryRecommendationSet.length > 0
      ? aiSummaryRecommendationSet
      : recs
    : [];

  const maxWeightHolding = (holdingsSnapshot?.holdings ?? [])
    .slice()
    .sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0] ?? null;
  const concentrationLimit = Number(rulebook.thresholds?.concentration_trim ?? 0.15);
  const maxWeight = Number(maxWeightHolding?.weight ?? 0);
  const concentrationRatio = concentrationLimit > 0 ? maxWeight / concentrationLimit : 0;
  const concentrationScore = clampScore(
    concentrationRatio * 70 + (maxWeight > concentrationLimit ? 22 : 0),
    8,
    100,
  );

  const defensiveAbs = Math.abs(Number(drawdownDefensive ?? -0.07));
  const hardStopAbs = Math.abs(Number(drawdownHardStop ?? -0.1));
  const currentDrawdownAbs = Math.abs(Math.min(summary.drawdown, 0));
  let drawdownPressureScore = 15;
  if (currentDrawdownAbs >= hardStopAbs) {
    drawdownPressureScore = 98;
  } else if (currentDrawdownAbs >= defensiveAbs) {
    const span = Math.max(0.0001, hardStopAbs - defensiveAbs);
    drawdownPressureScore = 72 + ((currentDrawdownAbs - defensiveAbs) / span) * 22;
  } else {
    drawdownPressureScore = (currentDrawdownAbs / Math.max(0.0001, defensiveAbs)) * 66;
  }
  drawdownPressureScore = clampScore(drawdownPressureScore, 8, 100);

  const currentVol = summary.rolling_8w_vol;
  const volLimit = Number(volThreshold ?? 0.045);
  const volatilityScore =
    currentVol == null
      ? 28
      : clampScore(
          (volLimit > 0 ? currentVol / volLimit : 0) * 72 + (currentVol > volLimit ? 18 : 0),
          8,
          100,
        );

  const negativeNewsRows = (newsImpact?.top_impacted_holdings ?? []).filter(
    (row) => row.direction === "negative",
  );
  const negativeNewsMass = negativeNewsRows.reduce((acc, row) => acc + row.impact_score, 0);
  const negativeAIRows = aiHoldingImpactRows.filter((row) => row.direction === "negative");
  const avgNegativeAIConviction =
    negativeAIRows.length > 0
      ? negativeAIRows.reduce((acc, row) => acc + row.conviction, 0) / negativeAIRows.length
      : 0;
  const newsShockScore = clampScore(
    negativeNewsMass * 45 + avgNegativeAIConviction * 0.55 + (negativeNewsRows.length > 0 ? 8 : 0),
    10,
    100,
  );

  const topNegativeSignal = negativeAIRows[0] ?? null;
  const riskBoardRows: AIRiskBoardRow[] = [
    {
      id: "concentration",
      label: "Concentration Pressure",
      score: concentrationScore,
      level: pressureLevel(concentrationScore),
      detail:
        maxWeightHolding != null
          ? `${maxWeightHolding.ticker} ${fmtPct(maxWeightHolding.weight, 1)} vs trim ${fmtPct(concentrationLimit, 1)}`
          : `No holdings yet. Trim threshold ${fmtPct(concentrationLimit, 1)}.`,
      catalyst: topNegativeSignal != null &&
        maxWeightHolding != null &&
        topNegativeSignal.ticker === maxWeightHolding.ticker
        ? topNegativeSignal.reason
        : "Sourced from holdings weights and rulebook concentration threshold.",
    },
    {
      id: "drawdown",
      label: "Drawdown Pressure",
      score: drawdownPressureScore,
      level: pressureLevel(drawdownPressureScore),
      detail: `Current ${fmtPct(summary.drawdown, 2)} | Defensive ${fmtPct(drawdownDefensive, 1)} | Hard stop ${fmtPct(drawdownHardStop, 1)}`,
      catalyst: aiInsights?.key_risks?.[0] ?? "Sourced from drawdown and rulebook stop levels.",
    },
    {
      id: "volatility",
      label: "Volatility Pressure",
      score: volatilityScore,
      level: pressureLevel(volatilityScore),
      detail:
        currentVol != null
          ? `Rolling 8W vol ${fmtPct(currentVol, 2)} vs cap ${fmtPct(volThreshold, 2)}`
          : "Rolling 8W volatility not available yet.",
      catalyst: aiInsights?.key_risks?.find((line) => line.toLowerCase().includes("vol")) ??
        "Sourced from rolling volatility budget in the risk playbook.",
    },
    {
      id: "news",
      label: "News Shock Pressure",
      score: newsShockScore,
      level: pressureLevel(newsShockScore),
      detail:
        negativeNewsRows.length > 0
          ? `${negativeNewsRows.length} holdings under negative catalyst pressure this cycle`
          : "No high-conviction negative catalyst clusters in this cycle.",
      catalyst: topNegativeSignal?.reason ?? negativeNewsRows[0]?.reason ?? "Sourced from news AI + holdings exposure map.",
    },
  ];
  const riskCompositeScore = clampScore(
    riskBoardRows.reduce((sum, row) => sum + row.score, 0) / riskBoardRows.length,
    0,
    100,
  );

  const aiExecutionRows: AIExecutionRow[] = recommendationRows
    .map((rec, index) => {
      const ticker = recommendationPrimaryTicker(rec, allowedDashboardTickerSet, holdingsTickerSet) ?? "PORT";
      const intent = recommendationIntent(rec);
      const action: AIExecutionRow["action"] = intent === "sell" ? "TRIM" : intent === "buy" ? "BUY" : "HOLD";
      const impactSignal = aiHoldingImpactRows.find((row) => row.ticker === ticker) ?? null;
      const holding = holdingsByTicker.get(ticker) ?? null;

      let urgency =
        (action === "TRIM" ? 74 : action === "BUY" ? 62 : 44) +
        Math.round(clampConfidence(rec.confidence) * 24);
      if (rec.category === "Risk Control") urgency += 8;
      if (rec.risk_level === "High") urgency += 6;
      if (rec.risk_level === "Medium") urgency += 3;
      if (impactSignal?.direction === "negative" && action === "TRIM") urgency += 8;
      if (impactSignal?.direction === "positive" && action === "BUY") urgency += 8;
      urgency = clampScore(urgency, 12, 99);

      const bucket: AIExecutionBucket = urgency >= 85 ? "Act Now" : urgency >= 68 ? "This Week" : "Monitor";
      const contextBits: string[] = [];
      if (holding?.weight != null) contextBits.push(`Weight ${fmtPct(holding.weight, 1)}`);
      if (impactSignal) {
        contextBits.push(
          `${impactSignal.direction === "negative" ? "Risk" : impactSignal.direction === "positive" ? "Tailwind" : "Mixed"} ${impactSignal.conviction}/100`,
        );
      }
      if (rec.category) contextBits.push(rec.category);
      if (!holding && action === "BUY") contextBits.push("New candidate");

      return {
        id: `${ticker}-${index}`,
        ticker,
        action,
        urgency,
        bucket,
        thesis: rec.explanation,
        context: contextBits.join(" • "),
        source: impactSignal?.source ? `Dashboard AI + ${impactSignal.source}` : "Dashboard AI",
      };
    })
    .sort((a, b) => b.urgency - a.urgency)
    .slice(0, 8);
  const executionActNow = aiExecutionRows.filter((row) => row.bucket === "Act Now").length;
  const executionThisWeek = aiExecutionRows.filter((row) => row.bucket === "This Week").length;
  const executionMonitor = aiExecutionRows.filter((row) => row.bucket === "Monitor").length;

  const watchlistRecommendationSource = aiPipelineReady ? aiSummaryRecommendationSet : [];
  const allowedWatchlistTickerSet = new Set<string>(Array.from(allowedDashboardTickerSet));
  const watchlistCandidateMap = new Map<
    string,
    {
      ticker: string;
      conviction: number;
      reason: string;
      source: string;
      technical: string;
      fundamental: string;
      validated: boolean;
      signal: number;
    }
  >();
  const upsertWatchlistCandidate = (candidate: {
    ticker: string;
    conviction: number;
    reason: string;
    source: string;
    technical?: string;
    fundamental?: string;
    validated?: boolean;
  }) => {
    const normalizedTicker = normalizeTickerToken(candidate.ticker, allowedWatchlistTickerSet);
    if (!normalizedTicker) return;

    const conviction = Math.max(20, Math.min(95, Math.round(candidate.conviction)));
    const validated = candidate.validated === true;
    const signal = conviction + (validated ? 14 : 0);
    const existing = watchlistCandidateMap.get(normalizedTicker);
    if (!existing || signal > existing.signal || (validated && !existing.validated)) {
      watchlistCandidateMap.set(normalizedTicker, {
        ticker: normalizedTicker,
        conviction,
        reason: candidate.reason,
        source: candidate.source,
        technical: candidate.technical ?? existing?.technical ?? "",
        fundamental: candidate.fundamental ?? existing?.fundamental ?? "",
        validated,
        signal,
      });
    }
  };

  for (const rec of watchlistRecommendationSource) {
    if (recommendationIntent(rec) !== "buy") continue;
    const metrics = rec.supporting_metrics ?? {};
    const ticker = recommendationPrimaryTicker(rec, allowedWatchlistTickerSet, holdingsTickerSet);
    if (!ticker) continue;

    const rsi14 = metricNumber(metrics.rsi14);
    const ma20GapPct = metricNumber(metrics.ma20_gap_pct);
    const momentum20Pct = metricNumber(metrics.momentum_20d_pct);
    const trailingPe = metricNumber(metrics.trailing_pe);
    const forwardPe = metricNumber(metrics.forward_pe);

    const technical: string[] = [];
    if (rsi14 != null) technical.push(`RSI14 ${rsi14.toFixed(1)}`);
    if (ma20GapPct != null) technical.push(`vs MA20 ${fmtPct(ma20GapPct, 2)}`);
    if (momentum20Pct != null) technical.push(`20d ${fmtPct(momentum20Pct, 2)}`);

    const fundamental: string[] = [];
    if (trailingPe != null) fundamental.push(`P/E ${trailingPe.toFixed(1)}`);
    if (forwardPe != null) fundamental.push(`Fwd P/E ${forwardPe.toFixed(1)}`);

    const yahooValidated = metrics.yahoo_validation === true;
    upsertWatchlistCandidate({
      ticker,
      conviction: rec.confidence * 100,
      reason: rec.explanation,
      source: yahooValidated ? "Dashboard AI + Yahoo" : "Dashboard AI (pending Yahoo)",
      technical: technical.join(" • "),
      fundamental: fundamental.join(" • "),
      validated: yahooValidated,
    });
  }

  for (const suggestion of aiInsights?.suggestions ?? []) {
    if (suggestion.action !== "buy") continue;
    upsertWatchlistCandidate({
      ticker: suggestion.ticker,
      conviction: (suggestion.confidence ?? 0.5) * 100,
      reason: suggestion.rationale || "Copilot flagged this as a buy candidate.",
      source: "AI Copilot",
      fundamental:
        suggestion.portfolio_fit_score != null
          ? `Portfolio fit ${Math.max(0, Math.min(100, Math.round(suggestion.portfolio_fit_score)))}/100`
          : "",
      validated: false,
    });
  }

  for (const ticker of aiInsights?.watchlist ?? []) {
    upsertWatchlistCandidate({
      ticker,
      conviction: 56,
      reason: "Included in AI Copilot watchlist after full context scan.",
      source: "AI Copilot Watchlist",
      validated: false,
    });
  }

  for (const row of (newsImpact?.top_impacted_holdings ?? []).filter((x) => x.direction === "positive").slice(0, 8)) {
    upsertWatchlistCandidate({
      ticker: row.ticker,
      conviction: row.impact_score * 55 + 28,
      reason: row.reason || "Positive portfolio-impact news catalyst.",
      source: "News Flow",
      validated: false,
    });
  }

  const watchlistRows = Array.from(watchlistCandidateMap.values())
    .sort((a, b) => Number(b.validated) - Number(a.validated) || b.conviction - a.conviction)
    .slice(0, 6);
  const activeChart = DASHBOARD_CHARTS[chartIndex] ?? DASHBOARD_CHARTS[0];

  return (
    <div className="space-y-6">
      <section className="hf-card px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <span className="hf-label">Weekly Dashboard</span>
            <h1 className="hf-display text-4xl leading-none text-white">Alpha Command Center</h1>
            <p className="text-sm text-muted">
              Professional hedge fund monitoring across risk, execution, and alpha signals.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110"
            >
              <span className="text-sm leading-none font-light">+</span> Add Position
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
              <div className="w-full shrink-0 px-4 pt-3 pb-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted">Portfolio Value vs Peak</h3>
                  <span className="text-[11px] font-mono text-accent">{totalValueDisplay}</span>
                </div>
                <ValueChart data={convertedSeries} currencyLabel={currencyLabel} />
              </div>
              <div className="w-full shrink-0 px-4 pt-3 pb-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted">Drawdown vs Rulebook</h3>
                  <span className={cn("text-[11px] font-mono", drawdownClass)}>{fmtPct(summary.drawdown, 2)}</span>
                </div>
                <DrawdownChart
                  key={`carousel-dd-${String(drawdownDefensive)}-${String(drawdownHardStop)}`}
                  data={series}
                  defensiveThreshold={drawdownDefensive}
                  hardStopThreshold={drawdownHardStop}
                />
              </div>
              <div className="w-full shrink-0 px-4 pt-3 pb-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted">Rolling Alpha</h3>
                  <span className={cn("text-[11px] font-mono", signedClass(summary.rolling_4w_alpha))}>
                    {fmtPct(summary.rolling_4w_alpha, 2)} 4w
                  </span>
                </div>
                <AlphaChart data={series} />
              </div>
              <div className="w-full shrink-0 px-4 pt-3 pb-4">
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-[11px] font-mono uppercase tracking-wider text-muted">Rolling 8W Volatility</h3>
                  {summary.rolling_8w_vol != null && (
                    <span className="text-[11px] font-mono text-caution">{fmtPct(summary.rolling_8w_vol, 2)}</span>
                  )}
                </div>
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
            <h2 className="text-sm font-semibold text-white">AI Portfolio Risk Board</h2>
            <span className="text-[11px] text-muted">Pipeline-synced pressure scan</span>
          </div>
          {aiEnabled && !aiPipelineReady ? (
            <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
              <ThinkingIndicator label="Waiting for all AI summaries before building risk board" />
            </div>
          ) : !aiEnabled ? (
            <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
              <p className="text-[11px] text-muted">Enable AI API and run the AI pipeline to unlock risk board diagnostics.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              <div className="rounded-lg border border-border bg-[#101013] px-3 py-2.5">
                <div className="mb-1.5 flex items-center justify-between">
                  <p className="text-[11px] text-muted">Composite Portfolio Pressure</p>
                  <p
                    className={cn(
                      "text-xs font-mono font-semibold",
                      pressureLevel(riskCompositeScore) === "Critical"
                        ? "text-negative"
                        : pressureLevel(riskCompositeScore) === "High"
                          ? "text-caution"
                          : pressureLevel(riskCompositeScore) === "Moderate"
                            ? "text-accent"
                            : "text-positive",
                    )}
                  >
                    {riskCompositeScore}/100
                  </p>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-[#1b1b1f]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all duration-500",
                      pressureLevel(riskCompositeScore) === "Critical"
                        ? "bg-negative"
                        : pressureLevel(riskCompositeScore) === "High"
                          ? "bg-caution"
                          : pressureLevel(riskCompositeScore) === "Moderate"
                            ? "bg-accent"
                            : "bg-positive",
                    )}
                    style={{ width: `${riskCompositeScore}%` }}
                  />
                </div>
              </div>
              {riskBoardRows.map((row) => (
                <div key={row.id} className="rounded-lg border border-border bg-[#101013] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-neutral">{row.label}</p>
                    <p
                      className={cn(
                        "text-[11px] font-mono font-semibold",
                        row.level === "Critical"
                          ? "text-negative"
                          : row.level === "High"
                            ? "text-caution"
                            : row.level === "Moderate"
                              ? "text-accent"
                              : "text-positive",
                      )}
                    >
                      {row.level} {row.score}
                    </p>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[#1b1b1f]">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-500",
                        row.level === "Critical"
                          ? "bg-negative"
                          : row.level === "High"
                            ? "bg-caution"
                            : row.level === "Moderate"
                              ? "bg-accent"
                              : "bg-positive",
                      )}
                      style={{ width: `${row.score}%` }}
                    />
                  </div>
                  <p className="mt-1.5 text-[10px] text-muted">{row.detail}</p>
                  <p className="mt-1 text-[10px] text-neutral line-clamp-2">{row.catalyst}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1.7fr_1fr] gap-4">
        <div className="hf-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white">AI Execution Queue</h2>
            <span className="text-[11px] text-muted">Priority actions from full AI pipeline context</span>
          </div>
          {aiEnabled && !aiPipelineReady ? (
            <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
              <ThinkingIndicator label="Waiting for all AI summaries before building execution queue" />
            </div>
          ) : !aiEnabled ? (
            <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
              <p className="text-[11px] text-muted">Enable AI API and run the AI pipeline to unlock execution priorities.</p>
            </div>
          ) : aiExecutionRows.length === 0 ? (
            <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
              <p className="text-[11px] text-muted">No actionable AI queue items generated for this cycle yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg border border-negative/30 bg-negative/10 px-2.5 py-2 text-center">
                  <p className="text-[10px] text-negative">Act Now</p>
                  <p className="text-sm font-mono text-white">{executionActNow}</p>
                </div>
                <div className="rounded-lg border border-caution/30 bg-caution/10 px-2.5 py-2 text-center">
                  <p className="text-[10px] text-caution">This Week</p>
                  <p className="text-sm font-mono text-white">{executionThisWeek}</p>
                </div>
                <div className="rounded-lg border border-border bg-[#101013] px-2.5 py-2 text-center">
                  <p className="text-[10px] text-muted">Monitor</p>
                  <p className="text-sm font-mono text-white">{executionMonitor}</p>
                </div>
              </div>
              <div className="rounded-lg border border-border bg-[#101013]">
                {aiExecutionRows.map((row) => (
                  <div
                    key={row.id}
                    className="border-b border-border/70 px-3 py-2.5 last:border-b-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "rounded-md px-1.5 py-0.5 text-[10px] font-semibold",
                            row.action === "TRIM"
                              ? "bg-negative/20 text-negative"
                              : row.action === "BUY"
                                ? "bg-positive/20 text-positive"
                                : "bg-caution/20 text-caution",
                          )}
                        >
                          {row.action}
                        </span>
                        <p className="text-xs font-semibold text-white">{row.ticker}</p>
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-0.5 text-[10px] font-mono",
                            row.bucket === "Act Now"
                              ? "bg-negative/15 text-negative"
                              : row.bucket === "This Week"
                                ? "bg-caution/15 text-caution"
                                : "bg-border text-muted",
                          )}
                        >
                          {row.bucket}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-accent">Urgency {row.urgency}</p>
                    </div>
                    <p className="mt-1 text-[11px] text-neutral line-clamp-2">{row.thesis}</p>
                    {row.context ? <p className="mt-1 text-[10px] text-muted line-clamp-1">{row.context}</p> : null}
                    <p className="mt-1 text-[10px] text-muted">{row.source}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="hf-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Market Sentiment</h2>
              <span className="text-[10px] font-mono text-muted">CNN Fear &amp; Greed</span>
            </div>
            {fearGreed ? (
              <>
                {/* Score + label */}
                <div className="flex items-end gap-3">
                  <span className={cn("text-4xl font-bold tabular-nums leading-none", fgColor(fearGreed.score))}>
                    {Math.round(fearGreed.score)}
                  </span>
                  <span className={cn("text-sm font-semibold pb-0.5", fgColor(fearGreed.score))}>
                    {fearGreed.rating}
                  </span>
                </div>
                {/* Gauge bar */}
                <div className="space-y-1">
                  <div className="relative h-2.5 w-full rounded-full bg-[#101013] overflow-hidden">
                    {/* Gradient track: red → orange → gray → green */}
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{
                        background:
                          "linear-gradient(to right, #EF4444 0%, #F97316 25%, #6B7280 45%, #6B7280 55%, #22C55E 75%, #16A34A 100%)",
                        opacity: 0.25,
                      }}
                    />
                    {/* Filled portion */}
                    <div
                      className={cn("h-full rounded-full transition-all duration-700", fgBarColor(fearGreed.score))}
                      style={{ width: `${fearGreed.score}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[9px] text-muted/60 font-mono">
                    <span>Extreme Fear</span>
                    <span>Neutral</span>
                    <span>Extreme Greed</span>
                  </div>
                </div>
                {/* Deltas */}
                <div className="flex gap-4 text-[11px]">
                  {fgDelta(fearGreed.score, fearGreed.previous_close) && (
                    <span className="text-muted">
                      vs yesterday{" "}
                      <span className={cn("font-mono font-medium", fearGreed.score >= (fearGreed.previous_close ?? fearGreed.score) ? "text-positive" : "text-negative")}>
                        {fgDelta(fearGreed.score, fearGreed.previous_close)}
                      </span>
                    </span>
                  )}
                  {fgDelta(fearGreed.score, fearGreed.previous_1_week) && (
                    <span className="text-muted">
                      vs 1w{" "}
                      <span className={cn("font-mono font-medium", fearGreed.score >= (fearGreed.previous_1_week ?? fearGreed.score) ? "text-positive" : "text-negative")}>
                        {fgDelta(fearGreed.score, fearGreed.previous_1_week)}
                      </span>
                    </span>
                  )}
                </div>
              </>
            ) : (
              <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
                <ThinkingIndicator label="Fetching CNN Fear & Greed Index" />
              </div>
            )}
            <div className="flex items-center gap-2 text-[11px] text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
              <span>Real-time market sentiment — not portfolio-specific</span>
            </div>
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
                    <div className="flex items-center gap-2">
                      <p className="text-xs font-semibold text-white">{row.ticker}</p>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[10px] font-mono",
                          row.validated
                            ? "bg-positive/15 text-positive"
                            : "bg-caution/15 text-caution",
                        )}
                      >
                        {row.validated ? "Yahoo validated" : "Pending validation"}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-accent">Conviction {row.conviction}/100</p>
                  </div>
                  <p className="mt-1 text-[10px] text-muted">{row.source}</p>
                  {row.technical ? <p className="mt-1 text-[10px] text-caution">{row.technical}</p> : null}
                  {row.fundamental ? <p className="mt-1 text-[10px] text-muted">{row.fundamental}</p> : null}
                  <p className="mt-1 text-[11px] text-neutral">{row.reason}</p>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-border bg-[#101013] px-3 py-2">
                <p className="text-[11px] text-muted">
                  {aiEnabled
                    ? "No buy candidates surfaced across dashboard, assistant, and news summaries for this cycle."
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
            <span className="ml-2 text-xs font-mono text-muted">{recommendationRows.length}</span>
            {aiPipelineReady ? <span className="ml-2 text-[11px] font-mono text-muted">Source: {recSource}</span> : null}
          </h2>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] font-mono text-muted">{modeLabel}</span>
          <button
            onClick={handleRefreshAI}
            disabled={aiGenerating || !aiContext || !aiPipelineReady}
            className="rounded-lg border border-accent/40 bg-accent/10 px-3 py-1.5 text-xs font-medium text-accent transition hover:bg-accent/20 disabled:opacity-50"
          >
            {aiGenerating ? "Generating..." : "Refresh AI Recs"}
          </button>
          <button
            onClick={handleRunRules}
            disabled={runningRules || (aiEnabled && !aiPipelineReady)}
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

        {aiEnabled && !aiPipelineReady ? (
          <div className="rounded-lg border border-border bg-[#101013] px-3 py-3">
            <ThinkingIndicator label="Waiting for all AI summaries before generating recommendations" />
          </div>
        ) : !aiEnabled ? (
          <p className="text-sm text-muted py-4">
            Enable AI API and run the AI pipeline to generate recommendations.
          </p>
        ) : recommendationRows.length === 0 ? (
          <p className="text-sm text-muted py-4">
            No recommendations generated for this AI cycle yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {recommendationRows.map((rec) => (
              <RecommendationCard key={rec.id} rec={rec} onClick={() => setSelectedRec(rec)} />
            ))}
          </div>
        )}
      </section>

      <RecommendationModal rec={selectedRec} onClose={() => setSelectedRec(null)} />
    </div>
  );
}
