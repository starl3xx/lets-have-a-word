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
      uuid: NEYNAR_APP_UUID,
      title,
      body,
      target_url: targetUrl || GAME_URL,
    };

    // Add target FIDs if specified (otherwise sends to all users)
    if (targetFids && targetFids.length > 0) {
      payload.target_fids = targetFids;
    }

    const response = await fetch('https://api.neynar.com/v2/farcaster/frame/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'api_key': NEYNAR_API_KEY,
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
 * Send "Round Started" notification
 *
 * @param roundNumber - The round number that just started
 */
export async function notifyRoundStarted(roundNumber: number): Promise<NotificationResult> {
  return sendNotification(
    `Round #${roundNumber} is live!`,
    'The hunt for the secret word begins. One correct guess wins the jackpot.',
    `${GAME_URL}?round=${roundNumber}`
  );
}

/**
 * Send "Daily Reset" notification
 *
 * @param message - Optional custom message (defaults to standard reset message)
 */
export async function notifyDailyReset(message?: string): Promise<NotificationResult> {
  return sendNotification(
    "Today's guesses are live",
    message || "Your daily free guesses have been refreshed. Good luck!",
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
