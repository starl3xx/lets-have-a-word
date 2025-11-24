"use client"

import React, { useState } from "react"
import { NeynarContextProvider, Theme, useNeynarContext, NeynarAuthButton } from "@neynar/react"

type TabType = 'dau' | 'wau' | 'events'

function DashboardContent() {
  const [activeTab, setActiveTab] = useState<TabType>('dau')
  let isAuthenticated = false

  try {
    const neynarContext = useNeynarContext()
    isAuthenticated = neynarContext.isAuthenticated
  } catch (error) {
    console.warn('Neynar context unavailable:', error)
  }

  if (!isAuthenticated) {
    return (
      <div style={{ padding: 24 }}>
        <h1>Analytics Dashboard</h1>
        <p>Please sign in with Farcaster</p>
        <NeynarAuthButton />
      </div>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: '#f3f4f6', padding: '24px' }}>
      <h1>Analytics Dashboard</h1>

      <nav style={{ marginBottom: 24, borderBottom: '1px solid #e5e7eb' }}>
        {[
          { id: 'dau', label: 'DAU' },
          { id: 'wau', label: 'WAU' },
          { id: 'events', label: 'Events' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            style={{
              padding: '8px 16px',
              marginRight: 8,
              background: activeTab === tab.id ? '#9333ea' : 'transparent',
              color: activeTab === tab.id ? 'white' : '#6b7280',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div style={{ background: 'white', padding: 24, borderRadius: 8 }}>
        <p>Active tab: {activeTab}</p>
      </div>
    </div>
  )
}

export default function AnalyticsDashboardClient() {
  const neynarClientId = process.env.NEXT_PUBLIC_NEYNAR_CLIENT_ID

  if (!neynarClientId) {
    return <div style={{ padding: 24 }}>Neynar not configured</div>
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
