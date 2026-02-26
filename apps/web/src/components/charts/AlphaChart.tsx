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

interface AlphaChartProps {
  data: PortfolioSeriesRow[];
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
  { key: "alpha", label: "Weekly", color: "#6e7681", dash: false },
  { key: "alpha4", label: "4w Rolling", color: "#58a6ff", dash: false },
  { key: "cumAlpha", label: "Cumulative", color: "#3fb950", dash: true },
];

export function AlphaChart({ data }: AlphaChartProps) {
  const chartData = data.map((r) => ({
    date: r.date,
    alpha: r.alpha != null ? r.alpha * 100 : null,
    alpha4: r.rolling_4w_alpha != null ? r.rolling_4w_alpha * 100 : null,
    cumAlpha: r.cumulative_alpha != null ? r.cumulative_alpha * 100 : null,
  }));

  return (
    <div className="flex flex-col gap-2">
      {/* Legend */}
      <div className="flex items-center gap-3 px-1">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.key} className="flex items-center gap-1.5">
            <svg width="20" height="10">
              <line
                x1="0"
                y1="5"
                x2="20"
                y2="5"
                stroke={item.color}
                strokeWidth={item.key === "alpha4" ? 2 : 1.5}
                strokeDasharray={item.dash ? "4 2" : undefined}
              />
            </svg>
            <span className="text-[10px] font-mono" style={{ color: item.color }}>{item.label}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={168}>
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
            tickFormatter={(v) => `${v.toFixed(1)}%`}
            tick={{ fill: "#6e7681", fontSize: 10, fontFamily: "monospace" }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <ReferenceLine y={0} stroke="#30363d" strokeWidth={1.5} />
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#8b949e", marginBottom: 4 }}
            labelFormatter={(label: string) => `Week of ${label}`}
            formatter={(v: number, name: string) => {
              const map: Record<string, string> = {
                alpha: "Weekly Alpha",
                alpha4: "4w Rolling",
                cumAlpha: "Cumulative",
              };
              return [`${v.toFixed(3)}%`, map[name] ?? name];
            }}
          />
          <Line
            type="monotone"
            dataKey="alpha"
            stroke="#6e7681"
            strokeWidth={1}
            dot={false}
            name="alpha"
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="alpha4"
            stroke="#58a6ff"
            strokeWidth={2}
            dot={false}
            name="alpha4"
            connectNulls
            activeDot={{ r: 4, fill: "#58a6ff", stroke: "#0d1117", strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="cumAlpha"
            stroke="#3fb950"
            strokeWidth={1.5}
            dot={false}
            name="cumAlpha"
            connectNulls
            strokeDasharray="4 2"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
