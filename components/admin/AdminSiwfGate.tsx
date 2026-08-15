"use client"

import React, { useCallback, useEffect, useState } from "react"
import { AuthKitProvider, SignInButton } from "@farcaster/auth-kit"
import "@farcaster/auth-kit/styles.css"

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

/**
 * Admin sign-in via Sign In With Farcaster.
 *
 * Replaces Sign In With Neynar, which Neynar retired on 2026-08-14 — existing
 * connections keep working but no new ones are issued, so the old flow was
 * going to strand anyone signing in on a new browser.
 *
 * Neynar's own migration note points at managed signers, which is the wrong
 * target here: managed signers are authorisation (act on behalf of an account),
 * and this dashboard only needs authentication (which FID is this). Their docs
 * draw that distinction themselves and send authentication to SIWF.
 *
 * WHAT ACTUALLY GRANTS ACCESS
 *
 * Not this component. The browser holds no credential it could forge: the
 * signed SIWF message goes to /api/auth/verify, which checks the signature
 * against Optimism, confirms the FID is an admin, and sets an HttpOnly session
 * cookie this code cannot read. The proxy checks that cookie on every
 * /api/admin/* request. So the UI below decides what to render, and the server
 * decides what is allowed — which is the split the old `?devFid=6500` flow got
 * wrong, since the admin FIDs ship in this very bundle.
 *
 * Profile fields (username, avatar) are displayed but never trusted: only the
 * `fid` returned by server-side verification means anything.
 */

export interface AdminUser {
  fid: number
  username?: string
  pfp_url?: string
  display_name?: string
}

interface Props {
  children: React.ReactNode
}

/** Must match the domain /api/auth/verify verifies against. */
const SIWF_DOMAIN = process.env.NEXT_PUBLIC_SIWF_DOMAIN || "letshaveaword.fun"

type Phase = "checking" | "signed-out" | "denied" | "ready"

export function AdminSiwfGate({ children }: Props) {
  const [phase, setPhase] = useState<Phase>("checking")
  const [user, setUser] = useState<AdminUser | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Ask the server whether we already hold a valid session.
   *
   * The session cookie is HttpOnly, so this is the only way to know — which is
   * the point: a client that cannot read its own credential cannot leak it.
   */
  const checkSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch("/api/admin/me", { credentials: "same-origin" })
      if (!res.ok) return false
      const data = await res.json()
      if (data?.isAdmin && data?.fid) {
        setUser((prev) => prev ?? { fid: data.fid })
        return true
      }
      return false
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    void (async () => {
      setPhase((await checkSession()) ? "ready" : "signed-out")
    })()
  }, [checkSession])

  /**
   * Fetched lazily at click time rather than on mount: nonces expire, and one
   * issued when the tab was opened may be long dead by the time anyone signs in.
   */
  const getNonce = useCallback(async () => {
    const res = await fetch("/api/auth/nonce")
    if (!res.ok) throw new Error("Could not start sign-in")
    const { nonce } = await res.json()
    return nonce as string
  }, [])

  const handleSuccess = useCallback(
    async (result: { message?: string; signature?: string; nonce?: string; fid?: number; username?: string; pfpUrl?: string }) => {
      setError(null)

      if (!result.message || !result.signature || !result.nonce) {
        setError("Sign-in returned an incomplete credential.")
        return
      }

      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          message: result.message,
          signature: result.signature,
          nonce: result.nonce,
        }),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data?.success) {
        setError(data?.error || "Could not verify that sign-in.")
        return
      }

      // Verified, but not necessarily privileged. The server issues a session
      // only for admin FIDs; anything else is a successful sign-in with no
      // access, and it says so rather than failing confusingly.
      if (!data.adminSession) {
        setUser({ fid: data.fid, username: result.username, pfp_url: result.pfpUrl })
        setPhase("denied")
        return
      }

      setUser({ fid: data.fid, username: result.username, pfp_url: result.pfpUrl })
      setPhase("ready")
    },
    []
  )

  const signOut = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => {})
    setUser(null)
    setPhase("signed-out")
  }, [])

  const shell = (inner: React.ReactNode) => (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#f3f4f6", fontFamily, padding: "24px" }}>
      <div style={{ background: "white", padding: "40px", borderRadius: "16px", maxWidth: "440px", width: "100%", boxShadow: "0 1px 3px rgba(0,0,0,0.1)", textAlign: "center" }}>
        {inner}
      </div>
    </div>
  )

  if (phase === "checking") {
    return shell(<p style={{ color: "#6b7280", margin: 0 }}>Checking admin access…</p>)
  }

  if (phase === "denied") {
    return shell(
      <>
        <h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: 600 }}>Not an admin</h2>
        <p style={{ margin: "0 0 20px", fontSize: "14px", color: "#6b7280" }}>
          FID {user?.fid} signed in successfully but is not on the admin list.
        </p>
        <button onClick={signOut} style={{ padding: "10px 20px", background: "#111827", color: "white", border: "none", borderRadius: "8px", fontSize: "14px", fontWeight: 600, cursor: "pointer", fontFamily }}>
          Sign out
        </button>
      </>
    )
  }

  if (phase === "signed-out") {
    return shell(
      <>
        <h2 style={{ margin: "0 0 8px", fontSize: "20px", fontWeight: 600 }}>Admin sign-in</h2>
        <p style={{ margin: "0 0 24px", fontSize: "14px", color: "#6b7280", lineHeight: 1.5 }}>
          Sign in with Farcaster to continue.
        </p>
        <div style={{ display: "flex", justifyContent: "center" }}>
          <SignInButton nonce={getNonce} onSuccess={handleSuccess} onError={(e) => setError(e?.message || "Sign-in failed")} />
        </div>
        {error && <p style={{ margin: "16px 0 0", fontSize: "13px", color: "#dc2626" }}>{error}</p>}
      </>
    )
  }

  return <>{React.cloneElement(children as React.ReactElement, { user, onSignOut: signOut })}</>
}

/**
 * Provider wrapper. `domain` and `siweUri` must match what the server verifies
 * against, or every signature is rejected with a confusing "invalid" rather
 * than a mismatch error.
 *
 * `rpcUrl` is Optimism because that is where FID ownership is resolved.
 */
export function AdminSiwfProvider({ children }: Props) {
  const [origin, setOrigin] = useState("")
  useEffect(() => setOrigin(window.location.origin), [])

  return (
    <AuthKitProvider
      config={{
        rpcUrl: process.env.NEXT_PUBLIC_OPTIMISM_RPC_URL || "https://mainnet.optimism.io",
        domain: SIWF_DOMAIN,
        siweUri: origin ? `${origin}/admin` : `https://${SIWF_DOMAIN}/admin`,
      }}
    >
      <AdminSiwfGate>{children}</AdminSiwfGate>
    </AuthKitProvider>
  )
}
