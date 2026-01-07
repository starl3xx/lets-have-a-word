// components/admin/AnalyticsControls.tsx
import React from "react"

export type TimeRange = "current" | "7d" | "30d" | "all"

interface AnalyticsControlsProps {
  timeRange: TimeRange
  onTimeRangeChange: (range: TimeRange) => void
  autoRefresh: boolean
  onAutoRefreshToggle: () => void
  onExport: (format: "csv" | "json") => void
  onRefresh: () => void
  isLoading?: boolean
}

export function AnalyticsControls({
  timeRange,
  onTimeRangeChange,
  autoRefresh,
  onAutoRefreshToggle,
  onExport,
  onRefresh,
  isLoading = false
}: AnalyticsControlsProps) {
  return (
    <div style={{
      background: "white",
      borderRadius: "8px",
      padding: "16px",
      border: "1px solid #e5e7eb",
      marginBottom: "24px",
      display: "flex",
      flexWrap: "wrap",
      gap: "16px",
      alignItems: "center",
      justifyContent: "space-between",
    }}>
      {/* Time Range Selector */}
      <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
        <span style={{ fontSize: "14px", color: "#6b7280", marginRight: "8px" }}>
          Time range:
        </span>
        {(["current", "7d", "30d", "all"] as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => onTimeRangeChange(range)}
            style={{
              padding: "6px 12px",
              border: timeRange === range ? "2px solid #3b82f6" : "1px solid #d1d5db",
              background: timeRange === range ? "#eff6ff" : "white",
              color: timeRange === range ? "#3b82f6" : "#4b5563",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: timeRange === range ? 600 : 400,
              transition: "all 0.2s",
            }}
          >
            {range === "current" ? "Current round" : range === "7d" ? "Last 7 days" : range === "30d" ? "Last 30 days" : "All time"}
          </button>
        ))}
      </div>

      {/* Controls */}
      <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
        {/* Auto-refresh Toggle */}
        <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer", fontSize: "14px", color: "#4b5563" }}>
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={onAutoRefreshToggle}
            style={{
              width: "16px",
              height: "16px",
              cursor: "pointer",
            }}
          />
          Auto-refresh
        </label>

        {/* Refresh Button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            padding: "6px 12px",
            background: isLoading ? "#e5e7eb" : "#f3f4f6",
            border: "1px solid #d1d5db",
            borderRadius: "6px",
            cursor: isLoading ? "not-allowed" : "pointer",
            fontSize: "13px",
            color: "#4b5563",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          {isLoading ? "⟳" : "↻"} Refresh
        </button>

        {/* Export Dropdown */}
        <div style={{ position: "relative" }}>
          <select
            onChange={(e) => {
              const value = e.target.value as "csv" | "json"
              if (value) {
                onExport(value)
                e.target.value = "" // Reset
              }
            }}
            style={{
              padding: "6px 12px",
              background: "white",
              border: "1px solid #d1d5db",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "13px",
              color: "#4b5563",
            }}
          >
            <option value="">Export...</option>
            <option value="csv">Export as CSV</option>
            <option value="json">Export as JSON</option>
          </select>
        </div>
      </div>
    </div>
  )
}
