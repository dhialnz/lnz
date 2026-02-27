"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatAI, getAIStatus, getPortfolioInsights } from "@/lib/api";
import type {
  AIChatMessage,
  AISuggestion,
  PortfolioInsights,
  SuggestionSignalType,
} from "@/lib/types";
import {
  readAIPrewarmState,
  readLatestAssistantInsights,
  subscribeAIPrewarm,
  writeLatestAssistantInsights,
} from "@/lib/ai-session";
import { sanitizePortfolioInsights } from "@/lib/ai-format";
import { cn } from "@/lib/utils";
import { LLMText } from "@/components/LLMText";

type SuggestionTone = "buy" | "hold" | "sell";
type SuggestionFilter = "all" | SuggestionSignalType;

function pipelineWaitingLabel(): string {
  const state = readAIPrewarmState();
  if (!state.started) return "";
  if (state.assistant_ready) return "";
  if (state.completed && !state.assistant_ready) {
    return "AI pipeline partial: generating copilot summary...";
  }
  if (!state.dashboard_ready || !state.news_ready) {
    return "AI pipeline running: preparing upstream summaries for copilot...";
  }
  return "AI pipeline running: preparing AI copilot summary...";
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs font-mono text-muted">
      <span>{label}</span>
      <span className="inline-flex items-center gap-1">
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" />
      </span>
    </div>
  );
}

function TypedLLMText({
  text,
  animate,
  onDone,
  className,
  lineClassName,
}: {
  text: string;
  animate: boolean;
  onDone?: () => void;
  className?: string;
  lineClassName?: string;
}) {
  const [visibleChars, setVisibleChars] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      setVisibleChars(text.length);
      return;
    }

    let done = false;
    let shown = 0;
    const stepSize = Math.max(3, Math.ceil(text.length / 140)); // accelerated typewriter feel

    const interval = window.setInterval(() => {
      shown = Math.min(text.length, shown + stepSize);
      setVisibleChars(shown);
      if (shown >= text.length && !done) {
        done = true;
        window.clearInterval(interval);
        onDone?.();
      }
    }, 12);

    setVisibleChars(0);
    return () => {
      window.clearInterval(interval);
    };
  }, [animate, onDone, text]);

  return (
    <LLMText
      text={text.slice(0, visibleChars)}
      className={className}
      lineClassName={lineClassName}
    />
  );
}

const SIGNAL_LABEL: Record<string, string> = {
  momentum: "Momentum",
  fundamental: "Fundamental",
  news: "News",
  regime: "Regime",
  concentration: "Concentration",
  diversification: "Diversification",
  stop_loss: "Stop-Loss",
  profit_taking: "Profit-Taking",
  steady: "Steady",
};

const HORIZON_LABEL: Record<string, string> = {
  short: "0-4 wks",
  medium: "1-3 mo",
  long: "6+ mo",
};

const SIGNAL_PRIORITY_BY_TONE: Record<SuggestionTone, Record<SuggestionSignalType, number>> = {
  sell: {
    stop_loss: 1.0,
    concentration: 0.95,
    profit_taking: 0.9,
    news: 0.85,
    momentum: 0.75,
    regime: 0.65,
    fundamental: 0.6,
    diversification: 0.45,
    steady: 0.4,
  },
  hold: {
    steady: 1.0,
    fundamental: 0.9,
    regime: 0.85,
    news: 0.75,
    momentum: 0.7,
    diversification: 0.65,
    profit_taking: 0.55,
    concentration: 0.45,
    stop_loss: 0.35,
  },
  buy: {
    diversification: 1.0,
    regime: 0.92,
    fundamental: 0.9,
    momentum: 0.85,
    news: 0.7,
    steady: 0.6,
    profit_taking: 0.45,
    concentration: 0.35,
    stop_loss: 0.25,
  },
};

function clampConfidence(value: number | null | undefined): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 0.5;
  return Math.max(0, Math.min(1, v));
}

function clampRisk(value: number | null | undefined): number {
  const v = Number(value);
  if (!Number.isFinite(v)) return 3;
  return Math.max(1, Math.min(5, Math.round(v)));
}

function suggestionPriorityScore(s: AISuggestion, tone: SuggestionTone): number {
  const confidence = clampConfidence(s.confidence);
  const risk = clampRisk(s.risk_score);
  const signal = (s.signal_type ?? "steady") as SuggestionSignalType;
  const signalWeight = SIGNAL_PRIORITY_BY_TONE[tone][signal] ?? 0.5;

  if (tone === "sell") {
    const urgency = (risk - 1) / 4; // higher risk -> higher urgency
    return confidence * 55 + urgency * 35 + signalWeight * 10;
  }
  if (tone === "buy") {
    const quality = (5 - risk) / 4; // lower risk -> higher quality
    return confidence * 55 + quality * 20 + signalWeight * 25;
  }

  const balance = 1 - Math.abs(risk - 3) / 2; // prefer medium-risk holds
  return confidence * 60 + balance * 20 + signalWeight * 20;
}

function RiskDots({ score }: { score: number }) {
  const s = Math.max(1, Math.min(5, score));
  return (
    <span className="inline-flex items-center gap-0.5" title={`Risk score ${s}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span
          key={i}
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            i < s
              ? s >= 4
                ? "bg-negative"
                : s >= 3
                  ? "bg-caution"
                  : "bg-positive"
              : "bg-border",
          )}
        />
      ))}
    </span>
  );
}

function SuggestionCard({ s }: { s: AISuggestion }) {
  const isSell = s.action === "sell";
  const isBuy = s.action === "buy";
  const accentColor = isSell ? "text-negative" : isBuy ? "text-positive" : "text-caution";
  const borderColor = isSell ? "border-negative/20" : isBuy ? "border-positive/20" : "border-caution/20";
  const bgColor = isSell ? "bg-negative/5" : isBuy ? "bg-positive/5" : "bg-caution/5";
  const actionLabel = isSell ? "SELL / TRIM" : isBuy ? "BUY" : "HOLD";
  const confPct = Math.round(s.confidence * 100);
  return (
    <div className={cn("rounded-lg border p-3.5 space-y-2.5", borderColor, bgColor)}>
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={cn("text-sm font-bold font-mono tracking-wide", accentColor)}>{s.ticker}</span>
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
              isSell ? "bg-negative/15 text-negative" : isBuy ? "bg-positive/15 text-positive" : "bg-caution/15 text-caution",
            )}
          >
            {actionLabel}
          </span>
          {s.signal_type && (
            <span className="rounded-full border border-border bg-[#101013] px-1.5 py-0.5 text-[10px] font-mono text-muted">
              {SIGNAL_LABEL[s.signal_type] ?? s.signal_type}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {s.risk_score != null && <RiskDots score={s.risk_score} />}
          <span className="text-[11px] font-mono text-muted whitespace-nowrap">{confPct}% conf</span>
        </div>
      </div>
      {/* Rationale */}
      <p className="text-xs text-gray-300 leading-5">{s.rationale}</p>
      {/* Portfolio-unit fit */}
      {(s.portfolio_fit_score != null || s.portfolio_role || s.portfolio_fit_rationale) && (
        <div className="rounded border border-border/70 bg-[#0f1218] p-2 space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-mono uppercase tracking-wider text-muted">Portfolio Fit</span>
            {s.portfolio_fit_score != null && (
              <span className="text-[10px] font-mono text-accent">{Math.max(0, Math.min(100, Math.round(s.portfolio_fit_score)))} / 100</span>
            )}
          </div>
          {s.portfolio_role && (
            <p className="text-[11px] text-gray-300">
              <span className="text-muted font-mono mr-1">role:</span>
              {s.portfolio_role}
            </p>
          )}
          {s.portfolio_fit_rationale && (
            <p className="text-[11px] text-muted leading-4">{s.portfolio_fit_rationale}</p>
          )}
        </div>
      )}
      {/* Catalyst */}
      {s.catalyst && (
        <div className="flex items-start gap-1.5">
          <span className="text-[10px] font-mono text-muted shrink-0 mt-px">catalyst:</span>
          <p className="text-[11px] text-muted leading-4 italic line-clamp-2">{s.catalyst}</p>
        </div>
      )}
      {/* Footer row */}
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {s.size_hint ? (
          <span className="text-[11px] font-mono text-caution">{s.size_hint}</span>
        ) : (
          <span />
        )}
        {s.time_horizon && (
          <span className="text-[10px] font-mono text-muted">
            horizon: {HORIZON_LABEL[s.time_horizon] ?? s.time_horizon}
          </span>
        )}
      </div>
    </div>
  );
}

function SuggestionList({
  title,
  items,
  tone,
  signalFilter,
}: {
  title: string;
  items: PortfolioInsights["suggestions"];
  tone: SuggestionTone;
  signalFilter: SuggestionFilter;
}) {
  const filtered = items
    .filter((s) => s.action === tone)
    .filter((s) => signalFilter === "all" || s.signal_type === signalFilter)
    .sort((a, b) => {
      const scoreDiff = suggestionPriorityScore(b, tone) - suggestionPriorityScore(a, tone);
      if (scoreDiff !== 0) return scoreDiff;
      const confDiff = clampConfidence(b.confidence) - clampConfidence(a.confidence);
      if (confDiff !== 0) return confDiff;
      return a.ticker.localeCompare(b.ticker);
    });
  if (filtered.length === 0) return null;
  const isSell = tone === "sell";
  const isBuy = tone === "buy";
  const headerColor = isSell ? "text-negative" : isBuy ? "text-positive" : "text-caution";
  return (
    <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
      <h3 className={cn("text-xs font-mono uppercase tracking-wider", headerColor)}>{title}</h3>
      <div className="space-y-2">
        {filtered.map((s, idx) => (
          <SuggestionCard key={`${s.action}-${s.ticker}-${idx}`} s={s} />
        ))}
      </div>
    </section>
  );
}

export default function AssistantPage() {
  const [insights, setInsights] = useState<PortfolioInsights | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<AIChatMessage[]>([]);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [typingAssistantIndex, setTypingAssistantIndex] = useState<number | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [provider, setProvider] = useState<string>("deterministic");
  const [activeModel, setActiveModel] = useState<string | null>(null);
  const [signalFilter, setSignalFilter] = useState<SuggestionFilter>("all");
  const [pipelineWaiting, setPipelineWaiting] = useState<string>(pipelineWaitingLabel());
  const pipelineRecoveryAttemptedRef = useRef(false);

  const hydrateFromCache = useCallback(() => {
    const latest = sanitizePortfolioInsights(readLatestAssistantInsights());
    if (!latest) return false;
    setInsights((prev) => {
      if (
        prev &&
        prev.generated_at === latest.generated_at &&
        prev.model === latest.model &&
        prev.summary === latest.summary
      ) {
        return prev;
      }
      return latest;
    });
    const nextModel = latest.model_used ?? latest.model;
    setActiveModel((prev) => (prev === nextModel ? prev : nextModel));
    setError(null);
    return true;
  }, []);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);

    try {
      const statusPromise = getAIStatus().catch(() => null);
      const prewarm = readAIPrewarmState();
      setPipelineWaiting(pipelineWaitingLabel());

      if (!force) {
        if (hydrateFromCache()) {
          const status = await statusPromise;
          setAiEnabled(Boolean(status?.ai_enabled));
          setProvider(status?.provider ?? "deterministic");
          setLoading(false);
          return;
        }
        if (prewarm.started && !prewarm.assistant_ready && !prewarm.completed) {
          const status = await statusPromise;
          setAiEnabled(Boolean(status?.ai_enabled));
          setProvider(status?.provider ?? "deterministic");
          setGenerating(true);
          setLoading(false);
          return;
        }
      }

      const status = await statusPromise;
      setAiEnabled(Boolean(status?.ai_enabled));
      setProvider(status?.provider ?? "deterministic");

      setGenerating(true);
      const next = await getPortfolioInsights();
      const cleanNext = sanitizePortfolioInsights(next) ?? next;
      setInsights(cleanNext);
      setActiveModel(cleanNext.model);
      writeLatestAssistantInsights(cleanNext, cleanNext.model);
      setPipelineWaiting("");
      pipelineRecoveryAttemptedRef.current = false;
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load AI assistant.");
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }, [hydrateFromCache]);

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const syncFromPipeline = () => {
      setPipelineWaiting(pipelineWaitingLabel());
      const state = readAIPrewarmState();
      if (!state.started) {
        pipelineRecoveryAttemptedRef.current = false;
        setGenerating(false);
        return;
      }
      if (!state.completed) {
        pipelineRecoveryAttemptedRef.current = false;
      }
      if (!state.assistant_ready) {
        if (state.completed) {
          if (insights) {
            setGenerating(false);
            setPipelineWaiting("");
            return;
          }
          if (!pipelineRecoveryAttemptedRef.current) {
            pipelineRecoveryAttemptedRef.current = true;
            void load(true);
            return;
          }
          if (!insights) {
            setGenerating(false);
            setError((prev) => prev ?? "AI pipeline finished without a copilot summary. Use Regenerate Assistant.");
          }
          return;
        }
        if (!insights) setGenerating(true);
        return;
      }
      pipelineRecoveryAttemptedRef.current = false;
      if (insights) {
        setGenerating(false);
        setLoading(false);
        setPipelineWaiting("");
        return;
      }
      if (hydrateFromCache()) {
        setGenerating(false);
        setLoading(false);
        setPipelineWaiting("");
      }
    };
    syncFromPipeline();
    const unsubscribe = subscribeAIPrewarm(() => {
      syncFromPipeline();
    });
    return unsubscribe;
  }, [hydrateFromCache, insights, load]);

  useEffect(() => {
    if (!chatScrollRef.current) return;
    chatScrollRef.current.scrollTo({
      top: chatScrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [history, sending, typingAssistantIndex]);

  const modeLabel = useMemo(() => {
    const model = activeModel ?? "not-generated";
    if (!aiEnabled) return `${provider} (${model})`;
    return `${provider} (${model})`;
  }, [aiEnabled, provider, activeModel]);

  const availableSignalFilters = useMemo(() => {
    if (!insights) return [];
    const set = new Set<SuggestionSignalType>();
    for (const s of insights.suggestions) {
      if (s.signal_type) set.add(s.signal_type);
    }
    return Array.from(set).sort((a, b) => {
      const la = SIGNAL_LABEL[a] ?? a;
      const lb = SIGNAL_LABEL[b] ?? b;
      return la.localeCompare(lb);
    });
  }, [insights]);

  const totalFilteredSuggestions = useMemo(() => {
    if (!insights) return 0;
    return insights.suggestions.filter((s) => signalFilter === "all" || s.signal_type === signalFilter).length;
  }, [insights, signalFilter]);

  const MAX_HISTORY = 40; // ~20 conversation turns

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    // Keep only the last MAX_HISTORY messages so memory stays bounded.
    const priorHistory = history.slice(-MAX_HISTORY);
    setHistory((prev) => [...prev.slice(-MAX_HISTORY), { role: "user", content: trimmed }]);
    setTypingAssistantIndex(null);
    setMessage("");
    setSending(true);
    try {
      const data = await chatAI(trimmed, priorHistory);
      setActiveModel(data.model);
      setHistory((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setTypingAssistantIndex(priorHistory.length + 1);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chat failed.";
      setHistory((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
      setTypingAssistantIndex(priorHistory.length + 1);
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="bg-panel border border-border rounded-lg p-4">
          <div className="h-4 w-40 bg-surface rounded animate-pulse" />
          <div className="mt-3 h-3 w-full bg-surface rounded animate-pulse" />
          <div className="mt-2 h-3 w-3/4 bg-surface rounded animate-pulse" />
        </div>
        <div className="bg-panel border border-border rounded-lg p-4">
          <ThinkingIndicator label="Preparing assistant context" />
        </div>
      </div>
    );
  }

  if (!insights) {
    return (
      <div className="bg-panel border border-negative/30 rounded-lg p-6">
        <p className="text-sm font-mono text-negative">{error ?? "No assistant data available."}</p>
        <button
          onClick={() => void load(true)}
          className="mt-3 text-xs font-mono border border-accent/30 text-accent rounded px-3 py-1.5 hover:bg-accent/10"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Disclaimer banner */}
      <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/20 bg-amber-950/20 px-4 py-3">
        <span className="text-amber-400 text-sm mt-px shrink-0">!</span>
        <p className="text-[11px] text-amber-300/80 leading-5">
          AI outputs are for <strong className="text-amber-200">informational and educational purposes only</strong> and
          do not constitute financial advice, investment advice, or any professional guidance. All ticker suggestions
          undergo Yahoo Finance validation but may still be inaccurate, unsuitable, or based on stale data.
          Past performance and AI signals are not indicators of future results.{" "}
          <Link href="/disclaimer" className="underline underline-offset-2 hover:text-amber-100 transition-colors font-medium">
            Full disclaimer
          </Link>
        </p>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Weekly Alpha Command Center</h1>
          <p className="text-xs font-mono text-muted mt-0.5">
            AI assistant with live portfolio, holdings, risk, and news context.
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-mono text-muted">Mode</p>
          <p className="text-xs font-mono text-accent">{modeLabel}</p>
          <div className="mt-2 flex justify-end gap-2">
            <button
              onClick={() => void load(true)}
              className="text-xs font-mono border border-accent/30 text-accent rounded px-3 py-1.5 hover:bg-accent/10"
            >
              Regenerate Assistant
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-panel border border-caution/30 rounded p-3">
          <p className="text-xs font-mono text-caution">{error}</p>
        </div>
      )}

      {pipelineWaiting && (
        <div className="bg-panel border border-accent/25 rounded-lg p-3">
          <ThinkingIndicator label={pipelineWaiting} />
        </div>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        {generating && <ThinkingIndicator label="Generating AI analysis" />}
        <LLMText text={insights.summary} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider text-negative mb-2">Key Risks</h3>
            <LLMText
              text={insights.key_risks.map((r) => `- ${r}`).join("\n")}
              lineClassName="text-xs text-gray-300 leading-5"
            />
          </div>
          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider text-positive mb-2">Key Opportunities</h3>
            <LLMText
              text={insights.key_opportunities.map((o) => `- ${o}`).join("\n")}
              lineClassName="text-xs text-gray-300 leading-5"
            />
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-3 bg-panel border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="text-xs font-mono uppercase tracking-wider text-muted">Suggestion Filters</h3>
            <p className="text-[10px] font-mono text-muted">
              Ranked by confidence + risk score + signal type priority.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSignalFilter("all")}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10px] font-mono transition-colors",
                signalFilter === "all"
                  ? "border-accent/50 bg-accent/15 text-accent"
                  : "border-border bg-[#101013] text-muted hover:text-accent",
              )}
            >
              All
            </button>
            {availableSignalFilters.map((signal) => (
              <button
                key={signal}
                type="button"
                onClick={() => setSignalFilter(signal)}
                className={cn(
                  "rounded-full border px-2.5 py-1 text-[10px] font-mono transition-colors",
                  signalFilter === signal
                    ? "border-accent/50 bg-accent/15 text-accent"
                    : "border-border bg-[#101013] text-muted hover:text-accent",
                )}
              >
                {SIGNAL_LABEL[signal] ?? signal}
              </button>
            ))}
          </div>
        </div>
        <SuggestionList
          title="Sell / Trim Candidates"
          items={insights.suggestions}
          tone="sell"
          signalFilter={signalFilter}
        />
        <SuggestionList
          title="Hold Candidates"
          items={insights.suggestions}
          tone="hold"
          signalFilter={signalFilter}
        />
        <SuggestionList
          title="Buy Candidates"
          items={insights.suggestions}
          tone="buy"
          signalFilter={signalFilter}
        />
      </div>

      {totalFilteredSuggestions === 0 && (
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-xs font-mono text-muted">
            No suggestions match the selected signal filter in this cycle.
          </p>
        </div>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted">Watchlist Fit</h3>
        <div className="flex flex-wrap gap-2">
          {insights.watchlist.length === 0 ? (
            <p className="text-xs text-muted">No watchlist names generated yet.</p>
          ) : (
            insights.watchlist.map((t) => (
              <span key={t} className="text-xs font-mono px-2 py-1 rounded border border-border bg-surface text-accent">
                {t}
              </span>
            ))
          )}
        </div>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted">Ask The Assistant</h3>
        <div ref={chatScrollRef} className="bg-surface border border-border rounded p-3 h-72 overflow-y-auto space-y-2">
          {history.length === 0 && (
            <p className="text-xs text-muted">Ask about market impact, rebalancing, or new ETF/stock ideas.</p>
          )}
          {history.map((m, idx) => (
            <div
              key={`${m.role}-${idx}`}
              className={cn(
                "rounded px-3 py-2 text-xs whitespace-pre-wrap",
                m.role === "user" ? "bg-accent/15 text-gray-100" : "bg-panel border border-border text-gray-300",
              )}
            >
              <p className="text-[10px] font-mono uppercase tracking-wider mb-1 opacity-70">{m.role}</p>
              <TypedLLMText
                text={m.content}
                animate={m.role === "assistant" && typingAssistantIndex === idx}
                onDone={() => {
                  setTypingAssistantIndex((cur) => (cur === idx ? null : cur));
                }}
                className="space-y-0"
                lineClassName="text-xs leading-5"
              />
            </div>
          ))}
          {sending && (
            <div className="rounded px-3 py-2 text-xs bg-panel border border-border text-gray-300">
              <p className="text-[10px] font-mono uppercase tracking-wider mb-1 opacity-70">assistant</p>
              <ThinkingIndicator label="Thinking through portfolio data and news..." />
            </div>
          )}
        </div>
        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Example: what should I trim first if volatility spikes this week?"
            className="flex-1 bg-surface border border-border rounded px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={sending}
            className="text-xs font-mono bg-accent/15 border border-accent/30 text-accent rounded px-4 py-2 hover:bg-accent/25 disabled:opacity-50"
          >
            {sending ? "Sending..." : "Ask"}
          </button>
        </form>
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 space-y-2">
        <h3 className="text-xs font-mono uppercase tracking-wider text-muted">Evidence Sources</h3>
        <div className="max-h-64 overflow-y-auto rounded-md border border-border bg-[#101013] p-3">
          <LLMText
            text={insights.sources.map((s) => `- ${s}`).join("\n")}
            lineClassName="text-xs text-gray-300 leading-5"
          />
        </div>
      </section>
    </div>
  );
}
