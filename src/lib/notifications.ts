/**
 * Neynar Mini App Push Notifications
 *
 * Sends push notifications to users who have enabled notifications for the mini app.
 * Uses Neynar's Frame Notifications API.
 *
 * CRITICAL: Notifications are COMPLETELY DISABLED when NODE_ENV !== 'production'
 * to prevent accidental notifications from non-production environments.
 */

// Configuration from environment variables
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_APP_UUID = process.env.NEYNAR_APP_UUID; // Mini app UUID from Neynar dashboard
const NOTIFICATIONS_ENABLED = process.env.NOTIFICATIONS_ENABLED;
const NOTIFICATIONS_DEBUG_LOGS = process.env.NOTIFICATIONS_DEBUG_LOGS === 'true';
const NODE_ENV = process.env.NODE_ENV;

// Game URL for notification deep links
const GAME_URL = 'https://letshaveaword.fun';

// ── Notification template types ──────────────────────────────────────
interface NotificationTemplate {
  title: (n: number, jackpot: string) => string;
  body: (n: number, jackpot: string) => string;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── Round Start templates (8 variations) ─────────────────────────────
const ROUND_START_TEMPLATES: NotificationTemplate[] = [
  {
    title: (n) => `🔵 Round #${n} is live!`,
    body: (_, jackpot) => `The hunt begins — ${jackpot} jackpot up for grabs. One correct guess wins it all. 🕵️‍♂️`,
  },
  {
    title: () => `🔵 New round just dropped`,
    body: (n, jackpot) => `Round #${n} is live with a ${jackpot} prize pool. Can you find the secret 5-letter word? 🕵️‍♂️`,
  },
  {
    title: (n) => `🔵 Round #${n} — game on`,
    body: (_, jackpot) => `A new secret word is locked onchain. ${jackpot} to whoever cracks it first! 👀`,
  },
  {
    title: (n) => `🔵 Round #${n} is here`,
    body: (_, jackpot) => `Fresh word, fresh jackpot. ${jackpot} on the line. Start guessing now! 🕵️‍♂️`,
  },
  {
    title: () => `🔵 The word is locked`,
    body: (n, jackpot) => `Round #${n} is live with ${jackpot}. Every wrong guess narrows the field... 🕵️‍♂️`,
  },
  {
    title: (n) => `🔵 Hunt for word #${n}`,
    body: (_, jackpot) => `New round, new word. Prize pool: ${jackpot}. One guess could change everything. 🕵️‍♂️`,
  },
  {
    title: (_, jackpot) => `🔵 ${jackpot} up for grabs`,
    body: (n) => `Round #${n} just started. Can you find the secret word before anyone else? ⏳`,
  },
  {
    title: (n) => `🔵 Round #${n} — let\u2019s go!`,
    body: (_, jackpot) => `The secret word is committed onchain. ${jackpot} jackpot waiting for the right guess. 🕵️‍♂️`,
  },
];

// ── Daily Reset templates (8 variations) ─────────────────────────────
const DAILY_RESET_TEMPLATES: NotificationTemplate[] = [
  {
    title: () => `🌱 Your guesses are refreshed`,
    body: (n, jackpot) => `New day, new chances. Round #${n} is still live with ${jackpot} on the line!`,
  },
  {
    title: () => `🫳 Free guesses reset`,
    body: (n) => `Your daily guesses are back. The secret word in Round #${n} is still out there...`,
  },
  {
    title: () => `🔁 Daily reset — you\u2019re back in`,
    body: (_, jackpot) => `Fresh guesses are live. Can you crack the ${jackpot} jackpot today?`,
  },
  {
    title: () => `👀 New guesses available`,
    body: (n, jackpot) => `Your free guesses just reset. Jump back into Round #${n} — ${jackpot} up for grabs.`,
  },
  {
    title: () => `🔎 Gm, word hunter`,
    body: (n, jackpot) => `Daily guesses are live. Round #${n} prize pool: ${jackpot}. Today could be your day!`,
  },
  {
    title: () => `🌅 Daily guesses are live`,
    body: (_, jackpot) => `Guesses refreshed. The hunt for the secret word continues — ${jackpot} jackpot.`,
  },
  {
    title: () => `🎯 Guess again`,
    body: (n, jackpot) => `Daily reset complete. Your free guesses are ready. ${jackpot} in Round #${n} awaits.`,
  },
  {
    title: () => `💪 Back in the game`,
    body: (n, jackpot) => `Free guesses refreshed for Round #${n}. ${jackpot} is still on the line.`,
  },
];

// Startup validation (fail fast in production if misconfigured)
if (NODE_ENV === 'production' && NOTIFICATIONS_ENABLED === 'true') {
  if (!NEYNAR_API_KEY) {
    throw new Error('[notifications] FATAL: NEYNAR_API_KEY is required when NOTIFICATIONS_ENABLED=true in production');
  }
  if (!NEYNAR_APP_UUID) {
    throw new Error('[notifications] FATAL: NEYNAR_APP_UUID is required when NOTIFICATIONS_ENABLED=true in production');
  }
}

/**
 * Check if notifications are active and should be sent
 *
 * CRITICAL: Returns false in any non-production environment
 */
/**
 * Exported so base-notifications.ts can share the exact same hard stop rather
 * than reimplementing it. One guard in one place: on 2026-08-14 a sourced
 * .env.local disarmed several of these at once, and a broadcast push cannot be
 * recalled.
 */
export function notificationsAreActive(): boolean {
  // Hard stop in non-production - NEVER send from dev/staging
  if (NODE_ENV !== 'production') {
    if (NOTIFICATIONS_DEBUG_LOGS) {
      console.log('[notifications] inactive: NODE_ENV is not production');
    }
    return false;
  }

  // Check feature flag
  if (NOTIFICATIONS_ENABLED !== 'true') {
    if (NOTIFICATIONS_DEBUG_LOGS) {
      console.log('[notifications] inactive: NOTIFICATIONS_ENABLED is not true');
    }
    return false;
  }

  return true;
}

/**
 * Result of a notification send attempt
 */
export interface NotificationResult {
  success: boolean;
  notificationId?: string;
  recipientCount?: number;
  error?: string;
}

/**
 * Send a push notification to mini app users
 *
 * @param title - Notification title (appears as header)
 * @param body - Notification body text
 * @param targetUrl - URL to open when notification is tapped (defaults to game URL)
 * @param targetFids - Optional array of FIDs to target (omit for all users)
 * @returns Result of the notification attempt
 */
/** Lazily imported: base-notifications.ts imports notificationsAreActive from
 *  this file, so a static import here would be a cycle. */
async function notifyBasePlayers(params: {
  title: string;
  message: string;
  targetPath?: string;
  targetFids?: number[];
}) {
  const mod = await import('./base-notifications');
  return mod.notifyBasePlayers(params);
}

/**
 * Neynar takes a full URL; Base takes a path within the app. Carry the route
 * across rather than dropping it — a round-resolved notification that opens
 * /verify for a Farcaster player should not land a Base player on the home
 * screen.
 */
function targetPathFrom(targetUrl?: string): string {
  if (!targetUrl) return '/';
  try {
    const url = new URL(targetUrl);
    return `${url.pathname || '/'}${url.search || ''}`;
  } catch {
    return targetUrl.startsWith('/') ? targetUrl : '/';
  }
}

/**
 * Send on every channel a player might be reachable on.
 *
 * THE TWO ARE INDEPENDENT, DELIBERATELY. An earlier version fired the Base send
 * only after a successful Neynar response, which meant a Neynar outage — or
 * simply missing Neynar configuration — silenced the ONLY channel Base App
 * players have. They have no FID; Neynar cannot reach them at all. One
 * provider's bad day must not take out an audience that provider never served.
 *
 * The Neynar result is what callers see, because that is the contract they were
 * written against. Base failures are logged inside notifyBasePlayers and never
 * surface as a failed send here.
 */
export async function sendNotification(
  title: string,
  body: string,
  targetUrl?: string,
  targetFids?: number[]
): Promise<NotificationResult> {
  const [neynarResult] = await Promise.all([
    sendViaNeynar(title, body, targetUrl, targetFids).catch((error) => {
      console.error('[notifications] Neynar send threw:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as NotificationResult;
    }),
    notifyBasePlayers({
      title,
      message: body,
      targetPath: targetPathFrom(targetUrl),
      // THREADED THROUGH, not dropped. Without this a targeted send honoured
      // targetFids on the Neynar rail and broadcast to every Base App player
      // on this one — and a push cannot be recalled.
      targetFids,
    }).catch(() => undefined),
  ]);

  return neynarResult;
}

async function sendViaNeynar(
  title: string,
  body: string,
  targetUrl?: string,
  targetFids?: number[]
): Promise<NotificationResult> {
  if (!notificationsAreActive()) {
    if (NOTIFICATIONS_DEBUG_LOGS) {
      console.log('[notifications] inactive (dev mode or disabled), skipping:', title);
    }
    return { success: false, error: 'Notifications disabled' };
  }

  if (!NEYNAR_API_KEY || !NEYNAR_APP_UUID) {
    console.error('[notifications] ERROR: Missing required configuration');
    return { success: false, error: 'Missing configuration' };
  }

  try {
    const payload: Record<string, unknown> = {
      notification: {
        title,
        body,
        target_url: targetUrl || GAME_URL,
      },
      // Empty array = all users with notifications enabled
      target_fids: targetFids && targetFids.length > 0 ? targetFids : [],
    };

    const response = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': NEYNAR_API_KEY,
      },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[notifications] ERROR: API returned error:', data);
      return {
        success: false,
        error: data.message || data.error || `HTTP ${response.status}`,
      };
    }

    if (NOTIFICATIONS_DEBUG_LOGS) {
      console.log('[notifications] sent successfully:', {
        title,
        recipientCount: data.recipient_count,
        notificationId: data.notification_id,
      });
    }

    return {
      success: true,
      notificationId: data.notification_id,
      recipientCount: data.recipient_count,
    };
  } catch (error) {
    console.error('[notifications] ERROR: Failed to send notification:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Send "Round Started" notification with a randomized template
 *
 * @param roundNumber - The round number that just started
 * @param jackpot - Optional prize INCLUDING its unit ("0.0216 ETH" / "78,125,000 $WORD")
 */
export async function notifyRoundStarted(roundNumber: number, jackpotEth?: string): Promise<NotificationResult> {
  const jackpot = jackpotEth ?? '?';
  const template = pickRandom(ROUND_START_TEMPLATES);
  return sendNotification(
    template.title(roundNumber, jackpot),
    template.body(roundNumber, jackpot),
    `${GAME_URL}?round=${roundNumber}`
  );
}

/**
 * Send "Daily Reset" notification with a randomized template
 *
 * @param roundNumber - Optional current round number
 * @param jackpot - Optional prize INCLUDING its unit ("0.0216 ETH" / "78,125,000 $WORD")
 */
export async function notifyDailyReset(roundNumber?: number, jackpotEth?: string): Promise<NotificationResult> {
  const n = roundNumber ?? 0;
  const jackpot = jackpotEth ?? '?';
  const template = pickRandom(DAILY_RESET_TEMPLATES);
  return sendNotification(
    template.title(n, jackpot),
    template.body(n, jackpot),
    GAME_URL
  );
}

/**
 * Send "Round Resolved" notification
 *
 * @param roundNumber - The round number that was resolved
 * @param winnerUsername - Optional username of the winner
 * @param prize - Optional prize INCLUDING its unit ("0.0216 ETH" / "78,125,000 $WORD")
 */
export async function notifyRoundResolved(
  roundNumber: number,
  winnerUsername?: string,
  prizeEth?: string
): Promise<NotificationResult> {
  const winner = winnerUsername ? `@${winnerUsername}` : 'Someone';
  const prize = prizeEth || 'the jackpot';

  return sendNotification(
    `🟣 Round #${roundNumber} complete!`,
    `${winner} found the word and won ${prize}! New round starts soon... 👀`,
    `${GAME_URL}/verify?round=${roundNumber}`
  );
}

/**
 * Send a custom notification (for manual sends from admin panel)
 *
 * @param title - Notification title
 * @param body - Notification body
 * @param targetUrl - Optional custom URL
 */
export async function notifyCustom(
  title: string,
  body: string,
  targetUrl?: string
): Promise<NotificationResult> {
  return sendNotification(title, body, targetUrl);
}

/**
 * Notify all users that a Superguess has been purchased
 * Milestone 15: Superguess mechanic
 */
export async function notifySuperguessStarted(
  username: string
): Promise<NotificationResult> {
  return sendNotification(
    '🔴 SUPERGUESS purchased',
    `@${username} is making a Superguess — 25 guesses with 10 minutes on the clock. Watch live!`,
    GAME_URL
  );
}
