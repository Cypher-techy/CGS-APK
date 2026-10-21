"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/**
 * Single-series bar chart of record counts per category. One hue, since colour carries no
 * meaning beyond "count"; the same figures are always shown as numbers elsewhere on the page.
 */
export function CountBarChart({ data, unit }: { data: { label: string; value: number }[]; unit: string }) {
  return (
    <div className="h-56 w-full" role="img" aria-label={`${unit} by status: ${data.map((d) => `${d.label} ${d.value}`).join(", ")}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -16 }} barCategoryGap="30%">
          <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.1)" />
          <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "rgba(255,255,255,0.15)" }} tick={{ fontSize: 11, fill: "#a3a8a3" }} interval={0} />
          <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#a3a8a3" }} />
          <Tooltip
            cursor={{ fill: "rgba(255,255,255,0.06)" }}
            formatter={(value) => [value, unit]}
            contentStyle={{ borderRadius: 12, border: "1px solid rgba(255,255,255,0.15)", background: "#151715", fontSize: 12, color: "#ecece6" }}
            itemStyle={{ color: "#ecece6" }}
          />
          <Bar dataKey="value" fill="#4cc38a" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
