"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getAINewsSummary, getAIStatus, getPortfolioNewsImpact } from "@/lib/api";
import type { NewsEventImpact, NewsPortfolioImpact } from "@/lib/types";
import {
  bumpAIEpoch,
  getAIEpoch,
  readLatestNewsSummary,
  startGlobalAIPrewarm,
  writeLatestNewsSummary,
} from "@/lib/ai-session";
import { cn, sentimentColor } from "@/lib/utils";

const EVENT_TYPES = ["macro", "earnings", "geopolitical", "sector", "general"];
const NEWS_SUMMARY_CACHE_PREFIX = "lnz_news_ai_summary_v1";
const NEWS_AUTO_REFRESH_MS = 90_000;

const FALLBACK_IMAGES: Record<string, string> = {
  macro: "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80",
  earnings: "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
  geopolitical: "https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=1200&q=80",
  sector: "https://images.unsplash.com/photo-1642790106117-e829e14a795f?auto=format&fit=crop&w=1200&q=80",
  general: "https://images.unsplash.com/photo-1535320903710-d993d3d77d29?auto=format&fit=crop&w=1200&q=80",
};

function imageFor(event: NewsEventImpact): string {
  const raw = event.event.raw_payload ?? {};
  const fromPayload = typeof raw.image_url === "string" ? raw.image_url : null;
  return fromPayload || FALLBACK_IMAGES[event.event.event_type] || FALLBACK_IMAGES.general;
}

function hoursAgo(iso: string): number {
  const d = new Date(iso);
  return Math.max(0, (Date.now() - d.getTime()) / (1000 * 3600));
}

function visibleEventsSignature(
  events: NewsEventImpact[],
  filterEntity: string,
  minRelevance: number,
  minImportance: number,
): string {
  const top = events
    .slice(0, 20)
    .map((e) => `${e.event.id}:${e.rank_score.toFixed(3)}:${e.portfolio_impact_score.toFixed(3)}`)
    .join("|");
  return `${filterEntity}::${minRelevance}::${minImportance}::${top}`;
}

function summaryCacheKey(signature: string): string {
  return `${NEWS_SUMMARY_CACHE_PREFIX}:e${getAIEpoch()}:${signature}`;
}

function readCachedSummary(signature: string): { text: string; model: string } | null {
  try {
    const raw = window.sessionStorage.getItem(summaryCacheKey(signature));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text?: string; model?: string };
    if (!parsed.text || !parsed.model) return null;
    return { text: parsed.text, model: parsed.model };
  } catch {
    return null;
  }
}

function writeCachedSummary(signature: string, text: string, model: string): void {
  try {
    window.sessionStorage.setItem(summaryCacheKey(signature), JSON.stringify({ text, model }));
  } catch {
    // Ignore cache failures.
  }
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

export default function NewsPage() {
  const [impactData, setImpactData] = useState<NewsPortfolioImpact | null>(null);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [autoRefreshing, setAutoRefreshing] = useState(false);
  const [filterEntity, setFilterEntity] = useState("");
  const [minRelevance, setMinRelevance] = useState(0);
  const [minImportance, setMinImportance] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiSummary, setAiSummary] = useState("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);

  const refreshAIStatus = useCallback(async () => {
    const status = await getAIStatus().catch(() => null);
    const enabled = Boolean(status?.ai_enabled);
    setAiEnabled(enabled);
    if (enabled) void startGlobalAIPrewarm();
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(!refresh);
      setError(null);
      try {
        const data = await getPortfolioNewsImpact({
          entity: filterEntity || undefined,
          limit: 120,
          refresh,
        });
        setImpactData(data);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load news impact.");
      } finally {
        setLoading(false);
        setIngesting(false);
      }
    },
    [filterEntity],
  );

  const events = impactData?.events ?? [];

  const sorted = useMemo(
    () =>
      [...events].sort((a, b) => {
        const impactDiff = b.portfolio_impact_score - a.portfolio_impact_score;
        if (Math.abs(impactDiff) > 1e-9) return impactDiff;
        const rankDiff = b.rank_score - a.rank_score;
        if (Math.abs(rankDiff) > 1e-9) return rankDiff;
        return new Date(b.event.captured_at).getTime() - new Date(a.event.captured_at).getTime();
      }),
    [events],
  );

  const filteredEvents = useMemo(
    () => sorted.filter((ev) => ev.portfolio_impact_score >= minRelevance && ev.rank_score >= minImportance),
    [sorted, minRelevance, minImportance],
  );

  const currentSignature = useMemo(
    () => visibleEventsSignature(filteredEvents, filterEntity, minRelevance, minImportance),
    [filteredEvents, filterEntity, minRelevance, minImportance],
  );

  const generateAiSummary = useCallback(
    async (signature: string) => {
      if (!aiEnabled) {
        setAiSummary("");
        return;
      }

      setAiSummaryLoading(true);
      setAiSummaryError(null);
      try {
        const payload = await getAINewsSummary();
        const text = payload.summary || "No AI summary was generated.";
        const model = payload.model;
        setAiModel(model);
        setAiSummary(text);
        writeCachedSummary(signature, text, model);
        writeLatestNewsSummary(text, model);
      } catch (e: unknown) {
        setAiSummaryError(
          e instanceof Error ? `Failed to generate AI summary: ${e.message}` : "Failed to generate AI summary.",
        );
      } finally {
        setAiSummaryLoading(false);
      }
    },
    [aiEnabled],
  );

  useEffect(() => {
    void refreshAIStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void load(filterEntity.trim().length === 0);
  }, [filterEntity, load]);

  useEffect(() => {
    let inFlight = false;
    const tick = async () => {
      if (inFlight) return;
      if (document.visibilityState !== "visible") return;
      inFlight = true;
      setAutoRefreshing(true);
      try {
        await load(true);
      } finally {
        setAutoRefreshing(false);
        inFlight = false;
      }
    };

    const id = window.setInterval(() => {
      void tick();
    }, NEWS_AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    if (!impactData) return;

    if (!aiEnabled) {
      setAiSummary("");
      setAiSummaryError(null);
      return;
    }

    const cached = readCachedSummary(currentSignature);
    if (cached) {
      setAiSummary(cached.text);
      setAiModel(cached.model);
      setAiSummaryError(null);
      return;
    }

    const noFilters = !filterEntity && minRelevance === 0 && minImportance === 0;
    if (noFilters) {
      const latest = readLatestNewsSummary();
      if (latest) {
        setAiSummary(latest.text);
        setAiModel(latest.model);
        setAiSummaryError(null);
        return;
      }
    }

    void generateAiSummary(currentSignature);
  }, [
    aiEnabled,
    currentSignature,
    filterEntity,
    generateAiSummary,
    impactData,
    minImportance,
    minRelevance,
  ]);

  const handleIngest = async () => {
    setIngesting(true);
    await load(true);
  };

  const handleRegenerateAllAI = async () => {
    if (!impactData) return;
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    try {
      bumpAIEpoch();
      await startGlobalAIPrewarm(true);
      await refreshAIStatus();

      const noFilters = !filterEntity && minRelevance === 0 && minImportance === 0;
      if (noFilters) {
        const latest = readLatestNewsSummary();
        if (latest) {
          setAiSummary(latest.text);
          setAiModel(latest.model);
          return;
        }
      }

      await generateAiSummary(currentSignature);
    } catch (e: unknown) {
      setAiSummaryError(e instanceof Error ? e.message : "Failed to regenerate all AI summaries.");
    } finally {
      setAiSummaryLoading(false);
    }
  };

  const topPicks = filteredEvents.slice(0, 8);
  const companySpecific = useMemo(() => {
    return filteredEvents.filter((ev) => {
      const entities = new Set((ev.event.entities ?? []).map((x) => String(x).toUpperCase()));
      return ev.impacted_holdings.some((h) => {
        const ticker = String(h.ticker || "").toUpperCase();
        const reason = String(h.reason || "").toLowerCase();
        return entities.has(ticker) || reason.includes("direct ticker mention");
      });
    });
  }, [filteredEvents]);

  const grouped = useMemo(() => {
    const byType: Record<string, NewsEventImpact[]> = {};
    for (const t of EVENT_TYPES) byType[t] = [];
    for (const ev of filteredEvents) {
      const t = EVENT_TYPES.includes(ev.event.event_type) ? ev.event.event_type : "general";
      byType[t].push(ev);
    }
    return byType;
  }, [filteredEvents]);

  const renderCard = (ev: NewsEventImpact, large = false) => {
    const img = imageFor(ev);
    const isNew = hoursAgo(ev.event.captured_at) < 12;
    const impactedLine =
      ev.impacted_holdings.length > 0
        ? ev.impacted_holdings
            .slice(0, 3)
            .map((h) => `${h.ticker} ${Math.round(h.impact_score * 100)}%`)
            .join(" | ")
        : "No direct portfolio linkage";

    return (
      <article
        key={ev.event.id}
        className={cn(
          "relative shrink-0 overflow-hidden rounded-xl border border-border bg-panel",
          large ? "w-[360px] h-[230px]" : "w-[290px] h-[190px]",
        )}
      >
        <div className="absolute inset-0 bg-center bg-cover" style={{ backgroundImage: `url(${img})` }} />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 to-black/10" />

        <div className="absolute top-2 left-2 flex items-center gap-1">
          {isNew && <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-600 text-white">NEW</span>}
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/65 text-gray-200">
            rank {ev.rank_score.toFixed(2)}
          </span>
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black/65 text-gray-200">
            impact {ev.portfolio_impact_score.toFixed(2)}
          </span>
        </div>

        <div className="absolute bottom-0 left-0 right-0 p-3 space-y-1">
          <p className="text-[11px] font-mono text-gray-300">
            {ev.event.source} | {new Date(ev.event.captured_at).toLocaleDateString()}
          </p>
          <h3 className="text-sm leading-tight text-gray-100 max-h-10 overflow-hidden">{ev.event.headline}</h3>
          <div className="flex items-center gap-2 text-[11px] font-mono">
            <span className={cn("font-semibold", sentimentColor(ev.event.sentiment_score))}>
              Sent {ev.event.sentiment_score != null ? ev.event.sentiment_score.toFixed(2) : "-"}
            </span>
            <span className="text-caution">
              Vol {ev.event.volatility_score != null ? ev.event.volatility_score.toFixed(2) : "-"}
            </span>
            <span className="text-accent uppercase">{ev.event.event_type}</span>
          </div>
          <p className="text-[10px] font-mono text-yellow-200 truncate">Most impacted: {impactedLine}</p>
          {ev.event.url && (
            <a
              href={ev.event.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block text-xs font-mono text-accent hover:underline"
            >
              Open article
            </a>
          )}
        </div>
      </article>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Weekly Alpha Command Center</h1>
          <p className="text-xs font-mono text-muted mt-0.5">
            Headlines ranked by importance/recency and mapped to direct + indirect portfolio impact.
          </p>
          <p className="text-[11px] font-mono text-muted mt-1">
            Auto-refresh every {Math.round(NEWS_AUTO_REFRESH_MS / 1000)}s while this tab is visible.
            {autoRefreshing ? " Updating..." : ""}
          </p>
        </div>
        <button
          onClick={handleIngest}
          disabled={ingesting}
          className="text-xs font-mono bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {ingesting ? "Refreshing..." : "Refresh News"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Filter by ticker/entity (e.g. SPY, NVDA, VFV)"
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          className="bg-surface border border-border rounded px-3 py-1.5 text-xs font-mono text-gray-200 placeholder-muted focus:outline-none focus:border-accent"
        />
        <label className="text-xs font-mono text-muted flex items-center gap-2">
          Relevance &gt;=
          <input
            type="number"
            step="0.1"
            min="0"
            value={minRelevance}
            onChange={(e) => setMinRelevance(Number(e.target.value || 0))}
            className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200"
          />
        </label>
        <label className="text-xs font-mono text-muted flex items-center gap-2">
          Importance &gt;=
          <input
            type="number"
            step="0.1"
            min="0"
            value={minImportance}
            onChange={(e) => setMinImportance(Number(e.target.value || 0))}
            className="w-16 bg-surface border border-border rounded px-2 py-1 text-xs text-gray-200"
          />
        </label>
        <span className="text-xs font-mono text-muted">
          Showing {filteredEvents.length} of {events.length} impact-ranked articles
        </span>
      </div>

      {error && (
        <div className="bg-panel border border-negative/30 rounded p-3">
          <p className="text-xs font-mono text-negative">{error}</p>
        </div>
      )}

      {impactData && impactData.top_impacted_holdings.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4 space-y-2">
          <h2 className="text-sm font-semibold text-gray-100">Most Exposed Holdings Right Now</h2>
          <div className="flex flex-wrap gap-2">
            {impactData.top_impacted_holdings.slice(0, 8).map((h) => (
              <span
                key={h.ticker}
                className={cn(
                  "text-xs font-mono px-2 py-1 rounded border",
                  h.direction === "negative"
                    ? "border-negative/40 text-negative"
                    : h.direction === "positive"
                      ? "border-positive/40 text-positive"
                      : "border-border text-muted",
                )}
              >
                {h.ticker} {(h.impact_score * 100).toFixed(0)}%
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-100">AI Impact Summary</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRegenerateAllAI}
              disabled={!impactData || aiSummaryLoading}
              className="text-xs font-mono border border-accent/30 text-accent rounded px-3 py-1.5 hover:bg-accent/10 disabled:opacity-50"
            >
              {aiSummaryLoading ? "Generating..." : "Regenerate"}
            </button>
          </div>
        </div>
        {!aiEnabled ? (
          <p className="text-xs text-muted">AI API is disabled. Add your API key on backend and restart.</p>
        ) : aiSummaryLoading ? (
          <ThinkingIndicator label="Generating AI summary" />
        ) : aiSummary ? (
          <>
            <p className="text-[11px] font-mono text-muted">Model: {aiModel ?? "unknown"}</p>
            <pre className="text-xs text-gray-200 whitespace-pre-wrap font-sans leading-5">{aiSummary}</pre>
          </>
        ) : (
          <p className="text-xs text-muted">No AI summary generated yet.</p>
        )}
        {aiSummaryError && <p className="text-xs font-mono text-negative">{aiSummaryError}</p>}
      </section>

      {loading ? (
        <div className="space-y-3">
          <div className="h-40 bg-panel border border-border rounded-lg animate-pulse" />
          <div className="h-40 bg-panel border border-border rounded-lg animate-pulse" />
        </div>
      ) : filteredEvents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted font-mono text-sm">
            No news matched the relevance/importance filters. Lower thresholds or refresh news.
          </p>
        </div>
      ) : (
        <>
          {companySpecific.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-100">Company-Specific to Your Holdings</h2>
              <div className="flex gap-3 overflow-x-auto pb-2">{companySpecific.slice(0, 12).map((ev) => renderCard(ev, false))}</div>
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Top Portfolio-Impact Picks</h2>
            <div className="flex gap-3 overflow-x-auto pb-2">{topPicks.map((ev) => renderCard(ev, true))}</div>
          </section>

          {EVENT_TYPES.map((type) => {
            const list = grouped[type] || [];
            if (list.length === 0) return null;
            return (
              <section key={type} className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-100 capitalize">{type}</h2>
                <div className="flex gap-3 overflow-x-auto pb-2">{list.map((ev) => renderCard(ev, false))}</div>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
