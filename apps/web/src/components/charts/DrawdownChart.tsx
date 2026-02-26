"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortfolioSeriesRow } from "@/lib/types";

interface DrawdownChartProps {
  data: PortfolioSeriesRow[];
  defensiveThreshold?: number;
  hardStopThreshold?: number;
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

export function DrawdownChart({
  data,
  defensiveThreshold,
  hardStopThreshold,
}: DrawdownChartProps) {
  const chartData = data.map((r) => ({
    date: r.date,
    drawdown: r.drawdown != null ? r.drawdown * 100 : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={chartData} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f85149" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#f85149" stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
        {typeof defensiveThreshold === "number" && (
          <ReferenceLine
            y={defensiveThreshold * 100}
            stroke="#d29922"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            strokeOpacity={0.8}
            label={{
              value: "Defensive",
              fill: "#d29922",
              fontSize: 9,
              fontFamily: "monospace",
              position: "insideTopRight",
              dy: -4,
            }}
          />
        )}
        {typeof hardStopThreshold === "number" && (
          <ReferenceLine
            y={hardStopThreshold * 100}
            stroke="#f85149"
            strokeDasharray="4 3"
            strokeWidth={1.5}
            strokeOpacity={0.8}
            label={{
              value: "Hard Stop",
              fill: "#f85149",
              fontSize: 9,
              fontFamily: "monospace",
              position: "insideTopRight",
              dy: -4,
            }}
          />
        )}
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "#8b949e", marginBottom: 4 }}
          labelFormatter={(label: string) => `Week of ${label}`}
          formatter={(value: number) => [`${value.toFixed(2)}%`, "Drawdown"]}
        />
        <Area
          type="monotone"
          dataKey="drawdown"
          stroke="#f85149"
          strokeWidth={2}
          fill="url(#ddGrad)"
          dot={false}
          connectNulls
          activeDot={{ r: 4, fill: "#f85149", stroke: "#0d1117", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
