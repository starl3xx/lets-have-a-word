// components/AnalyticsDashboardClient.tsx
"use client"

import React from "react"
import { NeynarContextProvider, Theme } from '@neynar/react'

/**
 * INCREMENTAL STEP 1: Add Neynar provider (no hooks yet)
 */

function DashboardContent() {
  return (
    <main className="min-h-screen p-4 bg-gray-100">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-4">Let&apos;s Have A Word – Analytics</h1>
        <div className="bg-white p-6 rounded-lg shadow">
          <p className="text-gray-600">Step 1: Neynar provider added, but not using hooks yet.</p>
        </div>
      </div>
    </main>
  )
}

const AnalyticsDashboardClient: React.FC = () => {
  const neynarClientId = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID

  if (!neynarClientId) {
    return (
      <div className="min-h-screen p-4">
        <p>Neynar not configured</p>
      </div>
    )
  }

  return (
    <NeynarContextProvider
      settings={{
        clientId: neynarClientId,
        defaultTheme: Theme.Light,
      }}
    >
      <DashboardContent />
    </NeynarContextProvider>
  )
}

export default AnalyticsDashboardClient
