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
      <button
        type="button"
        onClick={() => scrollByPage(-1)}
        aria-label="Scroll left"
        className={cn(
          "absolute left-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-border bg-[#0E1016]/95 px-2 py-1 text-sm text-gray-200 shadow transition",
          canLeft ? "opacity-100 hover:border-accent/40 hover:text-white" : "pointer-events-none opacity-0",
        )}
      >
        {"<"}
      </button>
      <button
        type="button"
        onClick={() => scrollByPage(1)}
        aria-label="Scroll right"
        className={cn(
          "absolute right-1 top-1/2 z-20 -translate-y-1/2 rounded-full border border-border bg-[#0E1016]/95 px-2 py-1 text-sm text-gray-200 shadow transition",
          canRight ? "opacity-100 hover:border-accent/40 hover:text-white" : "pointer-events-none opacity-0",
        )}
      >
        {">"}
      </button>
      <div ref={railRef} className="flex gap-3 overflow-x-auto pb-2 px-9">
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

  const renderCard = (ev: NewsEventImpact, large = false) => {
    const img = imageFor(ev);
    const isNew = hoursAgo(ev.event.captured_at) < 12;
    const isActive = activeArticleId === ev.event.id;
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
          isActive && "ring-1 ring-accent/60 border-accent/50",
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
          <div className="flex items-center gap-2 pt-0.5">
            <button
              type="button"
              onClick={() => void handleGenerateArticleSummary(ev)}
              className={cn(
                "text-[11px] font-mono rounded border px-2 py-0.5 transition-colors",
                isActive
                  ? "border-accent/60 bg-accent/15 text-accent"
                  : "border-border bg-black/45 text-gray-100 hover:border-accent/40 hover:text-accent",
              )}
            >
              {isActive && articleSummaryLoading ? "Generating..." : "AI Summary"}
            </button>
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
          Showing {uniqueFilteredEvents.length} unique of {events.length} impact-ranked articles
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
            <LLMText text={aiSummary} lineClassName="text-xs text-gray-200 leading-5" />
          </>
        ) : (
          <p className="text-xs text-muted">No AI summary generated yet.</p>
        )}
        {aiSummaryError && <p className="text-xs font-mono text-negative">{aiSummaryError}</p>}
      </section>

      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-gray-100">Article AI Brief</h2>
          {activeArticle && (
            <p className="text-[11px] font-mono text-muted">
              {activeArticle.event.source} | {new Date(activeArticle.event.captured_at).toLocaleString()}
            </p>
          )}
        </div>
        {!aiEnabled ? (
          <p className="text-xs text-muted">AI API is disabled. Add your API key on backend and restart.</p>
        ) : !activeArticle ? (
          <p className="text-xs text-muted">Select AI Summary on a news card to generate an article-level brief.</p>
        ) : articleSummaryLoading && !activeArticleSummary ? (
          <ThinkingIndicator label="Thinking through article and portfolio context..." />
        ) : activeArticleSummary ? (
          <>
            <p className="text-[11px] font-mono text-muted">Model: {activeArticleSummary.model}</p>
            <LLMText text={activeArticleSummary.text} lineClassName="text-xs text-gray-200 leading-5" />
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Holdings Impact Map</h3>
                <LLMText
                  text={buildHoldingImpactAppendix(activeArticle)}
                  lineClassName="text-xs text-gray-300 leading-5"
                />
              </div>
              <div>
                <h3 className="text-xs font-mono uppercase tracking-wider text-muted mb-2">Evidence Sources</h3>
                <div className="max-h-56 overflow-y-auto rounded-md border border-border bg-[#101013] p-3">
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
          </>
        ) : (
          <p className="text-xs text-muted">No article AI brief generated yet.</p>
        )}
        {articleSummaryError && <p className="text-xs font-mono text-negative">{articleSummaryError}</p>}
      </section>

      {loading ? (
        <div className="space-y-3">
          <div className="h-40 bg-panel border border-border rounded-lg animate-pulse" />
          <div className="h-40 bg-panel border border-border rounded-lg animate-pulse" />
        </div>
      ) : uniqueFilteredEvents.length === 0 ? (
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
              <ScrollableNewsRail
                events={companySpecific.slice(0, 12)}
                renderItem={(ev) => renderCard(ev, false)}
              />
            </section>
          )}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-100">Top Portfolio-Impact Picks</h2>
            <ScrollableNewsRail events={topPicks} renderItem={(ev) => renderCard(ev, true)} />
          </section>

          {EVENT_TYPES.map((type) => {
            const list = grouped[type] || [];
            if (list.length === 0) return null;
            return (
              <section key={type} className="space-y-3">
                <h2 className="text-sm font-semibold text-gray-100 capitalize">{type}</h2>
                <ScrollableNewsRail events={list} renderItem={(ev) => renderCard(ev, false)} />
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
