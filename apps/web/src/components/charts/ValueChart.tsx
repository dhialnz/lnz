"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { PortfolioSeriesRow } from "@/lib/types";
import { fmtCurrency } from "@/lib/utils";

interface ValueChartProps {
  data: PortfolioSeriesRow[];
}

export function ValueChart({ data }: ValueChartProps) {
  const chartData = data.map((r) => ({
    date: r.date,
    value: r.total_value,
    peak: r.running_peak,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#58a6ff" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#58a6ff" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#21262d" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          minTickGap={40}
        />
        <YAxis
          tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
          tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          width={52}
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
          formatter={(value: number) => [fmtCurrency(value), "Total Value"]}
        />
        <Area
          type="monotone"
          dataKey="peak"
          stroke="#21262d"
          strokeWidth={1}
          strokeDasharray="4 4"
          fill="none"
          dot={false}
          name="Running Peak"
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#58a6ff"
          strokeWidth={2}
          fill="url(#valueGrad)"
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
