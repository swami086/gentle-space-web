"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TrendPoint } from "@/lib/db/dashboard";

// A single chart doesn't need shadcn's generic ChartContainer abstraction —
// Recharts directly, styled inline via CSS vars, is the smaller diff.
export function SpendCplChart({ data }: { data: TrendPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "var(--color-muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            width={48}
          />
          <Tooltip
            contentStyle={{
              background: "var(--color-card)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
          />
          <Line
            type="monotone"
            dataKey="spendInr"
            name="Spend (₹)"
            stroke="var(--color-primary)"
            strokeWidth={2}
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="cplInr"
            name="CPL (₹)"
            stroke="var(--color-destructive)"
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
