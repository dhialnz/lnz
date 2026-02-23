"use client";

import { useState, useEffect } from "react";
import { getMarketSnapshot, refreshMarketSnapshot } from "@/lib/api";
import type { MarketSnapshot } from "@/lib/types";
import { fmtDate } from "@/lib/utils";

export default function SettingsPage() {
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getMarketSnapshot()
      .then(setSnapshot)
      .catch(() => setSnapshot(null));
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const snap = await refreshMarketSnapshot();
      setSnapshot(snap);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const p = snapshot?.payload;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-100">Settings</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Data provider configuration and market snapshot.
        </p>
      </div>

      {/* Market snapshot */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100">Market Snapshot</h2>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="text-xs font-mono bg-accent/10 hover:bg-accent/20 text-accent border border-accent/30 rounded px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "↻ Refresh"}
          </button>
        </div>

        {error && (
          <p className="text-xs font-mono text-negative">{error}</p>
        )}

        {p ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {[
              ["SPY", p.spy],
              ["VIX", p.vix],
              ["2Y Treasury", p.t2y],
              ["10Y Treasury", p.t10y],
              ["DXY", p.dxy],
              ["BTC", p.btc],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-surface border border-border rounded p-3">
                <p className="text-xs font-mono text-muted">{label}</p>
                <p className="text-sm font-mono font-semibold text-gray-100 mt-0.5">
                  {value != null ? Number(value).toFixed(2) : "—"}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs font-mono text-muted">
            No snapshot available. Click Refresh to fetch.
          </p>
        )}

        {snapshot && (
          <p className="text-xs font-mono text-muted">
            Provider: {p?._provider ?? "—"} · Captured: {fmtDate(snapshot.captured_at)}
          </p>
        )}

        {p?.sectors && Object.keys(p.sectors).length > 0 && (
          <div>
            <p className="text-xs font-mono text-muted uppercase tracking-wider mb-2">
              Sector ETFs
            </p>
            <div className="grid grid-cols-3 md:grid-cols-4 gap-2">
              {Object.entries(p.sectors).map(([ticker, price]) => (
                <div key={ticker} className="bg-surface border border-border rounded p-2 flex justify-between items-center">
                  <span className="text-xs font-mono text-accent">{ticker}</span>
                  <span className="text-xs font-mono text-gray-200">{Number(price).toFixed(2)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Provider config */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-100">Data Provider Config</h2>
        <p className="text-xs font-mono text-muted">
          API keys and provider selection are configured via environment variables — never stored in the database.
        </p>
        <div className="bg-surface border border-border rounded p-4 text-xs font-mono text-gray-300 space-y-2">
          <p className="text-muted"># In your .env file:</p>
          <p>MARKET_DATA_PROVIDER=<span className="text-accent">mock</span> | http</p>
          <p>MARKET_DATA_BASE_URL=<span className="text-accent">https://your-provider.com</span></p>
          <p>MARKET_DATA_API_KEY=<span className="text-accent">sk-...</span></p>
          <p className="mt-2 text-muted"># News:</p>
          <p>NEWS_PROVIDER=<span className="text-accent">mock</span> | http</p>
          <p>NEWS_BASE_URL=<span className="text-accent">https://your-news-api.com</span></p>
          <p>NEWS_API_KEY=<span className="text-accent">...</span></p>
        </div>
        <p className="text-xs font-mono text-muted">
          See README for instructions on adding a custom provider adapter.
        </p>
      </div>
    </div>
  );
}
