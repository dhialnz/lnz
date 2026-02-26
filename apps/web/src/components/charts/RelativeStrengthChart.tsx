"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortfolioSeriesRow } from "@/lib/types";

interface RelativeStrengthChartProps {
  data: PortfolioSeriesRow[];
  lookback?: number;
}

const TOOLTIP_STYLE = {
  backgroundColor: "#0d1117",
  border: "1px solid #30363d",
  borderRadius: 8,
  fontSize: 11,
  fontFamily: "monospace",
  color: "#e6edf3",
  padding: "8px 12px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
};

const LEGEND_ITEMS = [
  { key: "portfolioIndex", label: "Portfolio", color: "#FF5C00" },
  { key: "spyIndex", label: "SPY", color: "#58a6ff" },
];

export function RelativeStrengthChart({ data, lookback = 16 }: RelativeStrengthChartProps) {
  const tail = data.slice(-Math.max(2, lookback));
  let portfolioIndex = 100;
  let spyIndex = 100;

  const chartData = tail.map((row) => {
    const period = Number.isFinite(row.period_return) ? row.period_return : 0;
    const benchmark = Number.isFinite(row.benchmark_return) ? row.benchmark_return : 0;

    portfolioIndex *= 1 + period;
    spyIndex *= 1 + benchmark;

    return {
      date: row.date,
      portfolioIndex,
      spyIndex,
      excess: portfolioIndex - spyIndex,
    };
  });

  return (
    <div className="flex flex-col gap-2">
      {/* Legend */}
      <div className="flex items-center gap-3 px-1">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <svg width="20" height="10">
              <line x1="0" y1="5" x2="20" y2="5" stroke={item.color} strokeWidth={2} />
            </svg>
            <span className="text-[10px] font-mono" style={{ color: item.color }}>{item.label}</span>
          </div>
        ))}
        <span className="text-[10px] font-mono text-muted ml-auto">Rebased to 100</span>
      </div>
      <ResponsiveContainer width="100%" height={208}>
        <LineChart data={chartData} margin={{ top: 4, right: 16, bottom: 0, left: 4 }}>
          <CartesianGrid strokeDasharray="2 4" stroke="#21262d" vertical={false} />
          <XAxis
            dataKey="date"
            tick={{ fill: "#6e7681", fontSize: 10, fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
            minTickGap={48}
            tickFormatter={(d: string) => d.slice(5)}
          />
          <YAxis
            tickFormatter={(v) => v.toFixed(0)}
            tick={{ fill: "#6e7681", fontSize: 10, fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <ReferenceLine y={100} stroke="#30363d" strokeDasharray="3 3" strokeWidth={1} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#8b949e", marginBottom: 4 }}
            labelFormatter={(label: string) => `Week of ${label}`}
            formatter={(value: number, name: string, props) => {
              if (name === "portfolioIndex" || name === "spyIndex") {
                const label = name === "portfolioIndex" ? "Portfolio" : "SPY";
                const payload = props?.payload as { excess?: number } | undefined;
                if (name === "portfolioIndex" && typeof payload?.excess === "number") {
                  const sign = payload.excess >= 0 ? "+" : "";
                  return [`${value.toFixed(2)} (${sign}${payload.excess.toFixed(2)} vs SPY)`, label];
                }
                return [value.toFixed(2), label];
              }
              return [value.toFixed(2), name];
            }}
          />
          <Line
            type="monotone"
            dataKey="portfolioIndex"
            stroke="#FF5C00"
            strokeWidth={2}
            dot={false}
            name="portfolioIndex"
            activeDot={{ r: 4, fill: "#FF5C00", stroke: "#0d1117", strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="spyIndex"
            stroke="#58a6ff"
            strokeWidth={2}
            dot={false}
            name="spyIndex"
            activeDot={{ r: 4, fill: "#58a6ff", stroke: "#0d1117", strokeWidth: 2 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
