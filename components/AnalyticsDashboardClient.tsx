"use client"

import { NeynarContextProvider, Theme } from "@neynar/react"

export default function AnalyticsDashboardClient() {
  const neynarClientId = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID

  if (!neynarClientId) {
    return <div style={{ padding: "24px" }}>Neynar not configured</div>
  }

  return (
    <NeynarContextProvider
      clientId={neynarClientId}
      defaultTheme={Theme.Light}
    >
      <div style={{ padding: "24px" }}>
        <h1>Analytics</h1>
        <p>Step 2: Fixed Neynar provider props (no settings wrapper)</p>
      </div>
    </NeynarContextProvider>
  )
}
