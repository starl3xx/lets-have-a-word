// components/admin/AdminAuthWrapper.tsx
"use client"

import React, { useState, useEffect } from "react"

// Admin FIDs
const ADMIN_FIDS = [
  6500,      // Primary admin
  1477413,   // Secondary admin
]

interface SIWNData {
  fid: number
  username: string
  display_name?: string
  pfp_url?: string
  bio?: string
  custody_address?: string
  verified_addresses?: {
    eth_addresses: string[]
    sol_addresses: string[]
  }
  signer_uuid?: string
}

declare global {
  interface Window {
    onSignInSuccess?: (data: SIWNData) => void
  }
}

interface AdminAuthWrapperProps {
  children: React.ReactNode
}

export function AdminAuthWrapper({ children }: AdminAuthWrapperProps) {
  const [user, setUser] = useState<SIWNData | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Use different client IDs for dev vs prod
  const isDev = typeof window !== 'undefined' && window.location.hostname === 'localhost'
  const neynarClientId = isDev
    ? process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV
    : process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD

  useEffect(() => {
    // LOG CONFIGURATION FOR DEBUGGING
    console.log('═══════════════════════════════════════')
    console.log('NEYNAR SIWN CONFIGURATION')
    console.log('═══════════════════════════════════════')
    console.log('Environment:', isDev ? 'DEVELOPMENT' : 'PRODUCTION')
    console.log('Origin:', window.location.origin)
    console.log('Client ID:', neynarClientId || 'NOT CONFIGURED')
    console.log('═══════════════════════════════════════')

    if (!neynarClientId) {
      console.error('❌ Neynar client ID not configured!')
      console.log('Set NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV for localhost')
      console.log('Set NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD for production')
      return
    }

    // Check if user is already signed in (stored in localStorage)
    const storedUser = localStorage.getItem('neynar_user')
    if (storedUser) {
      try {
        setUser(JSON.parse(storedUser))
        setIsLoading(false)
      } catch (e) {
        localStorage.removeItem('neynar_user')
        setIsLoading(false)
      }
    } else {
      setIsLoading(false)
    }

    // Define the global callback for SIWN
    window.onSignInSuccess = (data: SIWNData) => {
      console.log("✅ Sign-in success:", data)
      setUser(data)
      // Store in localStorage for persistence
      localStorage.setItem('neynar_user', JSON.stringify(data))
    }

    // Load the Neynar SIWN script
    const script = document.createElement('script')
    script.src = 'https://neynarxyz.github.io/siwn/raw/1.2.0/index.js'
    script.async = true
    document.body.appendChild(script)

    return () => {
      // Cleanup
      delete window.onSignInSuccess
      if (script.parentNode) {
        script.parentNode.removeChild(script)
      }
    }
  }, [])

  const handleSignOut = () => {
    setUser(null)
    localStorage.removeItem('neynar_user')
  }

  if (!neynarClientId) {
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
          maxWidth: "500px",
        }}>
          <div style={{ color: "#dc2626", fontWeight: 700, fontSize: "20px", marginBottom: "16px" }}>
            ❌ Neynar Client ID Not Configured
          </div>
          <div style={{ fontSize: "14px", color: "#6b7280", lineHeight: "1.6" }}>
            <p>Environment: <strong>{typeof window !== 'undefined' && window.location.hostname === 'localhost' ? 'Development' : 'Production'}</strong></p>
            <p>Origin: <strong>{typeof window !== 'undefined' ? window.location.origin : ''}</strong></p>
            <p style={{ marginTop: "16px" }}>Required environment variable:</p>
            <code style={{
              display: "block",
              background: "#f3f4f6",
              padding: "8px",
              borderRadius: "4px",
              fontSize: "12px",
              marginTop: "8px",
            }}>
              {typeof window !== 'undefined' && window.location.hostname === 'localhost'
                ? 'NEXT_PUBLIC_NEYNAR_CLIENT_ID_DEV'
                : 'NEXT_PUBLIC_NEYNAR_CLIENT_ID_PROD'}
            </code>
          </div>
        </div>
      </div>
    )
  }

  // Loading
  if (isLoading) {
    return (
      <div style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f3f4f6",
      }}>
        <div style={{ color: "#6b7280" }}>Loading...</div>
      </div>
    )
  }

  // Not authenticated - show login
  if (!user) {
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

          {/* Neynar SIWN Button */}
          <div
            className="neynar_signin"
            data-client_id={neynarClientId}
            data-success-callback="onSignInSuccess"
            data-theme="light"
          />
        </div>
      </div>
    )
  }

  // Check if user is admin
  const userFid = typeof user.fid === 'string' ? parseInt(user.fid) : user.fid
  const isAdmin = ADMIN_FIDS.includes(userFid)

  console.log('Admin check:', {
    userFid,
    userFidType: typeof user.fid,
    originalFid: user.fid,
    ADMIN_FIDS,
    isAdmin,
  })

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
            marginBottom: "16px",
          }}>
            FID: {user.fid}<br />
            Username: @{user.username}
          </div>
          <button
            onClick={handleSignOut}
            style={{
              padding: "8px 16px",
              background: "#6b7280",
              color: "white",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontSize: "14px",
            }}
          >
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  // Admin - show dashboard
  return (
    <>
      {React.cloneElement(children as React.ReactElement, { user, onSignOut: handleSignOut })}
    </>
  )
}
