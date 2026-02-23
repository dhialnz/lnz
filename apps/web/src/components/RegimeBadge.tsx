import type { Regime } from "@/lib/types";
import { cn, regimeBgColor, regimeColor } from "@/lib/utils";

interface RegimeBadgeProps {
  regime: Regime;
  explanation?: string;
  large?: boolean;
}

const REGIME_ICONS: Record<Regime, string> = {
  Defensive: "⚠",
  Recovery: "↗",
  Expansion: "▲",
  Neutral: "—",
};

export function RegimeBadge({ regime, explanation, large }: RegimeBadgeProps) {
  return (
    <div
      className={cn(
        "inline-flex flex-col gap-1",
        large ? "items-start" : "items-center",
      )}
    >
      <span
        className={cn(
          "font-mono font-semibold border rounded px-2 py-0.5 flex items-center gap-1.5",
          regimeBgColor(regime),
          regimeColor(regime),
          large ? "text-base" : "text-xs",
        )}
      >
        <span>{REGIME_ICONS[regime]}</span>
        {regime}
      </span>
      {explanation && large && (
        <p className="text-xs text-muted max-w-sm">{explanation}</p>
      )}
    </div>
  );
}
