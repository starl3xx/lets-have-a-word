// components/admin/AnalyticsChart.tsx
import React from "react"
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts"

interface AnalyticsChartProps {
  data: any[]
  type: "line" | "bar"
  dataKey: string | string[]
  xAxisKey: string
  title?: string
  colors?: string[]
  height?: number
  embedded?: boolean // When true, renders just the chart without container/title
}

export function AnalyticsChart({
  data,
  type,
  dataKey,
  xAxisKey,
  title,
  colors = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444"],
  height = 300,
  embedded = false,
}: AnalyticsChartProps) {
  if (!data || data.length === 0) {
    if (embedded) {
      return (
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: height,
          color: "#6b7280",
          fontSize: "14px",
        }}>
          No data available
        </div>
      )
    }
    return (
      <div style={{
        background: "white",
        borderRadius: "8px",
        padding: "24px",
        border: "1px solid #e5e7eb",
      }}>
        {title && (
          <h3 style={{
            margin: "0 0 16px 0",
            fontSize: "16px",
            fontWeight: 600,
            color: "#111827",
          }}>
            {title}
          </h3>
        )}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          height: height,
          color: "#6b7280",
          fontSize: "14px",
        }}>
          No data available
        </div>
      </div>
    )
  }

  const keys = Array.isArray(dataKey) ? dataKey : [dataKey]

  const chartContent = (
    <ResponsiveContainer width="100%" height={height}>
      {type === "line" ? (
        <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey={xAxisKey}
            tick={{ fontSize: 12, fill: "#6b7280" }}
            stroke="#d1d5db"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#6b7280" }}
            stroke="#d1d5db"
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          {keys.length > 1 && <Legend wrapperStyle={{ fontSize: "12px" }} />}
          {keys.map((key, index) => (
            <Line
              key={key}
              type="monotone"
              dataKey={key}
              stroke={colors[index % colors.length]}
              strokeWidth={2}
              dot={{ fill: colors[index % colors.length], r: 3 }}
              activeDot={{ r: 5 }}
            />
          ))}
        </LineChart>
      ) : (
        <BarChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis
            dataKey={xAxisKey}
            tick={{ fontSize: 12, fill: "#6b7280" }}
            stroke="#d1d5db"
          />
          <YAxis
            tick={{ fontSize: 12, fill: "#6b7280" }}
            stroke="#d1d5db"
          />
          <Tooltip
            contentStyle={{
              background: "white",
              border: "1px solid #e5e7eb",
              borderRadius: "6px",
              fontSize: "12px",
            }}
          />
          {keys.length > 1 && <Legend wrapperStyle={{ fontSize: "12px" }} />}
          {keys.map((key, index) => (
            <Bar
              key={key}
              dataKey={key}
              fill={colors[index % colors.length]}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      )}
    </ResponsiveContainer>
  )

  if (embedded) {
    return chartContent
  }

  return (
    <div style={{
      background: "white",
      borderRadius: "8px",
      padding: "24px",
      border: "1px solid #e5e7eb",
    }}>
      {title && (
        <h3 style={{
          margin: "0 0 16px 0",
          fontSize: "16px",
          fontWeight: 600,
          color: "#111827",
        }}>
          {title}
        </h3>
      )}
      {chartContent}
    </div>
  )
}
