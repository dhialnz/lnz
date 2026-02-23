"use client";

import type { Recommendation } from "@/lib/types";
import { cn, fmtDate, riskColor } from "@/lib/utils";

interface RecommendationModalProps {
  rec: Recommendation | null;
  onClose: () => void;
}

export function RecommendationModal({ rec, onClose }: RecommendationModalProps) {
  if (!rec) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative z-10 bg-panel border border-border rounded-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-5 border-b border-border">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-semibold text-gray-100">{rec.title}</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className={cn("text-xs font-mono font-semibold", riskColor(rec.risk_level))}>
                {rec.risk_level} Risk
              </span>
              <span className="text-xs font-mono text-muted">{rec.category}</span>
              <span className="text-xs font-mono text-muted">
                Confidence: {(rec.confidence * 100).toFixed(0)}%
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-muted hover:text-gray-200 transition-colors ml-4 font-mono text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-5">
          {/* Explanation */}
          <section>
            <h3 className="text-xs font-mono text-muted uppercase tracking-wider mb-2">
              Explanation
            </h3>
            <p className="text-sm text-gray-300 leading-relaxed">{rec.explanation}</p>
          </section>

          {/* Triggers */}
          {rec.triggers.length > 0 && (
            <section>
              <h3 className="text-xs font-mono text-muted uppercase tracking-wider mb-2">
                Rule Triggers
              </h3>
              <ul className="space-y-1">
                {rec.triggers.map((t, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-xs font-mono text-gray-300"
                  >
                    <span className="text-accent mt-0.5">▸</span>
                    {t}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Supporting metrics */}
          {Object.keys(rec.supporting_metrics).length > 0 && (
            <section>
              <h3 className="text-xs font-mono text-muted uppercase tracking-wider mb-2">
                Supporting Metrics
              </h3>
              <div className="bg-surface rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs font-mono">
                  <tbody>
                    {Object.entries(rec.supporting_metrics).map(([k, v]) => (
                      <tr key={k} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-muted">{k}</td>
                        <td className="px-3 py-2 text-gray-200 text-right">
                          {typeof v === "number" ? v.toFixed(6) : String(v)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Actions */}
          {rec.actions.length > 0 && (
            <section>
              <h3 className="text-xs font-mono text-muted uppercase tracking-wider mb-2">
                Suggested Actions
              </h3>
              <ol className="space-y-2">
                {rec.actions.map((action, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="font-mono text-accent text-xs mt-0.5 flex-shrink-0">
                      {String(i + 1).padStart(2, "0")}.
                    </span>
                    {action}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Timestamp */}
          <p className="text-xs font-mono text-muted border-t border-border pt-3">
            Generated: {fmtDate(rec.created_at)}
          </p>
        </div>
      </div>
    </div>
  );
}
