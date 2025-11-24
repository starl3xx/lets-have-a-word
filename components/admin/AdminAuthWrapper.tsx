// components/admin/AdminAuthWrapper.tsx
"use client"

import React, { useState, useEffect } from "react"
import { NeynarContextProvider, useNeynarContext, NeynarAuthButton, Theme } from "@neynar/react"

// Admin FIDs
const ADMIN_FIDS = [
  6500,      // Primary admin
  1477413,   // Secondary admin
]

function AdminAuthContent({ children }: { children: React.ReactNode }) {
  const { user, isAuthenticated } = useNeynarContext()
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  useEffect(() => {
    if (isAuthenticated && user) {
      // Check if user's FID is in admin list
      const userFid = user.fid
      setIsAdmin(ADMIN_FIDS.includes(userFid))
    } else {
      setIsAdmin(null)
    }
  }, [isAuthenticated, user])

  // Not authenticated - show login
  if (!isAuthenticated) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}>
        <div style={{
          background: "white",
          padding: "48px",
          borderRadius: "12px",
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
          maxWidth: "400px",
          textAlign: "center",
        }}>
          <h1 style={{
            margin: "0 0 8px 0",
            fontSize: "24px",
            fontWeight: 700,
            color: "#111827",
          }}>
            Admin Analytics
          </h1>
          <p style={{
            margin: "0 0 24px 0",
            fontSize: "14px",
            color: "#6b7280",
          }}>
            Sign in with your Farcaster account to access the admin dashboard.
          </p>
          <NeynarAuthButton />
        </div>
      </div>
    )
  }

  // Checking admin status
  if (isAdmin === null) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
      }}>
        <div style={{ color: "#6b7280" }}>Checking admin access...</div>
      </div>
    )
  }

  // Not an admin
  if (!isAdmin) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
      }}>
        <div style={{
          background: "white",
          padding: "48px",
          borderRadius: "12px",
          boxShadow: "0 4px 6px rgba(0,0,0,0.1)",
          maxWidth: "400px",
          textAlign: "center",
        }}>
          <h1 style={{
            margin: "0 0 8px 0",
            fontSize: "24px",
            fontWeight: 700,
            color: "#dc2626",
          }}>
            Access Denied
          </h1>
          <p style={{
            margin: "0 0 16px 0",
            fontSize: "14px",
            color: "#6b7280",
          }}>
            You do not have permission to access the admin dashboard.
          </p>
          <div style={{
            padding: "12px",
            background: "#f3f4f6",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#6b7280",
          }}>
            FID: {user?.fid}<br />
            Username: @{user?.username}
          </div>
        </div>
      </div>
    )
  }

  // Admin - show dashboard with user info in header
  return (
    <>
      {React.cloneElement(children as React.ReactElement, { user })}
    </>
  )
}

interface AdminAuthWrapperProps {
  children: React.ReactNode
}

export function AdminAuthWrapper({ children }: AdminAuthWrapperProps) {
  const neynarClientId = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID

  if (!neynarClientId) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
      }}>
        <div style={{ color: "#dc2626" }}>
          Neynar client ID not configured
        </div>
      </div>
    )
  }

  return (
    <NeynarContextProvider
      clientId={neynarClientId}
      defaultTheme={Theme.Light}
    >
      <AdminAuthContent>{children}</AdminAuthContent>
    </NeynarContextProvider>
  )
}
