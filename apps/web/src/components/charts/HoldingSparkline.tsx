"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";
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
  const color = last >= first ? "#3fb950" : "#f85149";

  return (
    <ResponsiveContainer width={width} height={height}>
      <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
        <Line
          type="monotone"
          dataKey="close"
          stroke={color}
          dot={false}
          strokeWidth={1.5}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
