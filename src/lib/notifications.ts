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
    title: (n) => `Round #${n} is live!`,
    body: (_, jackpot) => `The hunt begins — ${jackpot} ETH jackpot up for grabs. One correct guess wins it all.`,
  },
  {
    title: () => `New round just dropped`,
    body: (n, jackpot) => `Round #${n} is live with a ${jackpot} ETH prize pool. Can you find the secret 5-letter word?`,
  },
  {
    title: (n) => `Round #${n} — game on`,
    body: (_, jackpot) => `A new secret word is locked onchain. ${jackpot} ETH to whoever cracks it first.`,
  },
  {
    title: (n) => `Round #${n} is here`,
    body: (_, jackpot) => `Fresh word, fresh jackpot. ${jackpot} ETH on the line. Start guessing now.`,
  },
  {
    title: () => `The word is locked`,
    body: (n, jackpot) => `Round #${n} is live with ${jackpot} ETH. Every wrong guess narrows the field.`,
  },
  {
    title: (n) => `Hunt for word #${n}`,
    body: (_, jackpot) => `New round, new word. Prize pool: ${jackpot} ETH. One guess could change everything.`,
  },
  {
    title: (_, jackpot) => `${jackpot} ETH up for grabs`,
    body: (n) => `Round #${n} just started. Find the secret word before anyone else.`,
  },
  {
    title: (n) => `Round #${n} — let's go`,
    body: (_, jackpot) => `The secret word is committed onchain. ${jackpot} ETH jackpot waiting for the right guess.`,
  },
];

// ── Daily Reset templates (8 variations) ─────────────────────────────
const DAILY_RESET_TEMPLATES: NotificationTemplate[] = [
  {
    title: () => `Your guesses are refreshed`,
    body: (n, jackpot) => `New day, new chances. Round #${n} is still live with ${jackpot} ETH on the line.`,
  },
  {
    title: () => `Free guesses reset`,
    body: (n) => `Your daily guesses are back. The secret word in Round #${n} is still out there.`,
  },
  {
    title: () => `Daily reset — you're back in`,
    body: (_, jackpot) => `Fresh guesses are live. Can you crack the ${jackpot} ETH jackpot today?`,
  },
  {
    title: () => `New guesses available`,
    body: (n, jackpot) => `Your free guesses just reset. Jump back into Round #${n} — ${jackpot} ETH up for grabs.`,
  },
  {
    title: () => `Good morning, word hunter`,
    body: (n, jackpot) => `Daily guesses are live. Round #${n} prize pool: ${jackpot} ETH. Today could be your day.`,
  },
  {
    title: () => `Daily guesses are live`,
    body: (_, jackpot) => `Guesses refreshed. The hunt for the secret word continues — ${jackpot} ETH jackpot.`,
  },
  {
    title: () => `Guess again`,
    body: (n, jackpot) => `Daily reset complete. Your free guesses are ready. ${jackpot} ETH in Round #${n} awaits.`,
  },
  {
    title: () => `Back in the game`,
    body: (n, jackpot) => `Free guesses refreshed for Round #${n}. ${jackpot} ETH is still on the line.`,
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
function notificationsAreActive(): boolean {
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
export async function sendNotification(
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
 * @param jackpotEth - Optional jackpot amount in ETH (e.g. "0.02")
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
 * @param jackpotEth - Optional jackpot amount in ETH (e.g. "0.02")
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
 * @param prizeEth - Optional prize amount in ETH
 */
export async function notifyRoundResolved(
  roundNumber: number,
  winnerUsername?: string,
  prizeEth?: string
): Promise<NotificationResult> {
  const winner = winnerUsername ? `@${winnerUsername}` : 'Someone';
  const prize = prizeEth ? `${prizeEth} ETH` : 'the jackpot';

  return sendNotification(
    `Round #${roundNumber} complete!`,
    `${winner} found the word and won ${prize}! New round starts soon.`,
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
