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
import { fmtPct } from "@/lib/utils";

interface DrawdownChartProps {
  data: PortfolioSeriesRow[];
}

export function DrawdownChart({ data }: DrawdownChartProps) {
  const chartData = data.map((r) => ({
    date: r.date,
    drawdown: r.drawdown != null ? r.drawdown * 100 : null,
  }));

  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f85149" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#f85149" stopOpacity={0} />
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
          tickFormatter={(v) => `${v.toFixed(1)}%`}
          tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          width={48}
        />
        <ReferenceLine y={-8} stroke="#d29922" strokeDasharray="3 3" strokeWidth={1} />
        <ReferenceLine y={-10} stroke="#f85149" strokeDasharray="3 3" strokeWidth={1} />
        <Tooltip
          contentStyle={{
            backgroundColor: "#161b22",
            border: "1px solid #21262d",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "monospace",
            color: "#e6edf3",
          }}
          formatter={(value: number) => [`${value.toFixed(2)}%`, "Drawdown"]}
        />
        <Area
          type="monotone"
          dataKey="drawdown"
          stroke="#f85149"
          strokeWidth={1.5}
          fill="url(#ddGrad)"
          dot={false}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
