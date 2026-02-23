"use client";

import { useState, useRef } from "react";
import { previewExcel, importExcel } from "@/lib/api";
import type { ParsePreview, ImportResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import Link from "next/link";

type Step = "upload" | "preview" | "done";

export default function ImportPage() {
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [dayfirst, setDayfirst] = useState(false);
  const [preview, setPreview] = useState<ParsePreview | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (f: File) => {
    if (!f.name.endsWith(".xlsx")) {
      setError("Only .xlsx files are accepted.");
      return;
    }
    setError(null);
    setFile(f);
    setLoading(true);
    try {
      const prev = await previewExcel(f);
      setPreview(prev);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!file) return;
    setLoading(true);
    setError(null);
    try {
      const res = await importExcel(file, dayfirst);
      setResult(res);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-100">Import Portfolio</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Upload an .xlsx file with weekly portfolio and benchmark returns.
        </p>
      </div>

      {/* Steps indicator */}
      <div className="flex items-center gap-3 text-xs font-mono">
        {(["upload", "preview", "done"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            {i > 0 && <span className="text-border">→</span>}
            <span className={cn(step === s ? "text-accent" : step > s ? "text-positive" : "text-muted")}>
              {step > s ? "✓" : String(i + 1)}.{" "}
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          </div>
        ))}
      </div>

      {/* Step: Upload */}
      {step === "upload" && (
        <div
          className="border-2 border-dashed border-border rounded-xl p-10 text-center cursor-pointer hover:border-accent/40 transition-colors"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f) handleFileChange(f);
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
          />
          <p className="text-4xl mb-3">⬆</p>
          <p className="text-sm text-gray-300">
            Drop your .xlsx file here or <span className="text-accent">click to browse</span>
          </p>
          <p className="text-xs text-muted mt-2 font-mono">Max 10 MB · .xlsx only</p>
          {loading && <p className="text-xs text-muted mt-3 font-mono animate-pulse">Parsing…</p>}
        </div>
      )}

      {/* Step: Preview */}
      {step === "preview" && preview && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-mono text-gray-200">
                {file?.name} — {preview.row_count} rows detected
              </p>
              {preview.errors.map((e, i) => (
                <p key={i} className="text-xs font-mono text-caution mt-0.5">{e}</p>
              ))}
            </div>
            <button
              onClick={() => { setStep("upload"); setFile(null); setPreview(null); }}
              className="text-xs font-mono text-muted hover:text-gray-200"
            >
              ← Change file
            </button>
          </div>

          {/* Columns */}
          <div>
            <p className="text-xs font-mono text-muted uppercase tracking-wider mb-1">
              Detected Columns
            </p>
            <div className="flex flex-wrap gap-1.5">
              {preview.columns.map((col) => (
                <span key={col} className="text-xs font-mono bg-border/50 rounded px-2 py-0.5 text-gray-300">
                  {col}
                </span>
              ))}
            </div>
          </div>

          {/* Sample rows */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="bg-surface">
                  <tr>
                    {preview.columns.map((col) => (
                      <th key={col} className="px-3 py-2 text-left text-muted border-b border-border whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-white/[0.02]">
                      {preview.columns.map((col) => (
                        <td key={col} className="px-3 py-1.5 text-gray-300 whitespace-nowrap">
                          {row[col] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs font-mono text-muted px-3 py-2 border-t border-border">
              Showing first 10 rows
            </p>
          </div>

          {/* Options */}
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={dayfirst}
              onChange={(e) => setDayfirst(e.target.checked)}
              className="rounded border-border bg-surface accent-accent"
            />
            <span className="text-xs font-mono text-gray-300">
              Date format is DD/MM/YYYY (day first)
            </span>
          </label>

          {error && (
            <p className="text-xs font-mono text-negative bg-red-950 border border-negative/30 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            onClick={handleImport}
            disabled={loading}
            className="bg-accent text-surface font-mono text-sm font-semibold px-6 py-2 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "Importing…" : "Confirm Import"}
          </button>
        </div>
      )}

      {/* Step: Done */}
      {step === "done" && result && (
        <div className="bg-panel border border-positive/30 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-2xl text-positive">✓</span>
            <div>
              <p className="font-semibold text-gray-100">Import Complete</p>
              <p className="text-xs font-mono text-muted">{result.message}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="bg-surface border border-border rounded p-3">
              <p className="text-muted">File</p>
              <p className="text-gray-200 mt-0.5 truncate">{result.filename}</p>
            </div>
            <div className="bg-surface border border-border rounded p-3">
              <p className="text-muted">Rows</p>
              <p className="text-gray-200 mt-0.5">{result.row_count}</p>
            </div>
            <div className="bg-surface border border-border rounded p-3">
              <p className="text-muted">Regime</p>
              <p className="text-gray-200 mt-0.5">{result.regime}</p>
            </div>
          </div>

          <p className="text-xs text-muted">{result.regime_explanation}</p>

          <div className="flex gap-3">
            <Link
              href="/"
              className="text-sm font-mono text-accent hover:underline"
            >
              → View Dashboard
            </Link>
            <button
              onClick={() => { setStep("upload"); setFile(null); setPreview(null); setResult(null); }}
              className="text-sm font-mono text-muted hover:text-gray-200"
            >
              Import another
            </button>
          </div>
        </div>
      )}

      {/* Template hint */}
      <div className="bg-panel border border-border rounded-lg p-4 text-xs font-mono text-muted space-y-1">
        <p className="text-gray-300 font-semibold">Required columns:</p>
        <p>Date · Total Value · Net Deposits · Period Deposits · Period Return · SPY Period Return</p>
        <p className="mt-1">Currency: $100,000.00 · Percent: 3.65% · Date: MM/DD/YYYY or DD/MM/YYYY</p>
      </div>
    </div>
  );
}
