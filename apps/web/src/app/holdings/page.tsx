"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AllocationPieChart from "@/components/charts/AllocationPieChart";
import HoldingSparkline from "@/components/charts/HoldingSparkline";
import {
  addHolding,
  deleteHolding,
  getHoldings,
  getTickerSuggestions,
  updateHolding,
} from "@/lib/api";
import type {
  HoldingIn,
  HoldingLive,
  HoldingsSnapshot,
  TickerSuggestion,
} from "@/lib/types";
import { fmt, fmtPct, signedClass } from "@/lib/utils";
import { useCurrency } from "@/lib/currency";

const REFRESH_INTERVAL_MS = 30_000;

type SortKey = "ticker" | "total_value" | "unrealized_pnl_pct" | "day_change_pct" | "weight";
type SortDir = "asc" | "desc";
type FormCurrency = "CAD" | "USD";
type ChangeWindow = "1D" | "1W" | "1M" | "1Y";

function MetricTile({
  label,
  value,
  valueClass = "text-accent",
  sub,
  headerRight,
}: {
  label: string;
  value: string;
  valueClass?: string;
  sub?: string;
  headerRight?: React.ReactNode;
}) {
  return (
    <div className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-mono text-muted uppercase tracking-widest">{label}</span>
        {headerRight}
      </div>
      <span className={`text-xl font-mono font-semibold ${valueClass}`}>{value}</span>
      {sub && <span className="text-xs font-mono text-muted">{sub}</span>}
    </div>
  );
}

function signedPfx(v: number | null) {
  if (v == null) return "";
  return v >= 0 ? "+" : "";
}

export default function HoldingsPage() {
  const { fromUsd, currencyLabel } = useCurrency();
  const fmtDisplayCurrency = useCallback(
    (
      amount: number | null | undefined,
      decimals = 0,
      opts?: { forceSign?: boolean },
    ): string => {
      if (amount == null) return "—";
      const abs = Math.abs(amount);
      const num = new Intl.NumberFormat("en-CA", {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
      }).format(abs);
      const symbol = currencyLabel === "CAD" ? "CA$" : "US$";
      if (opts?.forceSign) {
        const sign = amount > 0 ? "+" : amount < 0 ? "-" : "";
        return `${sign}${symbol}${num}`;
      }
      const sign = amount < 0 ? "-" : "";
      return `${sign}${symbol}${num}`;
    },
    [currencyLabel],
  );

  const [snapshot, setSnapshot] = useState<HoldingsSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const lastFetchRef = useRef<Date>(new Date());

  const [sortKey, setSortKey] = useState<SortKey>("total_value");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [showForm, setShowForm] = useState(false);
  const [formTicker, setFormTicker] = useState("");
  const [formShares, setFormShares] = useState("");
  const [formCost, setFormCost] = useState("");
  const [formCostCurrency, setFormCostCurrency] = useState<FormCurrency>("USD");
  const [formNotes, setFormNotes] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [changeWindow, setChangeWindow] = useState<ChangeWindow>("1D");
  const [tickerSuggestions, setTickerSuggestions] = useState<TickerSuggestion[]>([]);
  const [tickerSuggesting, setTickerSuggesting] = useState(false);
  const [showTickerSuggestions, setShowTickerSuggestions] = useState(false);
  const suggestReqRef = useRef(0);

  const [editId, setEditId] = useState<string | null>(null);

  const fetchHoldings = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const data = await getHoldings();
      setSnapshot(data);
      lastFetchRef.current = new Date();
      setSecondsAgo(0);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to load holdings");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchHoldings();
    const refreshTimer = setInterval(() => fetchHoldings(true), REFRESH_INTERVAL_MS);
    return () => clearInterval(refreshTimer);
  }, [fetchHoldings]);

  useEffect(() => {
    const tick = setInterval(() => {
      const diff = Math.floor((Date.now() - lastFetchRef.current.getTime()) / 1000);
      setSecondsAgo(diff);
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (!showForm) {
      setTickerSuggestions([]);
      setTickerSuggesting(false);
      setShowTickerSuggestions(false);
      return;
    }
    const query = formTicker.trim();
    if (!query) {
      setTickerSuggestions([]);
      setTickerSuggesting(false);
      return;
    }

    const reqId = ++suggestReqRef.current;
    setTickerSuggesting(true);
    const timer = window.setTimeout(async () => {
      try {
        const suggestions = await getTickerSuggestions(query, 8);
        if (reqId !== suggestReqRef.current) return;
        setTickerSuggestions(suggestions);
      } catch {
        if (reqId !== suggestReqRef.current) return;
        setTickerSuggestions([]);
      } finally {
        if (reqId === suggestReqRef.current) {
          setTickerSuggesting(false);
        }
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [formTicker, showForm]);

  const sorted = snapshot
    ? [...snapshot.holdings].sort((a, b) => {
        const av = a[sortKey] ?? -Infinity;
        const bv = b[sortKey] ?? -Infinity;
        if (typeof av === "string") {
          return sortDir === "asc"
            ? av.localeCompare(bv as string)
            : (bv as string).localeCompare(av);
        }
        return sortDir === "asc" ? (av as number) - (bv as number) : (bv as number) - (av as number);
      })
    : [];

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortArrow({ k }: { k: SortKey }) {
    if (sortKey !== k) return <span className="text-border ml-1">^v</span>;
    return <span className="text-accent ml-1">{sortDir === "asc" ? "^" : "v"}</span>;
  }

  const TICKER_REGEX = /^[A-Z0-9]{1,6}(\.[A-Z]{1,3})?$/;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const tickerNorm = formTicker.trim().toUpperCase();
    const shares = parseFloat(formShares);
    const cost = parseFloat(formCost);
    if (!tickerNorm) {
      setFormError("Ticker is required");
      return;
    }
    if (!TICKER_REGEX.test(tickerNorm)) {
      setFormError("Invalid ticker format. Use 1–6 letters/digits, e.g. AAPL or VFV.TO");
      return;
    }
    if (Number.isNaN(shares) || shares <= 0) {
      setFormError("Shares must be > 0");
      return;
    }
    if (Number.isNaN(cost) || cost <= 0) {
      setFormError("Avg cost must be > 0");
      return;
    }

    setFormSubmitting(true);
    try {
      const payload: HoldingIn = {
        ticker: tickerNorm,
        shares,
        avg_cost_per_share: cost,
        avg_cost_currency: formCostCurrency,
        notes: formNotes.trim() || undefined,
      };
      if (editId) {
        await updateHolding(editId, payload);
      } else {
        await addHolding(payload);
      }
      setShowForm(false);
      setEditId(null);
      setFormTicker("");
      setFormShares("");
      setFormCost("");
      setFormCostCurrency("USD");
      setFormNotes("");
      setTickerSuggestions([]);
      setShowTickerSuggestions(false);
      await fetchHoldings();
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Failed to save holding");
    } finally {
      setFormSubmitting(false);
    }
  }

  function startEdit(h: HoldingLive) {
    setEditId(h.id);
    setFormTicker(h.ticker);
    setFormShares(String(h.shares));
    setFormCost(String(h.avg_cost_per_share));
    setFormCostCurrency(h.avg_cost_currency);
    setFormNotes(h.notes ?? "");
    setShowTickerSuggestions(false);
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirm("Remove this holding?")) return;
    await deleteHolding(id);
    await fetchHoldings();
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-panel border border-border rounded-lg h-20" />
          ))}
        </div>
        <div className="bg-panel border border-border rounded-lg h-64" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-panel border border-negative/30 rounded-lg p-6 text-center space-y-3">
        <p className="text-negative font-mono text-sm">{error}</p>
        <button
          onClick={() => fetchHoldings()}
          className="text-xs font-mono text-accent border border-accent/30 rounded px-3 py-1 hover:bg-accent/10 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  const s = snapshot!;
  let changeLabel = "Day";
  let topChange = s.total_day_change;
  let topChangePct = s.total_day_change_pct;
  if (changeWindow === "1W") {
    changeLabel = "Week";
    topChange = s.total_week_change;
    topChangePct = s.total_week_change_pct;
  } else if (changeWindow === "1M") {
    changeLabel = "Month";
    topChange = s.total_month_change;
    topChangePct = s.total_month_change_pct;
  } else if (changeWindow === "1Y") {
    changeLabel = "Year";
    topChange = s.total_year_change;
    topChangePct = s.total_year_change_pct;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Holdings Terminal</h1>
          <p className="text-xs font-mono text-muted mt-0.5">
            {refreshing ? "Refreshing prices..." : `Updated ${secondsAgo}s ago | auto-refresh 30s`}
          </p>
          <p className="text-[10px] font-mono text-muted mt-0.5">
            Yahoo prices are sourced in USD and converted to {currencyLabel} for display.
          </p>
        </div>
        <button
          onClick={() => fetchHoldings(true)}
          disabled={refreshing}
          className="text-xs font-mono text-accent border border-accent/30 rounded px-3 py-1.5 hover:bg-accent/10 transition-colors disabled:opacity-40"
        >
          {refreshing ? "..." : "Refresh"}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <MetricTile
          label={`Total Value (${currencyLabel})`}
          value={fmtDisplayCurrency(fromUsd(s.total_value))}
          valueClass="text-accent"
          sub={`Cost basis ${fmtDisplayCurrency(fromUsd(s.total_cost_basis))}`}
        />
        <MetricTile
          label={`Unrealized P&L (${currencyLabel})`}
          value={
            s.total_unrealized_pnl != null
              ? fmtDisplayCurrency(fromUsd(s.total_unrealized_pnl), 0, { forceSign: true })
              : "-"
          }
          valueClass={signedClass(s.total_unrealized_pnl)}
          sub={
            s.total_unrealized_pnl_pct != null
              ? `${signedPfx(s.total_unrealized_pnl_pct)}${fmtPct(s.total_unrealized_pnl_pct)}`
              : undefined
          }
        />
        <MetricTile
          label={`${changeLabel} Change (${currencyLabel})`}
          value={
            topChange != null
              ? fmtDisplayCurrency(fromUsd(topChange), 0, { forceSign: true })
              : "-"
          }
          valueClass={signedClass(topChange)}
          sub={
            topChangePct != null
              ? `${signedPfx(topChangePct)}${fmtPct(topChangePct)}`
              : undefined
          }
          headerRight={
            <div className="inline-flex items-center rounded border border-border overflow-hidden">
              {(["1D", "1W", "1M", "1Y"] as ChangeWindow[]).map((window) => (
                <button
                  key={window}
                  type="button"
                  onClick={() => setChangeWindow(window)}
                  className={`px-1.5 py-0.5 text-[10px] font-mono transition-colors ${
                    changeWindow === window
                      ? "bg-accent text-surface"
                      : "text-muted hover:text-accent hover:bg-accent/10"
                  }`}
                >
                  {window}
                </button>
              ))}
            </div>
          }
        />
        <MetricTile
          label="Sharpe (30d)"
          value={s.sharpe_30d != null ? fmt(s.sharpe_30d) : "-"}
          valueClass={s.sharpe_30d != null ? signedClass(s.sharpe_30d) : "text-muted"}
          sub="Annualised"
        />
        <MetricTile
          label="Sortino (30d)"
          value={s.sortino_30d != null ? fmt(s.sortino_30d) : "-"}
          valueClass={s.sortino_30d != null ? signedClass(s.sortino_30d) : "text-muted"}
          sub="Annualised"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 min-w-0">
        <div className="lg:col-span-2 min-w-0 bg-panel border border-border rounded-lg p-4">
          <p className="text-xs font-mono text-muted uppercase tracking-widest mb-3">Allocation</p>
          <div style={{ height: 280 }}>
            <AllocationPieChart holdings={s.holdings} />
          </div>
        </div>

        <div className="lg:col-span-3 min-w-0 bg-panel border border-border rounded-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-mono text-muted uppercase tracking-widest">Positions</p>
            <button
              onClick={() => {
                setEditId(null);
                setFormTicker("");
                setFormShares("");
                setFormCost("");
                setFormCostCurrency("USD");
                setFormNotes("");
                setFormError(null);
                setTickerSuggestions([]);
                setShowTickerSuggestions(false);
                setShowForm((v) => !v);
              }}
              className="text-xs font-mono text-accent border border-accent/30 rounded px-2.5 py-1 hover:bg-accent/10 transition-colors"
            >
              + Add
            </button>
          </div>

          {s.holdings.length === 0 && !showForm ? (
            <div className="text-center py-12 text-muted text-xs font-mono">
              No holdings yet. Click + Add to get started.
            </div>
          ) : (
            <div className="relative overflow-x-auto overflow-y-auto max-h-[62vh] rounded border border-border/40">
              <table className="w-full min-w-[980px] text-xs font-mono whitespace-nowrap">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="border-b border-border text-muted">
                    {(
                      [
                        { key: "ticker", label: "Ticker" },
                        { key: "total_value", label: "Value" },
                        { key: "unrealized_pnl_pct", label: "P&L %" },
                        { key: "day_change_pct", label: "Day %" },
                        { key: "weight", label: "Weight" },
                      ] as { key: SortKey; label: string }[]
                    ).map(({ key, label }) => (
                      <th
                        key={key}
                        className="py-2 pr-4 text-left cursor-pointer hover:text-accent select-none"
                        onClick={() => toggleSort(key)}
                      >
                        {label}
                        <SortArrow k={key} />
                      </th>
                    ))}
                    <th className="py-2 text-left text-muted">Price</th>
                    <th className="py-2 text-left text-muted">Cost/Share</th>
                    <th className="py-2 text-left text-muted">Shares</th>
                    <th className="py-2 pl-2 pr-3 text-right text-muted sticky right-0 z-20 bg-panel shadow-[-12px_0_16px_-16px_rgba(0,0,0,0.9)]">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((h) => (
                    <tr key={h.id} className="border-b border-border/40 hover:bg-surface/50 transition-colors">
                      <td className="py-2.5 pr-4">
                        <div className="font-semibold text-accent">{h.ticker}</div>
                        {h.name && <div className="text-muted text-[10px] truncate max-w-[100px]">{h.name}</div>}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {fmtDisplayCurrency(fromUsd(h.total_value))}
                      </td>
                      <td className={`py-2.5 pr-4 text-right tabular-nums ${signedClass(h.unrealized_pnl_pct)}`}>
                        {h.unrealized_pnl_pct != null
                          ? `${signedPfx(h.unrealized_pnl_pct)}${fmtPct(h.unrealized_pnl_pct)}`
                          : "-"}
                      </td>
                      <td className={`py-2.5 pr-4 text-right tabular-nums ${signedClass(h.day_change_pct)}`}>
                        {h.day_change_pct != null
                          ? `${signedPfx(h.day_change_pct)}${fmtPct(h.day_change_pct)}`
                          : "-"}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted">
                        {h.weight != null ? `${(h.weight * 100).toFixed(1)}%` : "-"}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums">
                        {h.current_price != null ? fmtDisplayCurrency(fromUsd(h.current_price), 2) : "-"}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted">
                        {fmtDisplayCurrency(
                          fromUsd(
                            h.avg_cost_per_share_usd ??
                              (h.avg_cost_currency === "USD" ? h.avg_cost_per_share : null),
                          ),
                          2,
                        )}
                      </td>
                      <td className="py-2.5 pr-4 text-right tabular-nums text-muted">{h.shares.toLocaleString()}</td>
                      <td className="py-2.5 pl-2 pr-3 text-right sticky right-0 z-10 bg-panel/95 backdrop-blur shadow-[-12px_0_16px_-16px_rgba(0,0,0,0.9)]">
                        <div className="inline-flex items-center gap-1">
                          <button
                            onClick={() => startEdit(h)}
                            className="rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold text-accent hover:bg-accent/20 transition-colors"
                            title={`Edit ${h.ticker}`}
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(h.id)}
                            className="rounded border border-negative/40 bg-negative/10 px-2 py-0.5 text-[10px] font-semibold text-negative hover:bg-negative/20 transition-colors"
                            title={`Delete ${h.ticker}`}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {showForm && (
            <form
              onSubmit={handleAdd}
              className="mt-4 border-t border-border pt-4 grid grid-cols-2 md:grid-cols-5 gap-3"
            >
              <div className="col-span-2 md:col-span-1">
                <label className="block text-[10px] font-mono text-muted mb-1 uppercase">Ticker</label>
                <div className="relative">
                  <input
                    className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs font-mono text-accent uppercase focus:outline-none focus:border-accent"
                    value={formTicker}
                    onChange={(e) => {
                      setFormTicker(e.target.value.toUpperCase());
                      setShowTickerSuggestions(true);
                    }}
                    onFocus={() => setShowTickerSuggestions(true)}
                    onBlur={() => window.setTimeout(() => setShowTickerSuggestions(false), 120)}
                    placeholder="AAPL"
                    maxLength={10}
                    required
                  />
                  {showTickerSuggestions && (tickerSuggesting || tickerSuggestions.length > 0) && (
                    <div className="absolute z-30 mt-1 w-full rounded border border-border bg-panel shadow-xl max-h-52 overflow-y-auto">
                      {tickerSuggesting ? (
                        <div className="px-2 py-2 text-[10px] font-mono text-muted">Searching symbols...</div>
                      ) : (
                        tickerSuggestions.map((item) => (
                          <button
                            key={`${item.symbol}:${item.exchange ?? ""}`}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setFormTicker(item.symbol);
                              setShowTickerSuggestions(false);
                            }}
                            className="w-full px-2 py-1.5 text-left border-b last:border-b-0 border-border/50 hover:bg-accent/10 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-xs font-mono text-accent">{item.symbol}</span>
                              {item.exchange && (
                                <span className="text-[10px] font-mono text-muted">{item.exchange}</span>
                              )}
                            </div>
                            {item.name && (
                              <div className="text-[10px] font-mono text-muted truncate">{item.name}</div>
                            )}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-mono text-muted mb-1 uppercase">Shares</label>
                <input
                  type="number"
                  step="any"
                  min="0.000001"
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-accent"
                  value={formShares}
                  onChange={(e) => setFormShares(e.target.value)}
                  placeholder="10"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-muted mb-1 uppercase">Avg Cost</label>
                <input
                  type="number"
                  step="any"
                  min="0.000001"
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-accent"
                  value={formCost}
                  onChange={(e) => setFormCost(e.target.value)}
                  placeholder="150.00"
                  required
                />
              </div>
              <div>
                <label className="block text-[10px] font-mono text-muted mb-1 uppercase">Cost Currency</label>
                <select
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-accent"
                  value={formCostCurrency}
                  onChange={(e) => setFormCostCurrency(e.target.value as FormCurrency)}
                >
                  <option value="USD">USD</option>
                  <option value="CAD">CAD</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-mono text-muted mb-1 uppercase">Notes</label>
                <input
                  className="w-full bg-surface border border-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-accent"
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              {formError && <div className="col-span-2 md:col-span-5 text-negative text-xs font-mono">{formError}</div>}
              <div className="col-span-2 md:col-span-5 flex gap-2">
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="text-xs font-mono bg-accent text-surface rounded px-4 py-1.5 hover:bg-accent/80 transition-colors disabled:opacity-40"
                >
                  {formSubmitting ? "Saving..." : editId ? "Update" : "Add Holding"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setEditId(null);
                    setFormError(null);
                    setTickerSuggestions([]);
                    setShowTickerSuggestions(false);
                  }}
                  className="text-xs font-mono text-muted border border-border rounded px-3 py-1.5 hover:text-accent transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}
        </div>
      </div>

      {s.holdings.length > 0 && (
        <div className="bg-panel border border-border rounded-lg p-4">
          <p className="text-xs font-mono text-muted uppercase tracking-widest mb-4">30-Day Price History</p>
          <div className="flex flex-wrap gap-6">
            {s.holdings.map((h) => (
              <div key={h.id} className="flex flex-col items-center gap-1">
                <span className="text-[10px] font-mono text-muted">{h.ticker}</span>
                <HoldingSparkline data={h.sparkline} />
                <span className={`text-[10px] font-mono ${signedClass(h.day_change_pct)}`}>
                  {h.day_change_pct != null ? `${signedPfx(h.day_change_pct)}${fmtPct(h.day_change_pct)}` : "-"}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


