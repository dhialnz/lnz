"use client";

import { useState, useEffect } from "react";
import { getNewsEvents, ingestNews } from "@/lib/api";
import type { NewsEvent } from "@/lib/types";
import { sentimentColor, cn } from "@/lib/utils";

const EVENT_TYPES = ["macro", "earnings", "geopolitical", "sector", "general"];

export default function NewsPage() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [ingesting, setIngesting] = useState(false);
  const [filterType, setFilterType] = useState<string>("");
  const [filterEntity, setFilterEntity] = useState<string>("");

  const load = async () => {
    setLoading(true);
    try {
      const data = await getNewsEvents({
        event_type: filterType || undefined,
        entity: filterEntity || undefined,
        limit: 100,
      });
      setEvents(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filterType, filterEntity]);

  const handleIngest = async () => {
    setIngesting(true);
    try {
      await ingestNews();
      await load();
    } finally {
      setIngesting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-100">News & Macro</h1>
          <p className="text-xs font-mono text-muted mt-0.5">
            Portfolio-relevant events with sentiment and volatility impact scoring.
          </p>
        </div>
        <button
          onClick={handleIngest}
          disabled={ingesting}
          className="text-xs font-mono bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
        >
          {ingesting ? "Ingesting…" : "↻ Ingest News"}
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Filter by entity (e.g. SPY)"
          value={filterEntity}
          onChange={(e) => setFilterEntity(e.target.value)}
          className="bg-surface border border-border rounded px-3 py-1.5 text-xs font-mono text-gray-200 placeholder-muted focus:outline-none focus:border-accent"
        />
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-surface border border-border rounded px-3 py-1.5 text-xs font-mono text-gray-200 focus:outline-none focus:border-accent"
        >
          <option value="">All types</option>
          {EVENT_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p className="text-muted font-mono text-sm">Loading…</p>
      ) : events.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted font-mono text-sm">No news events. Click Ingest News to fetch.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((ev) => (
            <div
              key={ev.id}
              className="bg-panel border border-border rounded-lg p-4 flex flex-col md:flex-row md:items-start gap-3"
            >
              {/* Scores */}
              <div className="flex md:flex-col items-center gap-2 md:gap-1 min-w-[56px]">
                <div className="text-center">
                  <p className="text-xs font-mono text-muted">Sent</p>
                  <p className={cn("text-sm font-mono font-semibold", sentimentColor(ev.sentiment_score))}>
                    {ev.sentiment_score != null ? ev.sentiment_score.toFixed(2) : "—"}
                  </p>
                </div>
                <div className="text-center">
                  <p className="text-xs font-mono text-muted">Vol</p>
                  <p className="text-sm font-mono font-semibold text-caution">
                    {ev.volatility_score != null ? ev.volatility_score.toFixed(2) : "—"}
                  </p>
                </div>
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-100 leading-snug">{ev.headline}</p>
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  <span className="text-xs font-mono text-muted">{ev.source}</span>
                  <span className="text-xs font-mono bg-border/50 rounded px-1.5 py-0.5 text-muted">
                    {ev.event_type}
                  </span>
                  {ev.entities.map((e) => (
                    <span
                      key={e}
                      className="text-xs font-mono bg-accent/10 text-accent rounded px-1.5 py-0.5"
                    >
                      {e}
                    </span>
                  ))}
                </div>
              </div>

              {/* Timestamp */}
              <div className="flex-shrink-0 text-xs font-mono text-muted whitespace-nowrap">
                {new Date(ev.captured_at).toLocaleDateString()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
