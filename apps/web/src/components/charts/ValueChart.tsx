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

interface ValueChartProps {
  data: PortfolioSeriesRow[];
  currencyLabel?: string;
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

export function ValueChart({ data, currencyLabel = "CAD" }: ValueChartProps) {
  const prefix = currencyLabel === "USD" ? "$" : "CA$";
  const chartData = data.map((r) => ({
    date: r.date,
    value: r.total_value,
    peak: r.running_peak,
  }));

  const allValues = chartData.flatMap((d) => [d.value, d.peak]).filter((v): v is number => v != null);
  const yMin = allValues.length ? Math.min(...allValues) : 0;
  const yMax = allValues.length ? Math.max(...allValues) : 100;
  const yPad = (yMax - yMin) * 0.08;

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={chartData} margin={{ top: 12, right: 16, bottom: 0, left: 4 }}>
        <defs>
          <linearGradient id="valueGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#58a6ff" stopOpacity={0.22} />
            <stop offset="60%" stopColor="#58a6ff" stopOpacity={0.06} />
            <stop offset="100%" stopColor="#58a6ff" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="peakGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3fb950" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#3fb950" stopOpacity={0} />
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
          tickFormatter={(v) => `${prefix}${(v / 1000).toFixed(0)}k`}
          tick={{ fill: "#6e7681", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          width={56}
          domain={[yMin - yPad, yMax + yPad]}
        />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          labelStyle={{ color: "#8b949e", marginBottom: 4 }}
          labelFormatter={(label: string) => `Week of ${label}`}
          formatter={(value: number, name: string) => [
            new Intl.NumberFormat("en-CA", {
              style: "currency",
              currency: currencyLabel === "USD" ? "USD" : "CAD",
              minimumFractionDigits: 0,
              maximumFractionDigits: 0,
            }).format(value),
            name === "peak" ? "Running Peak" : "Portfolio Value",
          ]}
        />
        <Area
          type="monotone"
          dataKey="peak"
          stroke="#3fb950"
          strokeWidth={1}
          strokeDasharray="5 3"
          fill="url(#peakGrad)"
          dot={false}
          name="peak"
          strokeOpacity={0.5}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#58a6ff"
          strokeWidth={2}
          fill="url(#valueGrad)"
          dot={false}
          name="value"
          activeDot={{ r: 4, fill: "#58a6ff", stroke: "#0d1117", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
