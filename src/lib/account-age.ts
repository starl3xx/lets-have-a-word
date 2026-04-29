/**
 * Account-Age Gating
 *
 * Blocks gameplay for freshly-minted Farcaster accounts. Post-Round-28 sybil
 * defense: an attacker minted ~3k .base.eth FIDs inside a single round window
 * to farm bonus/burn words; the Neynar quality gate rubber-stamped them because
 * the accounts looked "normal enough." Minimum-age is the orthogonal signal.
 *
 * Source of truth for registration date is the Farcaster Hub onChainEvents API
 * (event_type=EVENT_TYPE_REGISTER, block timestamp is immutable). Neynar's
 * user object does NOT expose this field.
 *
 * Result is cached on users.fid_registered_at (nullable timestamp). The date
 * never changes once resolved, so we only hit the Hub once per FID.
 */
import * as Sentry from '@sentry/nextjs';
import { db } from '../db';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { logAnalyticsEvent } from './analytics';

export const ACCOUNT_TOO_NEW_ERROR = 'ACCOUNT_TOO_NEW';

const DEFAULT_MIN_DAYS = 14;
const HUB_FETCH_TIMEOUT_MS = 3000;
// Farcaster Hub OnChainEventType enum: EVENT_TYPE_ID_REGISTER = 3 is the FID
// registration event. The Hub HTTP API accepts either the enum name or the
// int; we use the name for readability. Using the wrong value silently returns
// zero events and fails the gate open.
const REGISTER_EVENT_TYPE = 'EVENT_TYPE_ID_REGISTER';

/**
 * How long to wait before retrying a Hub lookup that returned no result.
 * We write `checked_at` on every attempt so transient Hub failures don't
 * block a user forever, but we also don't want to hammer the Hub on every
 * request for a FID the Hub can't resolve.
 */
const HUB_RETRY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6 hours

function getMinAccountAgeDays(): number {
  const raw = process.env.ACCOUNT_AGE_MIN_DAYS;
  if (!raw) return DEFAULT_MIN_DAYS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MIN_DAYS;
}

function getAllowlistedFids(): Set<number> {
  const raw = process.env.ACCOUNT_AGE_ALLOWLIST || '';
  if (!raw.trim()) return new Set();
  return new Set(
    raw
      .split(',')
      .map((fid) => parseInt(fid.trim(), 10))
      .filter((fid) => !Number.isNaN(fid))
  );
}

function getHubUrl(): string {
  return (process.env.FARCASTER_HUB_URL || 'https://hub-api.neynar.com').replace(/\/$/, '');
}

export interface AccountAgeCheckResult {
  eligible: boolean;
  registeredAt: Date | null;
  ageDays: number | null;
  daysUntilEligible?: number;
  reason?: string;
  errorCode?: string;
}

/**
 * Fetch the Register event for a FID from the Farcaster Hub.
 * Returns null if not found or the Hub is unreachable within the timeout.
 */
async function fetchFidRegisteredAtFromHub(fid: number): Promise<Date | null> {
  const hubUrl = getHubUrl();
  const url = `${hubUrl}/v1/onChainEventsByFid?fid=${fid}&event_type=${REGISTER_EVENT_TYPE}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HUB_FETCH_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = { accept: 'application/json' };
    // Neynar's hub requires an API key; public hubs ignore the header.
    if (process.env.NEYNAR_API_KEY) {
      headers['x-api-key'] = process.env.NEYNAR_API_KEY;
    }

    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      console.warn(`[AccountAge] Hub returned ${response.status} for FID ${fid}`);
      Sentry.captureMessage(`[AccountAge] Hub returned non-200`, {
        level: 'warning',
        tags: { component: 'account-age', operation: 'hub_lookup', failure: 'http_error' },
        extra: { fid, status: response.status, statusText: response.statusText },
      });
      return null;
    }

    const body = (await response.json()) as { events?: Array<{ blockTimestamp?: number }> };
    const events = body.events ?? [];
    if (events.length === 0 || !events[0].blockTimestamp) {
      // Not a Hub outage — the FID genuinely has no Register event visible
      // (e.g. brand-new FID not yet propagated, or non-existent FID). Don't
      // alert Sentry for this; `checked_at` cooldown prevents hammering.
      console.warn(`[AccountAge] No Register event found for FID ${fid}`);
      return null;
    }

    // blockTimestamp is Unix seconds
    return new Date(events[0].blockTimestamp * 1000);
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      console.warn(`[AccountAge] Hub lookup timed out (${HUB_FETCH_TIMEOUT_MS}ms) for FID ${fid}`);
      Sentry.captureMessage(`[AccountAge] Hub lookup timed out`, {
        level: 'warning',
        tags: { component: 'account-age', operation: 'hub_lookup', failure: 'timeout' },
        extra: { fid, timeoutMs: HUB_FETCH_TIMEOUT_MS },
      });
    } else {
      console.error(`[AccountAge] Hub lookup failed for FID ${fid}:`, error);
      Sentry.captureException(error, {
        tags: { component: 'account-age', operation: 'hub_lookup', failure: 'exception' },
        extra: { fid },
      });
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Resolve the registration date for a FID, caching it on the users row.
 * Returns null when the Hub can't resolve the FID within the timeout.
 *
 * `forceRefresh: true` is used by the win-time eligibility re-check —
 * if the Hub was down at guess time and we cached a null with checkedAt,
 * the cooldown would otherwise prevent us from re-trying the Hub before
 * paying out the jackpot. We don't want a stale fail-open to lock in a
 * payout to an account whose age was never resolved.
 */
async function resolveFidRegisteredAt(
  fid: number,
  forceRefresh = false
): Promise<Date | null> {
  const [user] = await db
    .select({
      fidRegisteredAt: users.fidRegisteredAt,
      fidRegisteredAtCheckedAt: users.fidRegisteredAtCheckedAt,
    })
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  // Already cached — registration date is immutable.
  if (user?.fidRegisteredAt) {
    return user.fidRegisteredAt;
  }

  // Back off if we checked recently and got nothing — prevents hammering the Hub
  // on every request for a FID it can't resolve. Skipped on forceRefresh.
  const lastCheckedAt = user?.fidRegisteredAtCheckedAt;
  if (
    !forceRefresh &&
    lastCheckedAt &&
    Date.now() - lastCheckedAt.getTime() < HUB_RETRY_COOLDOWN_MS
  ) {
    return null;
  }

  const fetched = await fetchFidRegisteredAtFromHub(fid);

  // Always stamp checked_at, even on failure — the cooldown logic depends on it.
  await db
    .update(users)
    .set({
      fidRegisteredAt: fetched ?? undefined,
      fidRegisteredAtCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(users.fid, fid));

  return fetched;
}

/**
 * Check whether a FID's Farcaster account is old enough to play.
 *
 * Behavior:
 * - Allowlist FIDs bypass the check.
 * - Cached registration date is used when present (immutable).
 * - Missing dates are fetched from the Hub and cached.
 * - Hub failures fail OPEN with a Sentry alert — a Hub outage should not
 *   lock every legitimate user out. Sybil attackers can't trigger Hub outages.
 *
 * `forceRefresh: true` bypasses the retry cooldown and is used by the
 * win-time eligibility re-check.
 */
export async function checkAccountAge(
  fid: number,
  forceRefresh = false
): Promise<AccountAgeCheckResult> {
  const allowlist = getAllowlistedFids();
  if (allowlist.has(fid)) {
    return {
      eligible: true,
      registeredAt: null,
      ageDays: null,
      reason: 'Allowlisted FID',
    };
  }

  const minDays = getMinAccountAgeDays();

  try {
    const registeredAt = await resolveFidRegisteredAt(fid, forceRefresh);

    if (!registeredAt) {
      // Fail open. The memo is explicit: Hub outages should not brick gameplay.
      return {
        eligible: true,
        registeredAt: null,
        ageDays: null,
        reason: 'Registration date unavailable — allowing access',
      };
    }

    const ageMs = Date.now() - registeredAt.getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);

    if (ageDays >= minDays) {
      return { eligible: true, registeredAt, ageDays };
    }

    return {
      eligible: false,
      registeredAt,
      ageDays,
      daysUntilEligible: Math.max(1, Math.ceil(minDays - ageDays)),
      reason: `Your Farcaster account must be at least ${minDays} days old to play.`,
      errorCode: ACCOUNT_TOO_NEW_ERROR,
    };
  } catch (error) {
    console.error(`[AccountAge] Unexpected error checking FID ${fid}:`, error);
    Sentry.captureException(error, {
      tags: { component: 'account-age', operation: 'check' },
      extra: { fid },
    });
    // Fail open on unexpected errors.
    return {
      eligible: true,
      registeredAt: null,
      ageDays: null,
      reason: 'Error checking account age — allowing access',
    };
  }
}

export async function logBlockedAccountAgeAttempt(
  fid: number,
  result: AccountAgeCheckResult,
  action: string
): Promise<void> {
  await logAnalyticsEvent('ACCOUNT_AGE_BLOCKED', {
    userId: fid,
    data: {
      action,
      registeredAt: result.registeredAt?.toISOString() ?? null,
      ageDays: result.ageDays,
      daysUntilEligible: result.daysUntilEligible,
      minDays: getMinAccountAgeDays(),
      blockedAt: new Date().toISOString(),
    },
  });

  console.log(
    `🚫 [AccountAge] Blocked FID ${fid} (age ${result.ageDays?.toFixed(2) ?? '?'}d) from action: ${action}`
  );
}
