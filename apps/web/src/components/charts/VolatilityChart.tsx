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

export function VolatilityChart({ data, volThreshold = 0.04 }: VolatilityChartProps) {
  const chartData = data.map((r) => ({
    date: r.date,
    vol8: r.rolling_8w_vol != null ? r.rolling_8w_vol * 100 : null,
    alphaVol: r.rolling_8w_alpha_vol != null ? r.rolling_8w_alpha_vol * 100 : null,
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
        <ReferenceLine
          y={volThreshold * 100}
          stroke="#d29922"
          strokeDasharray="3 3"
          strokeWidth={1}
          label={{ value: "threshold", fill: "#d29922", fontSize: 9, fontFamily: "monospace" }}
        />
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
          dataKey="vol8"
          stroke="#d29922"
          strokeWidth={2}
          dot={false}
          name="8w Vol"
          connectNulls
        />
        <Line
          type="monotone"
          dataKey="alphaVol"
          stroke="#8b949e"
          strokeWidth={1}
          dot={false}
          name="8w Alpha Vol"
          connectNulls
          strokeDasharray="4 2"
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
