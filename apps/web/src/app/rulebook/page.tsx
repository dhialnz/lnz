"use client";

import { useState, useEffect, useRef } from "react";
import { getRulebook, recommendRulebookThresholds, updateRulebook } from "@/lib/api";
import type { RiskQuizInput, RiskQuizRecommendation, Rulebook, RulebookThresholds } from "@/lib/types";

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

const DEFAULT_QUIZ: RiskQuizInput = {
  age: 35,
  investment_horizon_years: 10,
  liquidity_needs: "medium",
  drawdown_tolerance: "medium",
  investing_experience: "intermediate",
};

export default function RulebookPage() {
  const [rulebook, setRulebook] = useState<Rulebook | null>(null);
  const [thresholds, setThresholds] = useState<RulebookThresholds>({
    drawdown_defensive: -0.08,
    drawdown_hard_stop: -0.10,
    vol8_high: 0.04,
    concentration_trim: 0.15,
    deploy_tranche_1: 0.30,
    deploy_tranche_2: 0.30,
    deploy_tranche_3: 0.40,
    expansion_drawdown: -0.03,
    near_peak_pct: 0.02,
    profit_taking_mtd: 0.06,
  });
  const [quiz, setQuiz] = useState<RiskQuizInput>(DEFAULT_QUIZ);
  const [recommendation, setRecommendation] = useState<RiskQuizRecommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dirtyThresholds, setDirtyThresholds] = useState(false);
  const [autosaveNote, setAutosaveNote] = useState<string | null>(null);
  const initializedRef = useRef(false);
  const quizHydratedRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const QUIZ_STORAGE_KEY = "lnz_rulebook_quiz";
  const updateQuiz = (updater: (current: RiskQuizInput) => RiskQuizInput) => {
    setQuiz((current) => {
      const next = updater(current);
      try {
        localStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage failures are non-fatal
      }
      return next;
    });
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUIZ_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as RiskQuizInput;
        setQuiz(parsed);
      }
    } catch {
      // ignore malformed local storage
    }
    quizHydratedRef.current = true;

    getRulebook()
      .then((rb) => {
        setRulebook(rb);
        setThresholds({ ...rb.thresholds });
        initializedRef.current = true;
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const persistThresholds = async (nextThresholds: RulebookThresholds) => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateRulebook({ thresholds: nextThresholds });
      setRulebook(updated);
      setThresholds({ ...updated.thresholds });
      setDirtyThresholds(false);
      setSaved(true);
      setAutosaveNote("Thresholds auto-saved.");
      setTimeout(() => setSaved(false), 2000);
      setTimeout(() => setAutosaveNote(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async () => {
    await persistThresholds(thresholds);
  };

  const handleRecommend = async () => {
    setSaving(true);
    setError(null);
    try {
      const rec = await recommendRulebookThresholds(quiz);
      setRecommendation(rec);
      const next = { ...rec.thresholds };
      setThresholds(next);
      await persistThresholds(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Recommendation failed");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!initializedRef.current) return;
    if (!dirtyThresholds) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      persistThresholds(thresholds);
    }, 800);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [thresholds, dirtyThresholds]);

  const handleClearAll = async () => {
    setSaving(true);
    setError(null);
    try {
      localStorage.removeItem(QUIZ_STORAGE_KEY);
      const resetQuiz = { ...DEFAULT_QUIZ };
      setQuiz(resetQuiz);
      setRecommendation(null);
      const updated = await updateRulebook({ thresholds: {}, replace_thresholds: true });
      setRulebook(updated);
      setThresholds({ ...updated.thresholds });
      setDirtyThresholds(false);
      setAutosaveNote("Thresholds and risk quiz cleared.");
      setTimeout(() => setAutosaveNote(null), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Clear failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="text-muted font-mono text-sm">Loading...</div>;
  if (!rulebook) return <div className="text-negative font-mono text-sm">{error}</div>;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-4xl leading-none font-serif tracking-tight text-white">Rulebook</h1>
        <p className="text-xs font-mono text-muted mt-0.5">
          Thresholds + suitability quiz for a simplified asset-management workflow.
        </p>
      </div>

      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-100">Risk Quiz</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-mono text-muted block mb-1">Age</label>
            <input
              type="number"
              value={quiz.age}
              onChange={(e) => updateQuiz((q) => ({ ...q, age: parseInt(e.target.value || "0", 10) }))}
              className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-muted block mb-1">Investment Horizon (years)</label>
            <input
              type="number"
              value={quiz.investment_horizon_years}
              onChange={(e) =>
                updateQuiz((q) => ({ ...q, investment_horizon_years: parseInt(e.target.value || "0", 10) }))
              }
              className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200"
            />
          </div>
          <div>
            <label className="text-xs font-mono text-muted block mb-1">Liquidity Needs</label>
            <select
              value={quiz.liquidity_needs}
              onChange={(e) => updateQuiz((q) => ({ ...q, liquidity_needs: e.target.value as RiskQuizInput["liquidity_needs"] }))}
              className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div>
            <label className="text-xs font-mono text-muted block mb-1">Drawdown Tolerance</label>
            <select
              value={quiz.drawdown_tolerance}
              onChange={(e) => updateQuiz((q) => ({ ...q, drawdown_tolerance: e.target.value as RiskQuizInput["drawdown_tolerance"] }))}
              className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200"
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="text-xs font-mono text-muted block mb-1">Investing Experience</label>
            <select
              value={quiz.investing_experience}
              onChange={(e) =>
                updateQuiz((q) => ({ ...q, investing_experience: e.target.value as RiskQuizInput["investing_experience"] }))
              }
              className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200"
            >
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleRecommend}
            disabled={saving}
            className="bg-accent/20 text-accent border border-accent/40 font-mono text-sm font-semibold px-5 py-2 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Running..." : "Generate Recommended Thresholds"}
          </button>
          {recommendation && (
            <p className="text-xs font-mono text-positive">
              Profile: {recommendation.profile} (score {recommendation.score}/12)
            </p>
          )}
        </div>

        {recommendation && (
          <div className="bg-surface border border-border rounded p-3 space-y-1">
            {recommendation.rationale.map((r) => (
              <p key={r} className="text-xs font-mono text-muted">- {r}</p>
            ))}
          </div>
        )}
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
                  {
                    const next = parseFloat(e.target.value);
                    setThresholds((prev) => ({
                      ...prev,
                      [key]: next,
                    }));
                    setDirtyThresholds(true);
                  }
                }
                className="w-full bg-surface border border-border rounded px-3 py-1.5 text-sm font-mono text-gray-200 focus:outline-none focus:border-accent"
              />
            </div>
          ))}
        </div>

        {error && <p className="text-xs font-mono text-negative">{error}</p>}
        {autosaveNote && <p className="text-xs font-mono text-positive">{autosaveNote}</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="bg-accent text-surface font-mono text-sm font-semibold px-5 py-2 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {saving ? "Saving..." : saved ? "Saved" : "Save Thresholds"}
        </button>
        <button
          onClick={handleClearAll}
          disabled={saving}
          className="ml-3 bg-red-900/40 border border-red-700/50 text-red-300 font-mono text-sm font-semibold px-5 py-2 rounded hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          Clear Thresholds + Risk Quiz
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
