"use client";

import {
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";
import type { HoldingLive } from "@/lib/types";
import { useCurrency } from "@/lib/currency";

const COLORS = [
  "#58a6ff", // accent blue
  "#3fb950", // positive green
  "#d29922", // caution yellow
  "#f85149", // negative red
  "#a371f7", // purple
  "#39d353", // bright green
  "#ff9f43", // orange
  "#54a0ff", // light blue
  "#5f27cd", // dark purple
  "#00d2d3", // teal
];

interface Props {
  holdings: HoldingLive[];
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ name: string; value: number; payload: { ticker: string; value: number; weight: number } }>;
}

function CustomTooltip({ active, payload }: CustomTooltipProps) {
  const { fromUsd, currencyLabel } = useCurrency();
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const v = fromUsd(d.value);
  const valueText =
    v == null
      ? "—"
      : `${currencyLabel === "CAD" ? "CA$" : "US$"}${new Intl.NumberFormat("en-CA", {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(Math.abs(v))}`;
  return (
    <div className="bg-panel border border-border rounded px-3 py-2 text-xs font-mono">
      <div className="text-accent font-semibold">{d.ticker}</div>
      <div className="text-muted">{valueText}</div>
      <div className="text-muted">{(d.weight * 100).toFixed(1)}% of portfolio</div>
    </div>
  );
}

export default function AllocationPieChart({ holdings }: Props) {
  const data = holdings
    .filter((h) => h.total_value != null && h.total_value > 0)
    .map((h) => ({
      ticker: h.ticker,
      value: h.total_value as number,
      weight: h.weight ?? 0,
    }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted text-xs font-mono">
        No allocation data
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="ticker"
          cx="50%"
          cy="45%"
          outerRadius="70%"
          innerRadius="40%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={COLORS[i % COLORS.length]} />
          ))}
        </Pie>
        <Tooltip content={<CustomTooltip />} />
        <Legend
          formatter={(value: string) => (
            <span className="text-xs font-mono text-muted">{value}</span>
          )}
          iconType="circle"
          iconSize={8}
          wrapperStyle={{ fontSize: 11, fontFamily: "monospace" }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
