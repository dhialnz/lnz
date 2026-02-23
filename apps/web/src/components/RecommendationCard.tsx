"use client";

import type { Recommendation } from "@/lib/types";
import { cn, riskColor } from "@/lib/utils";

interface RecommendationCardProps {
  rec: Recommendation;
  onClick: () => void;
}

const CATEGORY_ICONS: Record<string, string> = {
  Deployment: "◈",
  "Profit Taking": "◆",
  "Risk Control": "◉",
  "Monthly Mode": "◎",
  "News/Macro": "◍",
};

export function RecommendationCard({ rec, onClick }: RecommendationCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-panel border border-border rounded-lg p-4 hover:border-accent/40 transition-colors group"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-muted font-mono text-sm flex-shrink-0">
            {CATEGORY_ICONS[rec.category] ?? "◌"}
          </span>
          <span className="font-medium text-sm text-gray-100 truncate group-hover:text-accent transition-colors">
            {rec.title}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span
            className={cn(
              "text-xs font-mono font-semibold border rounded px-1.5 py-0.5",
              riskColor(rec.risk_level),
              rec.risk_level === "High"
                ? "border-negative/40 bg-red-950"
                : rec.risk_level === "Medium"
                  ? "border-caution/40 bg-yellow-950"
                  : "border-positive/40 bg-green-950",
            )}
          >
            {rec.risk_level}
          </span>
          <span className="text-xs font-mono text-muted">
            {(rec.confidence * 100).toFixed(0)}%
          </span>
        </div>
      </div>

      <p className="text-xs text-muted mt-2 line-clamp-2">{rec.explanation}</p>

      <div className="flex items-center gap-3 mt-3">
        <span className="text-xs font-mono text-muted/70 bg-border/50 rounded px-1.5 py-0.5">
          {rec.category}
        </span>
        {rec.triggers.slice(0, 1).map((t, i) => (
          <span
            key={i}
            className="text-xs font-mono text-muted/60 truncate"
          >
            {t}
          </span>
        ))}
      </div>
    </button>
  );
}
