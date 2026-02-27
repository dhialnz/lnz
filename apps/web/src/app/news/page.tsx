"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chatAI, getAINewsSummary, getAIStatus, getPortfolioNewsImpact } from "@/lib/api";
import type { NewsEventImpact, NewsPortfolioImpact } from "@/lib/types";
import {
  bumpAIEpoch,
  getAIEpoch,
  readPuterAuthHint,
  readLatestNewsSummary,
  startGlobalAIPrewarm,
  writeLatestNewsSummary,
} from "@/lib/ai-session";
import { cn, sentimentColor } from "@/lib/utils";
import { LLMText } from "@/components/LLMText";

const EVENT_TYPES = ["macro", "earnings", "geopolitical", "sector", "general"];
const NEWS_SUMMARY_CACHE_PREFIX = "lnz_news_ai_summary_v1";
const ARTICLE_SUMMARY_CACHE_PREFIX = "lnz_news_article_ai_summary_v1";
const NEWS_AUTO_REFRESH_MS = 90_000;

type ArticleSummaryCache = {
  text: string;
  model: string;
  sources: string[];
};

const FALLBACK_IMAGES: Record<string, string[]> = {
  macro: [
    "https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1601597111158-2fceff292cdc?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1463320726281-696a485928c7?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1518186285589-2f7649de83e0?auto=format&fit=crop&w=1200&q=80",
  ],
  earnings: [
    "https://images.unsplash.com/photo-1460925895917-afdab827c52f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1551288049-bebda4e38f71?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1556155092-490a1ba16284?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1462899006636-339e08d1844e?auto=format&fit=crop&w=1200&q=80",
  ],
  geopolitical: [
    "https://images.unsplash.com/photo-1521295121783-8a321d551ad2?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1532375810709-75b1da00537c?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1579370318443-4f58d6f8ba5c?auto=format&fit=crop&w=1200&q=80",
  ],
  sector: [
    "https://images.unsplash.com/photo-1642790106117-e829e14a795f?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1486406146926-c627a92ad1ab?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1518183214770-9cffbec72538?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1498050108023-c5249f4df085?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1551836022-d5d88e9218df?auto=format&fit=crop&w=1200&q=80",
  ],
  general: [
    "https://images.unsplash.com/photo-1535320903710-d993d3d77d29?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1488190211105-8b0e65b80b4e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1510751007277-36932aac9ebd?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1495020689067-958852a7765e?auto=format&fit=crop&w=1200&q=80",
    "https://images.unsplash.com/photo-1461632830798-3adb3034e4c8?auto=format&fit=crop&w=1200&q=80",
  ],
};

function eventTypeFor(event: NewsEventImpact): string {
  return EVENT_TYPES.includes(event.event.event_type) ? event.event.event_type : "general";
}

function parseUrlHostPath(raw: string | null | undefined): string {
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase();
  } catch {
    return String(raw).trim().toLowerCase();
  }
}

function hashString(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i += 1) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function dedupeKeyForEvent(ev: NewsEventImpact): string {
  const headline = String(ev.event.headline || "").trim().toLowerCase().replace(/\s+/g, " ");
  const source = String(ev.event.source || "").trim().toLowerCase();
  const url = parseUrlHostPath(ev.event.url);
  return `${headline}::${url || source}::${eventTypeFor(ev)}`;
}

function dedupeEvents(events: NewsEventImpact[]): NewsEventImpact[] {
  const seen = new Set<string>();
  const out: NewsEventImpact[] = [];
  for (const ev of events) {
    const key = dedupeKeyForEvent(ev);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ev);
  }
  return out;
}

function imageFor(event: NewsEventImpact): string {
  const raw = event.event.raw_payload ?? {};
  const fromPayload = typeof raw.image_url === "string" ? raw.image_url : null;
  if (fromPayload) return fromPayload;
  const eventType = eventTypeFor(event);
  const pool = FALLBACK_IMAGES[eventType] ?? FALLBACK_IMAGES.general;
  const idx = hashString(`${event.event.id}:${event.event.headline}:${eventType}`) % pool.length;
  return pool[idx];
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

function articleSummaryCacheKey(eventId: string): string {
  return `${ARTICLE_SUMMARY_CACHE_PREFIX}:e${getAIEpoch()}:${eventId}`;
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

function readCachedArticleSummary(eventId: string): ArticleSummaryCache | null {
  try {
    const raw = window.sessionStorage.getItem(articleSummaryCacheKey(eventId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ArticleSummaryCache;
    if (!parsed?.text || !parsed?.model || !Array.isArray(parsed?.sources)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedArticleSummary(eventId: string, cache: ArticleSummaryCache): void {
  try {
    window.sessionStorage.setItem(articleSummaryCacheKey(eventId), JSON.stringify(cache));
  } catch {
    // Ignore cache failures.
  }
}

function ThinkingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1">
      <span className="inline-flex gap-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.2s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce [animation-delay:-0.1s]" />
        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-bounce" />
      </span>
      <span className="text-xs font-mono text-muted">{label}</span>
    </div>
  );
}

/* ── Event type badge colour map ───────────────────────────────────────────── */
const EVENT_TYPE_BADGE: Record<string, string> = {
  macro:        "border-blue-500/30 text-blue-300 bg-black/60",
  earnings:     "border-positive/30 text-positive bg-black/60",
  geopolitical: "border-red-500/30 text-red-300 bg-black/60",
  sector:       "border-purple-400/30 text-purple-300 bg-black/60",
  general:      "border-white/15 text-gray-400 bg-black/60",
};

function ScrollableNewsRail({
  events,
  renderItem,
}: {
  events: NewsEventImpact[];
  renderItem: (ev: NewsEventImpact, index: number) => JSX.Element;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateScrollState = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    updateScrollState();
    const el = railRef.current;
    if (!el) return;

    const onScroll = () => updateScrollState();
    el.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(onScroll) : null;
    observer?.observe(el);

    return () => {
      el.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      observer?.disconnect();
    };
  }, [events.length, updateScrollState]);

  const scrollByPage = (direction: -1 | 1) => {
    const el = railRef.current;
    if (!el) return;
    const amount = Math.max(260, Math.floor(el.clientWidth * 0.8));
    el.scrollBy({ left: amount * direction, behavior: "smooth" });
  };

  return (
    <div className="relative">
      {/* Left arrow */}
      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        aria-label="Scroll left"
        className={cn(
          "absolute left-0 top-1/2 z-20 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-[#0e0e10]/95 text-gray-400 shadow-lg transition-all duration-200",
          canLeft ? "opacity-100 hover:border-accent/40 hover:text-white" : "pointer-events-none opacity-0",
        )}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {/* Right arrow */}
      <button
        type="button"
        onClick={() => scrollByPage(1)}
        aria-label="Scroll right"
        className={cn(
          "absolute right-0 top-1/2 z-20 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full border border-border/80 bg-[#0e0e10]/95 text-gray-400 shadow-lg transition-all duration-200",
          canRight ? "opacity-100 hover:border-accent/40 hover:text-white" : "pointer-events-none opacity-0",
        )}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <div ref={railRef} className="flex gap-3 overflow-x-auto pb-2 px-10">
        {events.map((ev, index) => renderItem(ev, index))}
      </div>
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

  const [aiEnabled, setAiEnabled] = useState(() => readPuterAuthHint());
  const [aiSummary, setAiSummary] = useState("");
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [aiModel, setAiModel] = useState<string | null>(null);
  const [activeArticleId, setActiveArticleId] = useState<string | null>(null);
  const [articleSummaryLoading, setArticleSummaryLoading] = useState(false);
  const [articleSummaryError, setArticleSummaryError] = useState<string | null>(null);
  const [articleSummaryCache, setArticleSummaryCache] = useState<Record<string, ArticleSummaryCache>>({});

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

  const uniqueFilteredEvents = useMemo(() => dedupeEvents(filteredEvents), [filteredEvents]);

  const currentSignature = useMemo(
    () => visibleEventsSignature(uniqueFilteredEvents, filterEntity, minRelevance, minImportance),
    [uniqueFilteredEvents, filterEntity, minRelevance, minImportance],
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
    setArticleSummaryError(null);
    await load(true);
  };

  const handleRegenerateAllAI = async () => {
    if (!impactData) return;
    setAiSummaryLoading(true);
    setAiSummaryError(null);
    try {
      bumpAIEpoch();
      setArticleSummaryCache({});
      setActiveArticleId(null);
      setArticleSummaryError(null);
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

  const topPicks = useMemo(() => uniqueFilteredEvents.slice(0, 8), [uniqueFilteredEvents]);

  const companySpecific = useMemo(() => {
    const scoped = uniqueFilteredEvents.filter((ev) => {
      const entities = new Set((ev.event.entities ?? []).map((x) => String(x).toUpperCase()));
      return ev.impacted_holdings.some((h) => {
        const ticker = String(h.ticker || "").toUpperCase();
        const reason = String(h.reason || "").toLowerCase();
        return entities.has(ticker) || reason.includes("direct ticker mention");
      });
    });
    return dedupeEvents(scoped);
  }, [uniqueFilteredEvents]);

  const grouped = useMemo(() => {
    const byType: Record<string, NewsEventImpact[]> = {};
    for (const t of EVENT_TYPES) byType[t] = [];
    for (const ev of uniqueFilteredEvents) {
      byType[eventTypeFor(ev)].push(ev);
    }
    for (const t of EVENT_TYPES) {
      byType[t] = dedupeEvents(byType[t] ?? []);
    }
    return byType;
  }, [uniqueFilteredEvents]);

  const activeArticle = useMemo(() => {
    if (!activeArticleId) return null;
    return (
      uniqueFilteredEvents.find((ev) => ev.event.id === activeArticleId) ??
      sorted.find((ev) => ev.event.id === activeArticleId) ??
      null
    );
  }, [activeArticleId, uniqueFilteredEvents, sorted]);

  const activeArticleSummary = activeArticleId ? articleSummaryCache[activeArticleId] ?? null : null;

  const buildHoldingImpactAppendix = useCallback((ev: NewsEventImpact): string => {
    if (!ev.impacted_holdings.length) {
      return "- No direct holding-level impact was detected from this article in the current mapping.";
    }
    return ev.impacted_holdings
      .slice(0, 6)
      .map((h) => {
        const direction = h.direction ? String(h.direction).toUpperCase() : "MIXED";
        const pct = `${Math.round(h.impact_score * 100)}%`;
        const reason = String(h.reason || "No reason provided.").slice(0, 160);
        return `- ${h.ticker}: ${direction} (${pct}) - ${reason}`;
      })
      .join("\n");
  }, []);

  const ensureHoldingImpactSection = useCallback(
    (text: string, ev: NewsEventImpact): string => {
      if (/how your current holdings may be impacted/i.test(text)) return text;
      const appendix = buildHoldingImpactAppendix(ev);
      return `${text.trim()}\n\nHow your current holdings may be impacted\n${appendix}`;
    },
    [buildHoldingImpactAppendix],
  );

  const buildArticlePrompt = useCallback((ev: NewsEventImpact): string => {
    const compactEvent = {
      headline: String(ev.event.headline || "").slice(0, 240),
      source: ev.event.source,
      captured_at: ev.event.captured_at,
      event_type: ev.event.event_type,
      rank_score: Number(ev.rank_score.toFixed(3)),
      portfolio_impact_score: Number(ev.portfolio_impact_score.toFixed(3)),
      sentiment_score: ev.event.sentiment_score,
      volatility_score: ev.event.volatility_score,
      entities: (ev.event.entities ?? []).slice(0, 10),
      impacted_holdings: ev.impacted_holdings.slice(0, 8).map((h) => ({
        ticker: h.ticker,
        direction: h.direction,
        impact_score: Number(h.impact_score.toFixed(3)),
        reason: String(h.reason || "").slice(0, 160),
      })),
      article_url: ev.event.url,
    };
    const prompt = [
      "Create a concise institutional brief for this single portfolio-relevant article.",
      "Use exactly these sections:",
      "What happened",
      "Why it matters",
      "How your current holdings may be impacted",
      "Actionable watch items (7 days)",
      "Be specific, data-backed, and cite tickers where relevant.",
      `Article context JSON:\n${JSON.stringify(compactEvent)}`,
    ].join("\n");
    return prompt.length > 1900 ? `${prompt.slice(0, 1890)}...` : prompt;
  }, []);

  const handleGenerateArticleSummary = useCallback(
    async (ev: NewsEventImpact) => {
      const eventId = ev.event.id;
      setActiveArticleId(eventId);
      setArticleSummaryError(null);

      if (!aiEnabled) {
        setArticleSummaryError("AI API is disabled. Add your API key on backend and restart.");
        return;
      }

      const memoryCached = articleSummaryCache[eventId];
      if (memoryCached) return;

      const diskCached = readCachedArticleSummary(eventId);
      if (diskCached) {
        setArticleSummaryCache((prev) => ({ ...prev, [eventId]: diskCached }));
        return;
      }

      setArticleSummaryLoading(true);
      try {
        const payload = await chatAI(buildArticlePrompt(ev), []);
        const summaryText = ensureHoldingImpactSection(payload.reply || "No AI summary generated.", ev);
        const next: ArticleSummaryCache = {
          text: summaryText,
          model: payload.model || "unknown",
          sources: Array.isArray(payload.sources) ? payload.sources.slice(0, 20) : [],
        };
        setArticleSummaryCache((prev) => ({ ...prev, [eventId]: next }));
        writeCachedArticleSummary(eventId, next);
      } catch (e: unknown) {
        setArticleSummaryError(e instanceof Error ? e.message : "Failed to generate article AI summary.");
      } finally {
        setArticleSummaryLoading(false);
      }
    },
    [aiEnabled, articleSummaryCache, buildArticlePrompt, ensureHoldingImpactSection],
  );

  /* ── News card renderer ─────────────────────────────────────────────────── */
  const renderCard = (ev: NewsEventImpact, large = false) => {
    const img = imageFor(ev);
    const isNew = hoursAgo(ev.event.captured_at) < 12;
    const isActive = activeArticleId === ev.event.id;
    const typeBadge = EVENT_TYPE_BADGE[ev.event.event_type] ?? EVENT_TYPE_BADGE.general;

    return (
      <article
        key={ev.event.id}
        className={cn(
          "relative shrink-0 overflow-hidden rounded-xl border transition-all duration-200 group",
          isActive
            ? "border-accent/60 shadow-[0_0_0_1px_rgba(255,92,0,0.25),0_0_24px_rgba(255,92,0,0.1)]"
            : "border-border/80 hover:border-[#2a2a30]",
          large ? "w-[360px] h-[230px]" : "w-[290px] h-[190px]",
        )}
      >
        {/* Background image with subtle zoom on hover */}
        <div
          className="absolute inset-0 bg-center bg-cover transition-transform duration-500 group-hover:scale-[1.03]"
          style={{ backgroundImage: `url(${img})` }}
        />
        {/* Rich gradient — heavier at bottom for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#08080a]/97 via-[#08080a]/55 to-transparent" />

        {/* ── Top badges ──────────────────────────────────────────────────── */}
        <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5">
          {isNew && (
            <span className="text-[9px] font-mono tracking-[0.14em] uppercase px-2 py-0.5 rounded-full bg-accent text-white font-semibold shadow-[0_0_8px_rgba(255,92,0,0.5)]">
              LIVE
            </span>
          )}
          <span className={cn("text-[9px] font-mono tracking-[0.06em] uppercase px-1.5 py-0.5 rounded border", typeBadge)}>
            {ev.event.event_type}
          </span>
        </div>

        {/* Impact score — top right */}
        <div className="absolute top-2.5 right-2.5">
          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/70 text-accent border border-accent/25">
            {(ev.portfolio_impact_score * 100).toFixed(0)}% impact
          </span>
        </div>

        {/* ── Bottom content ───────────────────────────────────────────────── */}
        <div className="absolute bottom-0 left-0 right-0 p-3 space-y-1.5">
          {/* Source · date · sentiment */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-gray-400 truncate">{ev.event.source}</span>
            <span className="text-gray-600 shrink-0 text-[9px]">·</span>
            <span className="text-[10px] font-mono text-gray-500 shrink-0">
              {new Date(ev.event.captured_at).toLocaleDateString()}
            </span>
            {ev.event.sentiment_score != null && (
              <span className={cn("ml-auto text-[10px] font-mono font-semibold shrink-0", sentimentColor(ev.event.sentiment_score))}>
                {ev.event.sentiment_score > 0 ? "+" : ""}{ev.event.sentiment_score.toFixed(2)}
              </span>
            )}
          </div>

          {/* Headline */}
          <h3 className="text-[13px] font-medium leading-snug text-gray-100 group-hover:text-white transition-colors"
            style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
            {ev.event.headline}
          </h3>

          {/* Holdings chips */}
          {ev.impacted_holdings.length > 0 && (
            <div className="flex items-center gap-1 flex-wrap">
              {ev.impacted_holdings.slice(0, 3).map((h) => (
                <span
                  key={h.ticker}
                  className={cn(
                    "text-[9px] font-mono px-1.5 py-0.5 rounded border",
                    h.direction === "negative"
                      ? "text-negative border-negative/30 bg-negative/10"
                      : h.direction === "positive"
                        ? "text-positive border-positive/30 bg-positive/10"
                        : "text-muted border-white/10 bg-white/[0.04]",
                  )}
                >
                  {h.ticker}
                </span>
              ))}
              {ev.impacted_holdings.length > 3 && (
                <span className="text-[9px] font-mono text-muted/50">+{ev.impacted_holdings.length - 3}</span>
              )}
            </div>
          )}

          {/* Action row */}
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => void handleGenerateArticleSummary(ev)}
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-mono rounded-full border px-2.5 py-0.5 transition-all duration-200",
                isActive
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-white/20 bg-black/45 text-gray-300 hover:border-accent/40 hover:text-accent",
              )}
            >
              {isActive && articleSummaryLoading ? (
                <>
                  <span className="inline-flex gap-0.5">
                    <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.2s]" />
                    <span className="h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:-0.1s]" />
                    <span className="h-1 w-1 rounded-full bg-current animate-bounce" />
                  </span>
                  Analyzing
                </>
              ) : (
                <>
                  <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5z" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  {isActive ? "Active" : "AI Brief"}
                </>
              )}
            </button>
            {ev.event.url && (
              <a
                href={ev.event.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 text-[10px] font-mono text-muted/60 hover:text-gray-200 transition-colors"
              >
                Read
                <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            )}
          </div>
        </div>
      </article>
    );
  };

  /* ── Page ───────────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-5">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <section className="hf-card px-6 py-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <span className="hf-label">Market Intelligence</span>
            <h1 className="hf-display text-4xl leading-none text-white">News Flow</h1>
            <p className="text-sm text-muted mt-1">
              Headlines ranked by portfolio impact, mapped to your positions.
            </p>
            <p className="text-[11px] font-mono text-muted/60">
              Auto-refresh every {Math.round(NEWS_AUTO_REFRESH_MS / 1000)}s.
              {autoRefreshing && <span className="ml-1.5 text-accent animate-pulse">Updating…</span>}
            </p>
          </div>
          <button
            onClick={handleIngest}
            disabled={ingesting}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M1 4v6h6M23 20v-6h-6" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {ingesting ? "Refreshing…" : "Refresh News"}
          </button>
        </div>
      </section>

      {/* ── Filter bar ──────────────────────────────────────────────────────── */}
      <div className="hf-card px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Search input */}
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
              width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            >
              <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="text"
              placeholder="Filter by ticker or entity…"
              value={filterEntity}
              onChange={(e) => setFilterEntity(e.target.value)}
              className="bg-[#101013] border border-border rounded-lg pl-7 pr-3 py-1.5 text-xs font-mono text-gray-200 placeholder-muted/50 focus:outline-none focus:border-accent/60 w-56 transition-colors"
            />
          </div>
          {/* Relevance filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Relevance ≥</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={minRelevance}
              onChange={(e) => setMinRelevance(Number(e.target.value || 0))}
              className="w-14 bg-[#101013] border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-accent/60 transition-colors"
            />
          </div>
          {/* Importance filter */}
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-mono text-muted uppercase tracking-wider">Importance ≥</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={minImportance}
              onChange={(e) => setMinImportance(Number(e.target.value || 0))}
              className="w-14 bg-[#101013] border border-border rounded-lg px-2 py-1.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-accent/60 transition-colors"
            />
          </div>
          {/* Article count pill */}
          <div className="ml-auto">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-[#101013] border border-border/80 px-2.5 py-1 text-[10px] font-mono text-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-positive" />
              {uniqueFilteredEvents.length} of {events.length} articles
            </span>
          </div>
        </div>
      </div>

      {/* ── Error ───────────────────────────────────────────────────────────── */}
      {error && (
        <div className="hf-card border-negative/30 px-4 py-3">
          <p className="text-xs font-mono text-negative">{error}</p>
        </div>
      )}

      {/* ── Portfolio Exposure ──────────────────────────────────────────────── */}
      {impactData && impactData.top_impacted_holdings.length > 0 && (
        <section className="hf-card p-5 space-y-3">
          <p className="hf-label">Portfolio Exposure</p>
          <div className="flex flex-wrap gap-2">
            {impactData.top_impacted_holdings.slice(0, 8).map((h) => (
              <div
                key={h.ticker}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg border px-3 py-1.5",
                  h.direction === "negative"
                    ? "border-negative/25 bg-negative/[0.07]"
                    : h.direction === "positive"
                      ? "border-positive/25 bg-positive/[0.07]"
                      : "border-border/80 bg-[#101013]",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    h.direction === "negative" ? "bg-negative" : h.direction === "positive" ? "bg-positive" : "bg-muted",
                  )}
                />
                <span
                  className={cn(
                    "text-xs font-mono font-semibold",
                    h.direction === "negative" ? "text-negative" : h.direction === "positive" ? "text-positive" : "text-gray-300",
                  )}
                >
                  {h.ticker}
                </span>
                <span className="text-[10px] font-mono text-muted">{(h.impact_score * 100).toFixed(0)}%</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── AI Impact Summary ───────────────────────────────────────────────── */}
      <section className="hf-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="hf-label">AI Analysis</p>
            <h2 className="mt-0.5 text-base font-semibold text-white">Portfolio Impact Summary</h2>
          </div>
          <button
            onClick={handleRegenerateAllAI}
            disabled={!impactData || aiSummaryLoading}
            className="shrink-0 text-[11px] font-mono border border-accent/30 text-accent rounded-lg px-3 py-1.5 hover:bg-accent/10 transition-colors disabled:opacity-50"
          >
            {aiSummaryLoading ? "Generating…" : "Regenerate"}
          </button>
        </div>
        {!aiEnabled ? (
          <p className="text-xs text-muted">AI API is disabled. Add your API key on backend and restart.</p>
        ) : aiSummaryLoading ? (
          <ThinkingIndicator label="Generating portfolio news brief…" />
        ) : aiSummary ? (
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-[#101013] px-2 py-0.5 text-[10px] font-mono text-muted">
              {aiModel ?? "unknown"}
            </span>
            <LLMText text={aiSummary} lineClassName="text-xs text-gray-200 leading-5" />
          </div>
        ) : (
          <p className="text-xs text-muted">No AI summary generated yet.</p>
        )}
        {aiSummaryError && <p className="text-xs font-mono text-negative">{aiSummaryError}</p>}
      </section>

      {/* ── Article AI Brief ────────────────────────────────────────────────── */}
      <section className="hf-card p-5 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="hf-label">Article Intelligence</p>
            <h2 className="mt-0.5 text-base font-semibold text-white">Article AI Brief</h2>
          </div>
          {activeArticle && (
            <span className="shrink-0 text-[10px] font-mono text-muted">
              {activeArticle.event.source} · {new Date(activeArticle.event.captured_at).toLocaleString()}
            </span>
          )}
        </div>
        {!aiEnabled ? (
          <p className="text-xs text-muted">AI API is disabled. Add your API key on backend and restart.</p>
        ) : !activeArticle ? (
          <p className="text-xs text-muted">Click &ldquo;AI Brief&rdquo; on any news card to generate an article-level brief.</p>
        ) : articleSummaryLoading && !activeArticleSummary ? (
          <ThinkingIndicator label="Analyzing article against your portfolio…" />
        ) : activeArticleSummary ? (
          <div className="space-y-4">
            <span className="inline-flex items-center gap-1 rounded border border-border/60 bg-[#101013] px-2 py-0.5 text-[10px] font-mono text-muted">
              {activeArticleSummary.model}
            </span>
            <LLMText text={activeArticleSummary.text} lineClassName="text-xs text-gray-200 leading-5" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 pt-1">
              <div className="space-y-2">
                <h3 className="hf-label">Holdings Impact Map</h3>
                <LLMText
                  text={buildHoldingImpactAppendix(activeArticle)}
                  lineClassName="text-xs text-gray-300 leading-5"
                />
              </div>
              <div className="space-y-2">
                <h3 className="hf-label">Evidence Sources</h3>
                <div className="max-h-56 overflow-y-auto rounded-lg border border-border bg-[#0e0e10] p-3">
                  <LLMText
                    text={
                      activeArticleSummary.sources.length > 0
                        ? activeArticleSummary.sources.map((s) => `- ${s}`).join("\n")
                        : activeArticle.event.url
                          ? `- ${activeArticle.event.source}: ${activeArticle.event.headline} | ${activeArticle.event.url}`
                          : `- ${activeArticle.event.source}: ${activeArticle.event.headline}`
                    }
                    lineClassName="text-xs text-gray-300 leading-5"
                  />
                </div>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted">No article brief generated yet.</p>
        )}
        {articleSummaryError && <p className="text-xs font-mono text-negative">{articleSummaryError}</p>}
      </section>

      {/* ── News rails ──────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="space-y-6">
          {[1, 2].map((i) => (
            <section key={i} className="space-y-3">
              <div className="h-2.5 w-28 bg-panel rounded-full animate-pulse" />
              <div className="flex gap-3 overflow-hidden px-10">
                {[1, 2, 3, 4].map((j) => (
                  <div key={j} className="shrink-0 w-[290px] h-[190px] bg-panel border border-border/50 rounded-xl animate-pulse" />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : uniqueFilteredEvents.length === 0 ? (
        <div className="hf-card py-16 text-center">
          <p className="text-muted font-mono text-sm">No news matched the current filters. Lower thresholds or refresh.</p>
        </div>
      ) : (
        <>
          {companySpecific.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2.5">
                <h2 className="text-sm font-semibold text-white">Company-Specific</h2>
                <span className="text-[10px] font-mono text-muted border border-border/50 rounded-full px-2 py-0.5 bg-[#101013]">
                  {companySpecific.slice(0, 12).length} stories
                </span>
              </div>
              <ScrollableNewsRail
                events={companySpecific.slice(0, 12)}
                renderItem={(ev) => renderCard(ev, false)}
              />
            </section>
          )}

          <section className="space-y-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-sm font-semibold text-white">Top Portfolio-Impact Picks</h2>
              <span className="text-[10px] font-mono text-muted border border-border/50 rounded-full px-2 py-0.5 bg-[#101013]">
                {topPicks.length} stories
              </span>
            </div>
            <ScrollableNewsRail events={topPicks} renderItem={(ev) => renderCard(ev, true)} />
          </section>

          {EVENT_TYPES.map((type) => {
            const list = grouped[type] || [];
            if (list.length === 0) return null;
            return (
              <section key={type} className="space-y-3">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-sm font-semibold text-white capitalize">{type}</h2>
                  <span className="text-[10px] font-mono text-muted border border-border/50 rounded-full px-2 py-0.5 bg-[#101013]">
                    {list.length} stories
                  </span>
                </div>
                <ScrollableNewsRail events={list} renderItem={(ev) => renderCard(ev, false)} />
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
