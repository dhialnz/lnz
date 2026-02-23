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

export function AlphaChart({ data }: AlphaChartProps) {
  const chartData = data.map((r) => ({
    date: r.date,
    alpha: r.alpha != null ? r.alpha * 100 : null,
    alpha4: r.rolling_4w_alpha != null ? r.rolling_4w_alpha * 100 : null,
    cumAlpha: r.cumulative_alpha != null ? r.cumulative_alpha * 100 : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v) => `${v.toFixed(1)}%`}
          tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ReferenceLine y={0} stroke="#21262d" strokeWidth={1.5} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#161b22",
            border: "1px solid #21262d",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "monospace",
            color: "#e6edf3",
          }}
          formatter={(v: number, name: string) => [`${v.toFixed(3)}%`, name]}
        />
        <Line
          type="monotone"
          dataKey="alpha"
          stroke="#8b949e"
          strokeWidth={1}
          dot={false}
          name="Weekly Alpha"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="alpha4"
          stroke="#58a6ff"
          strokeWidth={2}
          dot={false}
          name="4w Rolling Alpha"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="cumAlpha"
          stroke="#3fb950"
          strokeWidth={1.5}
          dot={false}
          name="Cumulative Alpha"
          connectNulls
          strokeDasharray="4 2"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
