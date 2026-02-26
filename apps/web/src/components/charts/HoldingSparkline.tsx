"use client";

import { Area, AreaChart, ResponsiveContainer } from "recharts";
import type { SparklinePoint } from "@/lib/types";

interface Props {
  data: SparklinePoint[];
  width?: number;
  height?: number;
}

export default function HoldingSparkline({ data, width = 120, height = 48 }: Props) {
  if (!data || data.length < 2) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-muted text-xs font-mono"
      >
        —
      </div>
    );
  }

  const first = data[0].close;
  const last = data[data.length - 1].close;
  const isUp = last >= first;
  const color = isUp ? "#3fb950" : "#f85149";

  return (
    <ResponsiveContainer width={width} height={height}>
      <AreaChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
        <defs>
          <linearGradient id={`sparkGrad-${isUp ? "up" : "dn"}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="close"
          stroke={color}
          dot={false}
          strokeWidth={1.5}
          fill={`url(#sparkGrad-${isUp ? "up" : "dn"})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
