"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { addManualWeek, getSeries, syncSpyHistory } from "@/lib/api";
import type { ManualWeekEntryInput, PortfolioSeriesRow } from "@/lib/types";
import { DataTable, type Column } from "@/components/DataTable";
import { fmt, fmtCurrency, fmtPct } from "@/lib/utils";

type FormState = {
  total_value: string;
  net_deposits: string;
};

const INITIAL_FORM: FormState = {
  total_value: "",
  net_deposits: "",
};

function parseNumericInput(value: string): number {
  return Number(value.replaceAll(",", "").replaceAll("$", "").trim());
}

function nextWeekDateStr(isoDate: string | null): string {
  if (!isoDate) return "N/A";
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + 7);
  return d.toISOString().slice(0, 10);
}

export default function DataPage() {
  const [rows, setRows] = useState<PortfolioSeriesRow[]>([]);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const latestDate = rows.length > 0 ? rows[rows.length - 1].date : null;
  const nextDate = nextWeekDateStr(latestDate);

  const columns: Column<PortfolioSeriesRow>[] = useMemo(
    () => [
      { key: "date", label: "Date", sortable: true },
      { key: "total_value", label: "Total Value", sortable: true, render: (r) => fmtCurrency(r.total_value) },
      { key: "net_deposits", label: "Net Deposits", sortable: true, render: (r) => fmtCurrency(r.net_deposits) },
      { key: "period_deposits", label: "Period Deposits", sortable: true, render: (r) => fmtCurrency(r.period_deposits) },
      { key: "spy_close", label: "SPY Close", sortable: true, render: (r) => fmt(r.spy_close, 2) },
      { key: "period_return", label: "Period Return", sortable: true, render: (r) => fmtPct(r.period_return, 3) },
      { key: "benchmark_return", label: "SPY Return", sortable: true, render: (r) => fmtPct(r.benchmark_return, 3) },
      { key: "alpha", label: "Alpha", sortable: true, render: (r) => fmtPct(r.alpha, 3) },
      { key: "cumulative_alpha", label: "Cum Alpha", sortable: true, render: (r) => fmtPct(r.cumulative_alpha, 3) },
      { key: "rolling_4w_alpha", label: "4w Alpha", sortable: true, render: (r) => fmtPct(r.rolling_4w_alpha, 3) },
      { key: "rolling_8w_vol", label: "8w Vol", sortable: true, render: (r) => fmtPct(r.rolling_8w_vol, 3) },
      { key: "rolling_8w_alpha_vol", label: "8w Alpha Vol", sortable: true, render: (r) => fmtPct(r.rolling_8w_alpha_vol, 3) },
      { key: "running_peak", label: "Running Peak", sortable: true, render: (r) => fmtCurrency(r.running_peak) },
      { key: "drawdown", label: "Drawdown", sortable: true, render: (r) => fmtPct(r.drawdown, 2) },
      { key: "beta_12w", label: "Beta 12w", sortable: true, render: (r) => fmt(r.beta_12w, 3) },
    ],
    [],
  );

  const loadRows = async (withSync = false) => {
    setLoading(true);
    setError(null);
    try {
      if (withSync) {
        await syncSpyHistory();
      }
      const data = await getSeries();
      setRows(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadRows(true);
  }, []);

  const onChange = (key: keyof FormState, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    try {
      const payload: ManualWeekEntryInput = {
        total_value: parseNumericInput(form.total_value),
        net_deposits: parseNumericInput(form.net_deposits),
      };

      if (!Number.isFinite(payload.total_value) || payload.total_value <= 0) {
        throw new Error("Total Value must be a positive number.");
      }
      if (!Number.isFinite(payload.net_deposits)) {
        throw new Error("Net Deposits must be a valid number.");
      }
      setSaving(true);
      const result = await addManualWeek(payload);
      setSuccess(
        `${result.message} Added ${result.date}. SPY Close: ${fmt(result.spy_close, 2)}. Period Deposits: ${fmtCurrency(result.period_deposits)}. Portfolio Return: ${fmtPct(result.period_return, 3)}. SPY Return: ${fmtPct(result.benchmark_return, 3)}.`,
      );
      setForm(INITIAL_FORM);
      await loadRows();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add weekly data");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted font-mono text-sm">
        Loading...
      </div>
    );
  }

  if (error && rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted font-mono text-sm">{error}</p>
        <Link href="/import" className="text-accent font-mono text-sm hover:underline">
          Import portfolio data first
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Portfolio Data</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          View all weekly rows and append new weeks manually.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-100 mb-1">Add Weekly Row</h2>
        <p className="text-xs font-mono text-muted mb-4">
          Auto date is fixed to one week after latest entry: {nextDate}. SPY close is fetched automatically from Yahoo Finance.
        </p>

        <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            placeholder="Total Value (e.g. 120000)"
            value={form.total_value}
            onChange={(e) => onChange("total_value", e.target.value)}
            className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono text-gray-200"
          />
          <input
            placeholder="Net Deposits"
            value={form.net_deposits}
            onChange={(e) => onChange("net_deposits", e.target.value)}
            className="bg-surface border border-border rounded px-3 py-2 text-xs font-mono text-gray-200"
          />
          <div className="md:col-span-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="bg-accent text-surface font-mono text-sm font-semibold px-5 py-2 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Saving..." : "Add Weekly Data"}
            </button>
            {success && <p className="text-xs font-mono text-positive">{success}</p>}
            {error && <p className="text-xs font-mono text-negative">{error}</p>}
          </div>
        </form>
      </div>

      <div className="bg-panel border border-border rounded-xl p-4">
        <h2 className="text-sm font-semibold text-gray-100 mb-3">All Rows</h2>
        <DataTable<PortfolioSeriesRow>
          columns={columns}
          data={rows}
          rowKey="id"
          emptyMessage="No rows found."
        />
      </div>
    </div>
  );
}
