/**
 * Social Section Component
 * Social media management for Farcaster and Twitter/X
 * Includes Status Cast Generator and Manual Tweet Poster
 */

import React, { useState, useCallback } from "react"

// =============================================================================
// Types
// =============================================================================

interface SocialSectionProps {
  user?: {
    fid: number
    username: string
    display_name?: string
    pfp_url?: string
  }
}

interface TopGuesser {
  fid: number
  username: string | null
  guessCount: number
}

// =============================================================================
// Styling
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  section: {
    background: "white",
    borderRadius: "12px",
    border: "1px solid #e5e7eb",
    padding: "24px",
    marginBottom: "24px",
  },
  sectionTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: "#111827",
    margin: "0 0 16px 0",
    letterSpacing: "-0.01em",
    fontFamily,
  },
  description: {
    fontSize: "13px",
    color: "#6b7280",
    marginBottom: "12px",
    fontFamily,
  },
  button: (loading: boolean, color: string = "#6366f1") => ({
    padding: "8px 16px",
    borderRadius: "8px",
    border: "none",
    background: loading ? "#d1d5db" : color,
    color: "white",
    fontWeight: 500,
    cursor: loading ? "not-allowed" : "pointer",
    fontFamily,
    fontSize: "13px",
  }),
  secondaryButton: (active: boolean) => ({
    padding: "8px 16px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    background: active ? "#dcfce7" : "white",
    color: active ? "#16a34a" : "#374151",
    fontWeight: 500,
    cursor: "pointer",
    fontFamily,
    fontSize: "13px",
  }),
  textarea: {
    width: "100%",
    minHeight: "160px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #e5e7eb",
    background: "#f9fafb",
    fontFamily: "monospace",
    fontSize: "13px",
    lineHeight: "1.5",
    resize: "vertical" as const,
  },
  editableTextarea: {
    width: "100%",
    minHeight: "160px",
    padding: "12px",
    borderRadius: "8px",
    border: "1px solid #d1d5db",
    background: "white",
    fontFamily: "monospace",
    fontSize: "13px",
    lineHeight: "1.5",
    resize: "vertical" as const,
  },
  buttonRow: {
    display: "flex" as const,
    gap: "8px",
    marginBottom: "12px",
  },
  alert: (type: 'success' | 'error' | 'info') => ({
    padding: "12px 16px",
    borderRadius: "8px",
    marginBottom: "12px",
    fontFamily,
    fontSize: "13px",
    background: type === 'success' ? "#dcfce7" : type === 'error' ? "#fee2e2" : "#dbeafe",
    color: type === 'success' ? "#166534" : type === 'error' ? "#991b1b" : "#1e40af",
    border: `1px solid ${type === 'success' ? "#bbf7d0" : type === 'error' ? "#fecaca" : "#bfdbfe"}`,
  }),
  link: {
    color: "#2563eb",
    textDecoration: "underline",
  },
  grid: {
    display: "grid" as const,
    gridTemplateColumns: "1fr 1fr",
    gap: "24px",
  },
}

// =============================================================================
// Helper Components
// =============================================================================

function Module({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <h3 style={styles.sectionTitle}>{title}</h3>
      {children}
    </div>
  )
}

// =============================================================================
// Social Section Component
// =============================================================================

export default function SocialSection({ user }: SocialSectionProps) {
  // Status cast generator state
  const [statusCastText, setStatusCastText] = useState<string>("")
  const [statusCastLoading, setStatusCastLoading] = useState(false)
  const [statusCastCopied, setStatusCastCopied] = useState(false)

  // Tweet poster state
  const [tweetText, setTweetText] = useState<string>("")
  const [tweetLoading, setTweetLoading] = useState(false)
  const [tweetResult, setTweetResult] = useState<{
    success: boolean
    message: string
    tweetUrl?: string
  } | null>(null)

  // Status cast generator function - fetches fresh data each time
  const generateStatusCast = useCallback(async () => {
    if (!user?.fid) {
      setStatusCastText("Not authenticated.")
      return
    }

    setStatusCastLoading(true)
    setStatusCastCopied(false)

    try {
      // Fetch fresh round state and top guessers in parallel
      const [roundStateRes, topGuessersRes] = await Promise.all([
        fetch('/api/round-state'),
        fetch('/api/round/top-guessers'),
      ])

      const roundState = roundStateRes.ok ? await roundStateRes.json() : null
      const topGuessersData = topGuessersRes.ok ? await topGuessersRes.json() : { topGuessers: [], uniqueGuessersCount: 0 }

      if (!roundState?.roundId) {
        setStatusCastText("No active round found.")
        return
      }

      const roundNumber = roundState.roundId
      const prizePool = parseFloat(roundState.prizePoolEth || '0').toFixed(4)
      const globalGuesses = (roundState.globalGuessCount || 0).toLocaleString()
      const playerCount = topGuessersData.uniqueGuessersCount?.toLocaleString() || "0"

      let topGuessersStr = ""
      if (topGuessersData.topGuessers && topGuessersData.topGuessers.length > 0) {
        const guessers = topGuessersData.topGuessers.slice(0, 10)

        const grouped: { count: number; usernames: string[] }[] = []
        for (const g of guessers) {
          const username = `@${g.username || `fid:${g.fid}`}`
          const lastGroup = grouped[grouped.length - 1]
          if (lastGroup && lastGroup.count === g.guessCount) {
            lastGroup.usernames.push(username)
          } else {
            grouped.push({ count: g.guessCount, usernames: [username] })
          }
        }

        topGuessersStr = grouped
          .map(g => `${g.usernames.join(" ")} (${g.count})`)
          .join(" ")
      }

      const castText = `@letshaveaword status
🔵 Round: #${roundNumber}
💰 Prize pool: ${prizePool} ETH
🎯 Global guesses: ${globalGuesses}
👥 Players: ${playerCount}
🏆 Top early guessers: ${topGuessersStr || "N/A"}
🏅 Mini app rank: #`

      setStatusCastText(castText)
    } catch (err) {
      console.error("[SocialSection] Error generating status cast:", err)
      setStatusCastText("Error generating status cast. Please try again.")
    } finally {
      setStatusCastLoading(false)
    }
  }, [user?.fid])

  const copyStatusCast = useCallback(async () => {
    if (!statusCastText) return

    try {
      await navigator.clipboard.writeText(statusCastText)
      setStatusCastCopied(true)
      setTimeout(() => setStatusCastCopied(false), 2000)
    } catch (err) {
      console.error("[SocialSection] Failed to copy to clipboard:", err)
    }
  }, [statusCastText])

  // Tweet poster functions
  const postTweet = useCallback(async () => {
    if (!tweetText.trim()) {
      setTweetResult({ success: false, message: "Tweet text cannot be empty." })
      return
    }

    setTweetLoading(true)
    setTweetResult(null)

    try {
      const response = await fetch('/api/admin/post-tweet', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': '', // Will use cookies/session instead
        },
        body: JSON.stringify({ text: tweetText }),
        credentials: 'include',
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setTweetResult({
          success: true,
          message: "Tweet posted successfully!",
          tweetUrl: data.tweetUrl,
        })
        setTweetText("") // Clear after success
      } else {
        setTweetResult({
          success: false,
          message: data.reason || data.error || "Failed to post tweet.",
        })
      }
    } catch (err) {
      console.error("[SocialSection] Error posting tweet:", err)
      setTweetResult({
        success: false,
        message: "Network error. Please try again.",
      })
    } finally {
      setTweetLoading(false)
    }
  }, [tweetText])

  const loadStatusCastToTweet = useCallback(() => {
    if (statusCastText) {
      // Convert Farcaster format to Twitter format
      let twitterText = statusCastText
      // Replace @letshaveaword with @letshaveaword_
      twitterText = twitterText.replace(/@letshaveaword\b/g, '@letshaveaword_')
      // Remove other @ mentions (keep just the username)
      twitterText = twitterText.replace(/@(\w+)/g, (match, username) => {
        if (username === 'letshaveaword_') return match
        return username
      })
      setTweetText(twitterText)
    }
  }, [statusCastText])

  return (
    <div>
      {/* Two-column layout */}
      <div style={styles.grid}>
        {/* ================================================================== */}
        {/* STATUS CAST GENERATOR (Farcaster) */}
        {/* ================================================================== */}
        <Module title="Farcaster Status Cast Generator">
          <p style={styles.description}>
            Generate a formatted status update for Farcaster with current game stats.
          </p>
          <div style={styles.buttonRow}>
            <button
              onClick={generateStatusCast}
              disabled={statusCastLoading}
              style={styles.button(statusCastLoading)}
            >
              {statusCastLoading ? "Generating..." : "Generate Status Cast"}
            </button>
            {statusCastText && (
              <>
                <button
                  onClick={copyStatusCast}
                  style={styles.secondaryButton(statusCastCopied)}
                >
                  {statusCastCopied ? "Copied!" : "Copy to Clipboard"}
                </button>
                <button
                  onClick={loadStatusCastToTweet}
                  style={styles.secondaryButton(false)}
                >
                  Copy to Tweet
                </button>
              </>
            )}
          </div>
          {statusCastText && (
            <textarea
              value={statusCastText}
              readOnly
              style={styles.textarea}
            />
          )}
        </Module>

        {/* ================================================================== */}
        {/* TWITTER/X TWEET POSTER */}
        {/* ================================================================== */}
        <Module title="Twitter/X Post">
          <p style={styles.description}>
            Post a tweet from @letshaveaword_. Farcaster mentions will be converted automatically.
          </p>

          {tweetResult && (
            <div style={styles.alert(tweetResult.success ? 'success' : 'error')}>
              {tweetResult.message}
              {tweetResult.tweetUrl && (
                <>
                  {" "}
                  <a href={tweetResult.tweetUrl} target="_blank" rel="noopener noreferrer" style={styles.link}>
                    View tweet
                  </a>
                </>
              )}
            </div>
          )}

          <textarea
            value={tweetText}
            onChange={(e) => setTweetText(e.target.value)}
            placeholder="Write your tweet here... (max 280 characters)"
            style={styles.editableTextarea}
          />

          <div style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: "12px"
          }}>
            <span style={{
              fontSize: "12px",
              color: tweetText.length > 280 ? "#dc2626" : "#6b7280",
              fontFamily
            }}>
              {tweetText.length}/280 characters
            </span>
            <button
              onClick={postTweet}
              disabled={tweetLoading || !tweetText.trim() || tweetText.length > 280}
              style={styles.button(tweetLoading || !tweetText.trim() || tweetText.length > 280, "#1DA1F2")}
            >
              {tweetLoading ? "Posting..." : "Post to Twitter/X"}
            </button>
          </div>
        </Module>
      </div>

      {/* ================================================================== */}
      {/* QUICK TEMPLATES */}
      {/* ================================================================== */}
      <Module title="Quick Tweet Templates">
        <p style={styles.description}>
          Click a template to load it into the tweet composer.
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {[
            {
              label: "Round Live",
              text: `🔵 New round is live in @letshaveaword_!

One secret word. One winner takes the ETH jackpot.

Every wrong guess removes a word from the global pool.

Play now: letshaveaword.fun`
            },
            {
              label: "Jackpot Growing",
              text: `🔥 The jackpot is growing in @letshaveaword_!

One correct guess wins it all.

letshaveaword.fun`
            },
            {
              label: "General Promo",
              text: `🎯 @letshaveaword_ - a massively multiplayer word guessing game on Farcaster

One secret word. One winner. ETH jackpots.

Play now: letshaveaword.fun`
            },
          ].map((template, idx) => (
            <button
              key={idx}
              onClick={() => setTweetText(template.text)}
              style={{
                padding: "8px 14px",
                borderRadius: "6px",
                border: "1px solid #e5e7eb",
                background: "#f9fafb",
                color: "#374151",
                fontSize: "12px",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily,
              }}
            >
              {template.label}
            </button>
          ))}
        </div>
      </Module>
    </div>
  )
}
