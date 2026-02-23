"use client";

import { useState, useEffect } from "react";
import { getRulebook, updateRulebook } from "@/lib/api";
import type { Rulebook } from "@/lib/types";

export default function RulebookPage() {
  const [rulebook, setRulebook] = useState<Rulebook | null>(null);
  const [thresholds, setThresholds] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getRulebook()
      .then((rb) => {
        setRulebook(rb);
        setThresholds({ ...rb.thresholds });
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateRulebook({ thresholds });
      setRulebook(updated);
      setThresholds({ ...updated.thresholds });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-muted font-mono text-sm">Loading…</div>;
  if (!rulebook) return <div className="text-negative font-mono text-sm">{error}</div>;

  const THRESHOLD_LABELS: Record<string, string> = {
    drawdown_defensive: "Defensive Drawdown Trigger",
    drawdown_hard_stop: "Hard Stop Drawdown",
    vol8_high: "Vol8 High Threshold",
    concentration_trim: "Concentration Trim Limit",
    deploy_tranche_1: "Deploy Tranche 1 (%)",
    deploy_tranche_2: "Deploy Tranche 2 (%)",
    deploy_tranche_3: "Deploy Tranche 3 (%)",
    expansion_drawdown: "Expansion Drawdown Floor",
    near_peak_pct: "Near-Peak Buffer",
    profit_taking_mtd: "MTD Profit Taking Trigger",
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-100">Rulebook</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Deterministic rule thresholds and rule text. All changes are logged.
        </p>
      </div>

      {/* Thresholds */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-100">Thresholds</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.entries(thresholds).map(([key, value]) => (
            <div key={key}>
              <label className="text-xs font-mono text-muted block mb-1">
                {THRESHOLD_LABELS[key] ?? key}
              </label>
              <input
                type="number"
                step="0.001"
                value={value}
                onChange={(e) =>
                  setThresholds((prev) => ({
                    ...prev,
                    [key]: parseFloat(e.target.value),
                  }))
                }
                className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          ))}
        </div>

        {error && (
          <p className="text-xs font-mono text-negative">{error}</p>
        )}

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-accent text-surface font-mono text-sm font-semibold px-5 py-2 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "✓ Saved" : "Save Thresholds"}
        </button>
      </div>

      {/* Rule text */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-100">Rule Definitions</h2>
        <div className="bg-surface border border-border rounded-lg p-4 text-xs font-mono text-gray-300 whitespace-pre-wrap leading-relaxed max-h-96 overflow-y-auto">
          {rulebook.text}
        </div>
        <p className="text-xs font-mono text-muted">
          Updated: {new Date(rulebook.updated_at).toLocaleString()}
        </p>
      </div>
    </div>
  );
}
