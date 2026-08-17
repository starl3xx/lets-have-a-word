/**
 * Social Section Component
 * Social media management for Farcaster and Twitter/X
 * Includes Status Cast Generator and Manual Tweet Poster
 */

import React, { useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { AlertBanner, Module } from "./ui"
import { formatPrizeCompact } from "../../src/lib/prize-display"

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

// =============================================================================
// Styling
// =============================================================================

const fontFamily = "'Söhne', 'SF Pro Display', system-ui, -apple-system, sans-serif"

const styles = {
  description: {
    fontSize: "13px",
    color: "#6b7280",
    marginBottom: "12px",
    fontFamily,
  },
  buttonRow: {
    display: "flex" as const,
    gap: "8px",
    marginBottom: "12px",
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

// Module now comes from the shared admin vocabulary (./ui).

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

  // Push notification state
  const [notifTitle, setNotifTitle] = useState<string>("")
  const [notifBody, setNotifBody] = useState<string>("")
  const [notifLoading, setNotifLoading] = useState(false)
  const [notifResult, setNotifResult] = useState<{
    success: boolean
    message: string
    recipientCount?: number
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
      // Fetch fresh round state, top guessers, bonus word winners, and burn word finders in parallel
      const [roundStateRes, topGuessersRes, bonusWinnersRes, burnFindersRes] = await Promise.all([
        fetch('/api/round-state'),
        fetch('/api/round/top-guessers'),
        fetch('/api/round/bonus-word-winners'),
        fetch('/api/round/burn-word-finders'),
      ])

      const roundState = roundStateRes.ok ? await roundStateRes.json() : null
      const topGuessersData = topGuessersRes.ok ? await topGuessersRes.json() : { topGuessers: [], uniqueGuessersCount: 0 }
      const bonusWinnersData = bonusWinnersRes.ok ? await bonusWinnersRes.json() : { winners: [] }
      const burnFindersData = burnFindersRes.ok ? await burnFindersRes.json() : { finders: [] }

      if (!roundState?.roundId) {
        setStatusCastText("No active round found.")
        return
      }

      const roundNumber = roundState.roundId
      // Prize line follows the round's currency — never infer the era.
      const prizeLine = formatPrizeCompact({
        currency: roundState.prizeCurrency ?? 'eth',
        eth: roundState.prizePoolEth,
        word: roundState.prizePoolWord,
      })
      const prizeUsd = roundState.prizePoolUsd
        ? ` (≈$${Number(roundState.prizePoolUsd).toLocaleString('en-US', { maximumFractionDigits: 0 })})`
        : ''
      const globalGuessCount = roundState.globalGuessCount || 0
      const globalGuesses = globalGuessCount.toLocaleString()
      const playerCount = topGuessersData.uniqueGuessersCount?.toLocaleString() || "0"

      // Calculate percentage of valid words guessed (total valid words ≈ 4400)
      const totalValidWords = 4400
      const guessPercentage = Math.round((globalGuessCount / totalValidWords) * 100)

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

      // Build bonus word finders string
      let bonusWordFindersStr = ""
      if (bonusWinnersData.winners && bonusWinnersData.winners.length > 0) {
        const bonusUsernames = bonusWinnersData.winners.map(
          (w: { username: string; fid: number }) => `@${w.username || `fid:${w.fid}`}`
        )
        bonusWordFindersStr = bonusUsernames.join(" ")
      }

      // Build burn word finders string
      let burnWordFindersStr = ""
      if (burnFindersData.finders && burnFindersData.finders.length > 0) {
        const burnEntries = burnFindersData.finders.map(
          (f: { username: string; fid: number; word: string }) =>
            `@${f.username || `fid:${f.fid}`} (${f.word.toUpperCase()})`
        )
        burnWordFindersStr = burnEntries.join(" ")
      }

      // Build cast text, only include finders lines if there are winners
      const bonusWordFindersLine = bonusWordFindersStr
        ? `\n🎣 Bonus word finders: ${bonusWordFindersStr}`
        : ""
      const burnWordFindersLine = burnWordFindersStr
        ? `\n🔥 Burn word finders: ${burnWordFindersStr}`
        : ""

      const castText = `@letshaveaword status
🔵 Round: #${roundNumber}
💰 Prize pool: ${prizeLine}${prizeUsd}
🎯 Global guesses: ${globalGuesses} (≈${guessPercentage}%)
👥 Players: ${playerCount}
⚡ Top early guessers: ${topGuessersStr || "N/A"}${bonusWordFindersLine}${burnWordFindersLine}
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

    if (!user?.fid) {
      setTweetResult({ success: false, message: "Not authenticated." })
      return
    }

    setTweetLoading(true)
    setTweetResult(null)

    try {
      const response = await fetch(`/api/admin/post-tweet?devFid=${user.fid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
  }, [tweetText, user?.fid])

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

  // Push notification functions
  const sendNotification = useCallback(async () => {
    if (!notifTitle.trim() || !notifBody.trim()) {
      setNotifResult({ success: false, message: "Title and body are required." })
      return
    }

    if (!user?.fid) {
      setNotifResult({ success: false, message: "Not authenticated." })
      return
    }

    setNotifLoading(true)
    setNotifResult(null)

    try {
      const response = await fetch(`/api/admin/send-notification?devFid=${user.fid}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: notifTitle, body: notifBody }),
        credentials: 'include',
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setNotifResult({
          success: true,
          message: `Notification sent to ${data.recipientCount?.toLocaleString() || 'all'} users!`,
          recipientCount: data.recipientCount,
        })
        setNotifTitle("")
        setNotifBody("")
      } else {
        setNotifResult({
          success: false,
          message: data.error || "Failed to send notification.",
        })
      }
    } catch (err) {
      console.error("[SocialSection] Error sending notification:", err)
      setNotifResult({
        success: false,
        message: "Network error. Please try again.",
      })
    } finally {
      setNotifLoading(false)
    }
  }, [notifTitle, notifBody, user?.fid])

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
            <Button size="sm" onClick={generateStatusCast} disabled={statusCastLoading}>
              {statusCastLoading ? "Generating..." : "Generate Status Cast"}
            </Button>
            {statusCastText && (
              <>
                <Button
                  size="sm"
                  variant={statusCastCopied ? "secondary" : "outline"}
                  onClick={copyStatusCast}
                >
                  {statusCastCopied ? "Copied!" : "Copy to Clipboard"}
                </Button>
                <Button size="sm" variant="outline" onClick={loadStatusCastToTweet}>
                  Copy to Tweet
                </Button>
              </>
            )}
          </div>
          {statusCastText && (
            <Textarea
              value={statusCastText}
              readOnly
              className="min-h-40 bg-muted font-mono text-[13px] leading-relaxed"
            />
          )}
        </Module>

        {/* ================================================================== */}
        {/* TWITTER/X TWEET POSTER */}
        {/* ================================================================== */}
        <Module title="Twitter/X Post">
          <p style={styles.description}>
            Post a tweet from @letshaveaword_ via Typefully. Farcaster mentions will be converted automatically.
          </p>

          {tweetResult && (
            <AlertBanner kind={tweetResult.success ? "success" : "error"}>
              {tweetResult.message}
              {tweetResult.tweetUrl && (
                <>
                  {" "}
                  <a
                    href={tweetResult.tweetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline"
                  >
                    View tweet
                  </a>
                </>
              )}
            </AlertBanner>
          )}

          <Textarea
            value={tweetText}
            onChange={(e) => setTweetText(e.target.value)}
            placeholder="Write your tweet here... (max 280 characters)"
            className="min-h-40 font-mono text-[13px] leading-relaxed"
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
            <Button
              size="sm"
              onClick={postTweet}
              disabled={tweetLoading || !tweetText.trim() || tweetText.length > 280}
            >
              {tweetLoading ? "Posting..." : "Post to Twitter/X"}
            </Button>
          </div>
        </Module>
      </div>

      {/* ================================================================== */}
      {/* PUSH NOTIFICATIONS */}
      {/* ================================================================== */}
      <Module title="Push Notifications (Mini App)">
        <p style={styles.description}>
          Send push notifications to users who have enabled notifications for the mini app.
        </p>

        {notifResult && (
          <AlertBanner kind={notifResult.success ? "success" : "error"}>
            {notifResult.message}
          </AlertBanner>
        )}

        <div style={{ marginBottom: "12px" }}>
          <Label htmlFor="notif-title" className="mb-1 block text-xs text-muted-foreground">
            Title (max 50 characters)
          </Label>
          <Input
            id="notif-title"
            type="text"
            value={notifTitle}
            onChange={(e) => setNotifTitle(e.target.value)}
            placeholder="e.g., Round #3 is live!"
            maxLength={50}
          />
          <div style={{ fontSize: "11px", color: notifTitle.length > 50 ? "#dc2626" : "#9ca3af", textAlign: "right", marginTop: "4px" }}>
            {notifTitle.length}/50
          </div>
        </div>

        <div style={{ marginBottom: "12px" }}>
          <Label htmlFor="notif-body" className="mb-1 block text-xs text-muted-foreground">
            Body (max 200 characters)
          </Label>
          <Textarea
            id="notif-body"
            value={notifBody}
            onChange={(e) => setNotifBody(e.target.value)}
            placeholder="e.g., The hunt for the secret word begins. One correct guess wins the jackpot."
            maxLength={200}
            className="min-h-20"
          />
          <div style={{ fontSize: "11px", color: notifBody.length > 200 ? "#dc2626" : "#9ca3af", textAlign: "right", marginTop: "4px" }}>
            {notifBody.length}/200
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {[
              { label: "Round Live", title: "Round is live!", body: "The hunt for the secret word begins. One correct guess wins the jackpot." },
              { label: "Daily Reset", title: "Today's guesses are live", body: "Your daily free guesses have been refreshed. Good luck!" },
              { label: "New Day", title: "New day, new guesses", body: "A fresh batch of guesses awaits. Will you find today's word?" },
            ].map((template, idx) => (
              <Button
                key={idx}
                size="sm"
                variant="outline"
                onClick={() => {
                  setNotifTitle(template.title)
                  setNotifBody(template.body)
                }}
              >
                {template.label}
              </Button>
            ))}
          </div>
          <Button
            size="sm"
            onClick={sendNotification}
            disabled={notifLoading || !notifTitle.trim() || !notifBody.trim()}
          >
            {notifLoading ? "Sending..." : "Send Notification"}
          </Button>
        </div>
      </Module>

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

One secret word. One winner takes the $WORD jackpot.

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

One secret word. One winner. $WORD jackpots.

Play now: letshaveaword.fun`
            },
          ].map((template, idx) => (
            <Button key={idx} size="sm" variant="outline" onClick={() => setTweetText(template.text)}>
              {template.label}
            </Button>
          ))}
        </div>
      </Module>
    </div>
  )
}
