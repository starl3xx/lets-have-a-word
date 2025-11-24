// components/admin/AdminSection.tsx
import React from "react"

interface AdminSectionProps {
  title: string
  children: React.ReactNode
}

export function AdminSection({ title, children }: AdminSectionProps) {
  return (
    <section style={{ marginBottom: "32px" }}>
      <h2 style={{
        margin: "0 0 16px 0",
        fontSize: "20px",
        fontWeight: 600,
        color: "#111827",
      }}>
        {title}
      </h2>
      {children}
    </section>
  )
}
