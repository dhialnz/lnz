"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { chatAI, getAIStatus, getPortfolioInsights } from "@/lib/api";
import type { AIChatMessage, PortfolioInsights } from "@/lib/types";
import {
  bumpAIEpoch,
  readLatestAssistantInsights,
  startGlobalAIPrewarm,
  writeLatestAssistantInsights,
} from "@/lib/ai-session";
import { cn } from "@/lib/utils";

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

function SuggestionList({
  title,
  items,
  tone,
}: {
  title: string;
  items: PortfolioInsights["suggestions"];
  tone: "buy" | "hold" | "sell";
}) {
  const filtered = items.filter((s) => s.action === tone);
  if (filtered.length === 0) return null;
  return (
    <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
      <h3 className="text-xs font-mono uppercase tracking-wider text-muted">{title}</h3>
      <div className="space-y-2">
        {filtered.map((s, idx) => (
          <div key={`${s.action}-${s.ticker}-${idx}`} className="bg-surface border border-border rounded p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-accent">{s.ticker}</p>
              <p className="text-[11px] font-mono text-muted">Confidence {(s.confidence * 100).toFixed(0)}%</p>
            </div>
            <p className="text-xs text-gray-300 mt-1">{s.rationale}</p>
            {s.size_hint && <p className="text-[11px] font-mono text-caution mt-1">{s.size_hint}</p>}
          </div>
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

  const [aiEnabled, setAiEnabled] = useState(false);
  const [provider, setProvider] = useState<string>("deterministic");
  const [activeModel, setActiveModel] = useState<string | null>(null);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);

    try {
      const status = await getAIStatus().catch(() => null);
      setAiEnabled(Boolean(status?.ai_enabled));
      setProvider(status?.provider ?? "deterministic");

      if (!force) {
        const latest = readLatestAssistantInsights();
        if (latest) {
          setInsights(latest);
          setActiveModel(latest.model_used ?? latest.model);
          setLoading(false);
          if (status?.ai_enabled) void startGlobalAIPrewarm();
          return;
        }
      }

      setGenerating(true);
      const next = await getPortfolioInsights();
      setInsights(next);
      setActiveModel(next.model);
      writeLatestAssistantInsights(next, next.model);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load AI assistant.");
    } finally {
      setGenerating(false);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  const modeLabel = useMemo(() => {
    const model = activeModel ?? "not-generated";
    if (!aiEnabled) return `${provider} (${model})`;
    return `${provider} (${model})`;
  }, [aiEnabled, provider, activeModel]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || sending) return;

    const priorHistory = [...history];
    setHistory((prev) => [...prev, { role: "user", content: trimmed }]);
    setMessage("");
    setSending(true);
    try {
      const data = await chatAI(trimmed, priorHistory);
      setActiveModel(data.model);
      setHistory((prev) => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Chat failed.";
      setHistory((prev) => [...prev, { role: "assistant", content: `Error: ${msg}` }]);
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
              onClick={async () => {
                bumpAIEpoch();
                await startGlobalAIPrewarm(true);
                await load(true);
              }}
              className="text-xs font-mono border border-accent/30 text-accent rounded px-3 py-1.5 hover:bg-accent/10"
            >
              Refresh Analysis
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-panel border border-caution/30 rounded p-3">
          <p className="text-xs font-mono text-caution">{error}</p>
        </div>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        {generating && <ThinkingIndicator label="Generating AI analysis" />}
        <p className="text-sm text-gray-200">{insights.summary}</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider text-negative mb-2">Key Risks</h3>
            <ul className="space-y-1">
              {insights.key_risks.map((r) => (
                <li key={r} className="text-xs text-gray-300">
                  - {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-mono uppercase tracking-wider text-positive mb-2">Key Opportunities</h3>
            <ul className="space-y-1">
              {insights.key_opportunities.map((o) => (
                <li key={o} className="text-xs text-gray-300">
                  - {o}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SuggestionList title="Sell / Trim Candidates" items={insights.suggestions} tone="sell" />
        <SuggestionList title="Hold Candidates" items={insights.suggestions} tone="hold" />
        <SuggestionList title="Buy Candidates" items={insights.suggestions} tone="buy" />
      </div>

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
        <div className="bg-surface border border-border rounded p-3 h-72 overflow-y-auto space-y-2">
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
              {m.content}
            </div>
          ))}
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
        <ul className="space-y-1">
          {insights.sources.map((s) => (
            <li key={s} className="text-xs text-gray-300">
              - {s}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
