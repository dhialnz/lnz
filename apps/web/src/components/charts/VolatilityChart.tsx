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

interface VolatilityChartProps {
  data: PortfolioSeriesRow[];
  volThreshold?: number;
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
  { key: "vol8", label: "8w Vol", color: "#d29922", dash: false },
  { key: "alphaVol", label: "Alpha Vol", color: "#6e7681", dash: true },
];

export function VolatilityChart({ data, volThreshold }: VolatilityChartProps) {
  const chartData = data.map((r) => ({
    date: r.date,
    vol8: r.rolling_8w_vol != null ? r.rolling_8w_vol * 100 : null,
    alphaVol: r.rolling_8w_alpha_vol != null ? r.rolling_8w_alpha_vol * 100 : null,
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
                strokeWidth={item.key === "vol8" ? 2 : 1.5}
                strokeDasharray={item.dash ? "4 2" : undefined}
              />
            </svg>
            <span className="text-[10px] font-mono" style={{ color: item.color }}>{item.label}</span>
          </div>
        ))}
        {typeof volThreshold === "number" && (
          <div className="flex items-center gap-1.5">
            <svg width="20" height="10">
              <line x1="0" y1="5" x2="20" y2="5" stroke="#d29922" strokeWidth={1} strokeDasharray="4 3" strokeOpacity={0.7} />
            </svg>
            <span className="text-[10px] font-mono text-caution/70">Budget</span>
          </div>
        )}
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
          {typeof volThreshold === "number" && (
            <ReferenceLine
              y={volThreshold * 100}
              stroke="#d29922"
              strokeDasharray="4 3"
              strokeWidth={1}
              strokeOpacity={0.7}
            />
          )}
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            labelStyle={{ color: "#8b949e", marginBottom: 4 }}
            labelFormatter={(label: string) => `Week of ${label}`}
            formatter={(v: number, name: string) => {
              const map: Record<string, string> = {
                vol8: "8w Volatility",
                alphaVol: "Alpha Volatility",
              };
              return [`${v.toFixed(3)}%`, map[name] ?? name];
            }}
          />
          <Line
            type="monotone"
            dataKey="vol8"
            stroke="#d29922"
            strokeWidth={2}
            dot={false}
            name="vol8"
            connectNulls
            activeDot={{ r: 4, fill: "#d29922", stroke: "#0d1117", strokeWidth: 2 }}
          />
          <Line
            type="monotone"
            dataKey="alphaVol"
            stroke="#6e7681"
            strokeWidth={1.5}
            dot={false}
            name="alphaVol"
            connectNulls
            strokeDasharray="4 2"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
