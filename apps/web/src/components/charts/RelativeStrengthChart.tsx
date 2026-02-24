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

function toPct(value: number): string {
  return `${value.toFixed(2)}%`;
}

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
    <ResponsiveContainer width="100%" height={220}>
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
          tickFormatter={(v) => v.toFixed(0)}
          tick={{ fill: "#8b949e", fontSize: 10, fontFamily: "monospace" }}
          tickLine={false}
          axisLine={false}
          width={40}
        />
        <ReferenceLine y={100} stroke="#21262d" strokeDasharray="3 3" />
        <Tooltip
          contentStyle={{
            backgroundColor: "#161b22",
            border: "1px solid #21262d",
            borderRadius: 6,
            fontSize: 11,
            fontFamily: "monospace",
            color: "#e6edf3",
          }}
          formatter={(value: number, name: string, props) => {
            if (name === "Portfolio Index" || name === "SPY Index") {
              return [value.toFixed(2), name];
            }
            const payload = props?.payload as { excess?: number } | undefined;
            const excess = payload?.excess;
            if (typeof excess === "number") {
              return [toPct((excess / 100) * 100), "Outperformance"];
            }
            return [value.toFixed(2), name];
          }}
          labelFormatter={(label) => `Week ending ${label}`}
        />
        <Line
          type="monotone"
          dataKey="portfolioIndex"
          stroke="#FF5C00"
          strokeWidth={2}
          dot={false}
          name="Portfolio Index"
        />
        <Line type="monotone" dataKey="spyIndex" stroke="#58a6ff" strokeWidth={2} dot={false} name="SPY Index" />
      </LineChart>
    </ResponsiveContainer>
  );
}

