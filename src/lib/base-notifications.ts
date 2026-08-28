/**
 * Base App push notifications.
 *
 * The Base-side counterpart to notifications.ts. Base App stopped being a
 * Farcaster mini app host on 2026-04-09, so a player there has no FID and
 * Neynar cannot reach them — this is the only channel that can.
 *
 * TARGETED BY WALLET ADDRESS, which is why this fits at all: a wallet-native
 * player's identity IS their address, so `users.signer_wallet_address` is
 * already the right key with no translation. Base delivers only to users who
 * have PINNED the app and enabled notifications, and it reports per-address why
 * it could not deliver, so there is no separate opt-in state for us to keep.
 *
 * SAME HARD STOP AS NEYNAR, FOR THE SAME REASON. `notificationsAreActive()` is
 * imported from notifications.ts rather than reimplemented: on 2026-08-14 a
 * sourced .env.local disarmed several "never post outside production" guards at
 * once, and a broadcast push cannot be recalled. One guard, one place, and
 * BASE_NOTIFICATIONS_API_KEY is cleared in setup-guards.ts so a test run cannot
 * authenticate even if a flag is wrong.
 */

import { notificationsAreActive } from './notifications';

const API_BASE = 'https://dashboard.base.org/api/v1/notifications';
const API_KEY = process.env.BASE_NOTIFICATIONS_API_KEY;
/** Must match the URL registered in the Base dashboard. */
const APP_URL = process.env.BASE_APP_URL || 'https://letshaveaword.fun';
const DEBUG = process.env.NOTIFICATIONS_DEBUG_LOGS === 'true';

/** Base's documented ceilings. Exceeding them is a 400, not a truncation. */
const MAX_TITLE = 30;
const MAX_MESSAGE = 200;
const MAX_ADDRESSES_PER_REQUEST = 1000;
/** The user-list endpoint caps at 500, unlike the 1000 the send endpoint takes. */
const MAX_USERS_PER_PAGE = 500;

/**
 * The endpoints share 20 requests per minute per IP. A broadcast is
 * ceil(recipients / 1000) sends plus one page read per 1000 listed users, so a
 * 3.1s spacing keeps even a large fan-out inside the budget without needing to
 * think about it at the call site.
 */
const REQUEST_SPACING_MS = 3100;

export interface BaseNotificationResult {
  success: boolean;
  sentCount: number;
  failedCount: number;
  error?: string;
  /** Reasons Base gave, deduplicated — "user has not saved this app" etc. */
  failureReasons?: string[];
}

interface SendResponse {
  success?: boolean;
  results?: Array<{ walletAddress: string; sent: boolean; failureReason?: string }>;
  sentCount?: number;
  failedCount?: number;
  message?: string;
  error?: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Trim to Base's limit on a word boundary where one is close enough to matter.
 *
 * Titles and bodies here are written for Neynar, which is far more generous, so
 * something has to give. Cutting mid-word reads like a bug; an ellipsis reads
 * like an intent.
 */
function fit(text: string, max: number): string {
  if (text.length <= max) return text;
  const hard = text.slice(0, max - 1);
  const lastSpace = hard.lastIndexOf(' ');
  const body = lastSpace > max * 0.6 ? hard.slice(0, lastSpace) : hard;
  return `${body.trimEnd()}…`;
}

function configured(): boolean {
  if (!notificationsAreActive()) {
    if (DEBUG) console.log('[base-notifications] inactive (dev mode or disabled)');
    return false;
  }
  if (!API_KEY) {
    if (DEBUG) console.log('[base-notifications] no BASE_NOTIFICATIONS_API_KEY, skipping');
    return false;
  }
  return true;
}

/**
 * Every wallet that has pinned the app AND left notifications on.
 *
 * Asking Base who is reachable, rather than sending to every wallet we know
 * about and letting most of them fail, is the difference between one request
 * per thousand recipients and one wasted send per non-adopter. Paginated, and
 * capped so a runaway cannot spend the whole rate budget.
 */
export async function listOptedInWallets(maxPages = 10): Promise<string[]> {
  if (!configured()) return [];

  const wallets: string[] = [];
  let cursor: string | undefined;

  try {
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`${API_BASE}/app/users`);
      // app_url is REQUIRED — without it the request is rejected and the
      // caller silently sees an empty audience.
      url.searchParams.set('app_url', APP_URL);
      url.searchParams.set('notification_enabled', 'true');
      url.searchParams.set('limit', String(MAX_USERS_PER_PAGE));
      if (cursor) url.searchParams.set('cursor', cursor);

      const res = await fetch(url.toString(), { headers: { 'x-api-key': API_KEY! } });
      if (!res.ok) {
        console.error(`[base-notifications] user list failed: HTTP ${res.status}`);
        break;
      }
      // Field names are `address` and `nextCursor`, per the API reference. An
      // earlier version guessed at `walletAddress`/`next_cursor` and would have
      // read every page as empty while reporting success.
      const data = (await res.json()) as {
        users?: Array<{ address?: string; notificationsEnabled?: boolean }>;
        nextCursor?: string;
      };

      for (const u of data.users ?? []) {
        if (u.address) wallets.push(u.address);
      }

      cursor = data.nextCursor;
      if (!cursor || (data.users ?? []).length === 0) break;
      await sleep(REQUEST_SPACING_MS);
    }
  } catch (error) {
    console.error('[base-notifications] user list error:', error);
  }

  return wallets;
}

/**
 * Send to specific wallets, or to everyone who has opted in when none given.
 *
 * NEVER THROWS. A notification is the least important thing happening on any
 * code path that sends one — a round start still starts, a winner still gets
 * paid. Every failure returns a result and is logged.
 */
export async function sendBaseNotification(params: {
  title: string;
  message: string;
  /** Omit to broadcast to every opted-in wallet. */
  walletAddresses?: string[];
  /** In-app route, must begin with "/". */
  targetPath?: string;
}): Promise<BaseNotificationResult> {
  const empty: BaseNotificationResult = { success: false, sentCount: 0, failedCount: 0 };
  if (!configured()) return { ...empty, error: 'Base notifications disabled' };

  const targets = params.walletAddresses?.length
    ? params.walletAddresses
    : await listOptedInWallets();

  if (targets.length === 0) {
    if (DEBUG) console.log('[base-notifications] no reachable wallets, skipping');
    return { ...empty, success: true };
  }

  const title = fit(params.title, MAX_TITLE);
  const message = fit(params.message, MAX_MESSAGE);
  const targetPath =
    params.targetPath && params.targetPath.startsWith('/') ? params.targetPath : undefined;

  let sentCount = 0;
  let failedCount = 0;
  const reasons = new Set<string>();
  let lastError: string | undefined;

  for (let i = 0; i < targets.length; i += MAX_ADDRESSES_PER_REQUEST) {
    const batch = targets.slice(i, i + MAX_ADDRESSES_PER_REQUEST);
    try {
      const res = await fetch(`${API_BASE}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY! },
        body: JSON.stringify({
          app_url: APP_URL,
          wallet_addresses: batch,
          title,
          message,
          ...(targetPath ? { target_path: targetPath } : {}),
        }),
      });

      const data = (await res.json().catch(() => ({}))) as SendResponse;

      if (!res.ok) {
        lastError = data.message || data.error || `HTTP ${res.status}`;
        failedCount += batch.length;
        console.error(`[base-notifications] send failed: ${lastError}`);
      } else {
        sentCount += data.sentCount ?? 0;
        failedCount += data.failedCount ?? 0;
        for (const r of data.results ?? []) {
          if (!r.sent && r.failureReason) reasons.add(r.failureReason);
        }
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'Unknown error';
      failedCount += batch.length;
      console.error('[base-notifications] send error:', error);
    }

    if (i + MAX_ADDRESSES_PER_REQUEST < targets.length) await sleep(REQUEST_SPACING_MS);
  }

  if (DEBUG || failedCount > 0) {
    console.log(
      `[base-notifications] "${title}" sent=${sentCount} failed=${failedCount}` +
        (reasons.size ? ` reasons=${[...reasons].join('; ')}` : '')
    );
  }

  return {
    success: sentCount > 0 || failedCount === 0,
    sentCount,
    failedCount,
    error: lastError,
    failureReasons: reasons.size ? [...reasons] : undefined,
  };
}

/**
 * Notify our own wallet-native players.
 *
 * Deliberately does NOT call listOptedInWallets first. That endpoint pages at
 * 1000 users with 3.1s between requests to respect the shared rate limit, which
 * is fine for an admin tool and far too slow inside a serverless request that a
 * round start is waiting on. Sending to the addresses we already hold costs one
 * indexed query and ceil(N/1000) requests — one, at any scale this game has —
 * and Base reports per address when someone has not pinned the app, so nothing
 * is lost by not asking first.
 *
 * Only `identity_origin = 'wallet'` rows are targeted. A Farcaster player's
 * `signer_wallet_address` is a Neynar-verified EOA that has no relationship to
 * Base App, so notifying it would be both useless and a little creepy; they are
 * reached through Neynar, which is the channel they opted into.
 */
/**
 * Who a Base push would reach, resolved from the database.
 *
 * SEPARATE FROM THE SENDING, and exported, because this is the half that can
 * do damage and the half that cannot be tested through notifyBasePlayers:
 * that function is gated on notificationsAreActive(), which hard-stops outside
 * production — correctly, since a test run must never be able to push. Pulling
 * the audience out means the rule "a targeted send never becomes a broadcast"
 * can be proven without faking production.
 *
 * Pass targetFids to restrict. OMITTING IT MEANS EVERYONE, so a caller that
 * means to reach one player must say so.
 */
export async function resolveBaseAudience(targetFids?: number[]): Promise<string[]> {
  const targeted = Array.isArray(targetFids);
  // A targeted send with no recipients is not a broadcast.
  if (targeted && targetFids!.length === 0) return [];

  const { db } = await import('../db');
  const { users, userAddresses } = await import('../db/schema');
  const { and, eq, isNotNull, inArray } = await import('drizzle-orm');

  const fidFilter = targetFids ?? [];

  // TWO SOURCES, because a Base App player is not always a wallet-origin row.
  // After account linking a returning Farcaster player keeps their original row
  // — identity_origin 'farcaster' — while playing in Base App through a linked
  // address. Selecting only wallet rows would mean linking silently costs a
  // player the one notification channel they have.
  const walletRows = await db
    .select({ wallet: users.signerWalletAddress })
    .from(users)
    .where(
      targeted
        ? and(
            eq(users.identityOrigin, 'wallet'),
            isNotNull(users.signerWalletAddress),
            inArray(users.fid, fidFilter)
          )
        : and(eq(users.identityOrigin, 'wallet'), isNotNull(users.signerWalletAddress))
    );

  const linkedRows = await db
    .select({ wallet: userAddresses.address })
    .from(userAddresses)
    .where(targeted ? inArray(userAddresses.fid, fidFilter) : undefined);

  const seen = new Set<string>();
  const addresses: string[] = [];
  for (const row of [...walletRows, ...linkedRows]) {
    const w = row.wallet;
    if (typeof w !== 'string' || w.length === 0) continue;
    const key = w.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    addresses.push(w);
  }
  return addresses;
}

export async function notifyBasePlayers(params: {
  title: string;
  message: string;
  targetPath?: string;
  /**
   * Restrict to these players. OMITTING THIS BROADCASTS to everyone reachable,
   * so a caller that means to reach one player must say so — sendNotification
   * honoured targetFids on the Neynar rail and passed nothing here, which made
   * the first targeted send a silent broadcast to the entire Base App
   * audience. A push cannot be recalled, and this is the only channel these
   * players have.
   */
  targetFids?: number[];
}): Promise<BaseNotificationResult> {
  if (!configured()) {
    return { success: false, sentCount: 0, failedCount: 0, error: 'Base notifications disabled' };
  }

  try {
    const walletAddresses = await resolveBaseAudience(params.targetFids);

    if (walletAddresses.length === 0) {
      if (DEBUG) {
        console.log(
          params.targetFids
            ? '[base-notifications] none of the targeted players are reachable here'
            : '[base-notifications] no wallet-native players yet'
        );
      }
      return { success: true, sentCount: 0, failedCount: 0 };
    }

    return await sendBaseNotification({ ...params, walletAddresses });
  } catch (error) {
    console.error('[base-notifications] failed to resolve wallet players:', error);
    return {
      success: false,
      sentCount: 0,
      failedCount: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
