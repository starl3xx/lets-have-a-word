// components/admin/AdminStatsCard.tsx
import React from "react"

interface AdminStatsCardProps {
  title: string
  value: string | number
  subtitle?: string
  loading?: boolean
}

export function AdminStatsCard({ title, value, subtitle, loading }: AdminStatsCardProps) {
  return (
    <div style={{
      background: "white",
      padding: "24px",
      borderRadius: "8px",
      boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
    }}>
      <h3 style={{
        margin: 0,
        fontSize: "14px",
        fontWeight: 500,
        color: "#6b7280",
        textTransform: "uppercase",
        letterSpacing: "0.05em",
      }}>
        {title}
      </h3>

      {loading ? (
        <div style={{ marginTop: "12px", color: "#9ca3af" }}>Loading...</div>
      ) : (
        <>
          <div style={{
            marginTop: "12px",
            fontSize: "32px",
            fontWeight: 700,
            color: "#111827",
          }}>
            {value}
          </div>

          {subtitle && (
            <div style={{
              marginTop: "4px",
              fontSize: "14px",
              color: "#6b7280",
            }}>
              {subtitle}
            </div>
          )}
        </>
      )}
    </div>
  )
}
