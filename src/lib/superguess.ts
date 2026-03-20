/**
 * Superguess — Core State Management
 * Milestone 15: High-stakes late-game mechanic
 *
 * After guess #850, a player pays $WORD tokens for an exclusive 25-guess,
 * 10-minute window. All other players are blocked and watch as spectators.
 * 50% of payment is burned, 50% goes to staking rewards.
 *
 * Feature flag: NEXT_PUBLIC_SUPERGUESS_ENABLED
 */

import { db } from '../db';
import { superguessSessions, users } from '../db/schema';
import { eq, and, sql, desc } from 'drizzle-orm';
import type { SuperguessSessionRow, SuperguessStatus } from '../db/schema';
import {
  redis,
  cacheGet,
  cacheSet,
  cacheDel,
  CACHE_PREFIX,
} from './redis';

// ============================================================
// Configuration & Constants
// ============================================================

/** Superguess window duration in minutes */
export const SUPERGUESS_DURATION_MINUTES = 10;

/** Cooldown after failed Superguess in minutes */
export const SUPERGUESS_COOLDOWN_MINUTES = 10;

/** Maximum guesses per Superguess session */
export const SUPERGUESS_MAX_GUESSES = 25;

/** Minimum global guess count before Superguess is available */
export const SUPERGUESS_MIN_GUESS_COUNT = 850;

/**
 * Pricing tiers based on remaining words in pool
 * Pool size = total_dictionary_words - global_guess_count
 */
export const SUPERGUESS_TIERS = [
  { id: 'tier_1', minRemaining: 3200, usdPrice: 20 },
  { id: 'tier_2', minRemaining: 2600, usdPrice: 40 },
  { id: 'tier_3', minRemaining: 2000, usdPrice: 60 },
  { id: 'tier_4', minRemaining: 0, usdPrice: 90 },
] as const;

export type SuperguessTierId = typeof SUPERGUESS_TIERS[number]['id'];

// ============================================================
// Feature Flag
// ============================================================

/**
 * Check if Superguess feature is enabled
 * Gates ALL Superguess code paths
 */
export function isSuperguessFeatureEnabled(): boolean {
  return process.env.NEXT_PUBLIC_SUPERGUESS_ENABLED === 'true';
}

// ============================================================
// Redis Cache Keys
// ============================================================

const SuperguessCacheKeys = {
  /** Active session JSON, TTL = remaining window */
  active: (roundId: number) => `${CACHE_PREFIX}superguess:active:${roundId}`,
  /** Cooldown flag, TTL = remaining cooldown */
  cooldown: (roundId: number) => `${CACHE_PREFIX}superguess:cooldown:${roundId}`,
  /** State endpoint cache (2s TTL, invalidated on each guess) */
  state: (roundId: number) => `${CACHE_PREFIX}superguess:state:${roundId}`,
};

// ============================================================
// Core State Functions
// ============================================================

/**
 * Get the active Superguess session for a round
 * Uses Redis cache with 2s TTL, falls back to DB
 * Implements lazy expiry: auto-expires if past expires_at
 */
export async function getActiveSuperguess(
  roundId: number
): Promise<SuperguessSessionRow | null> {
  // Try Redis cache first
  const cached = await cacheGet<SuperguessSessionRow>(
    SuperguessCacheKeys.active(roundId)
  );

  if (cached) {
    // Lazy expiry check
    if (new Date(cached.expiresAt) < new Date()) {
      await completeSuperguessSession(cached.id, 'expired');
      return null;
    }
    return cached;
  }

  // DB fallback
  const [session] = await db
    .select()
    .from(superguessSessions)
    .where(
      and(
        eq(superguessSessions.roundId, roundId),
        eq(superguessSessions.status, 'active')
      )
    )
    .limit(1);

  if (!session) return null;

  // Lazy expiry check
  if (new Date(session.expiresAt) < new Date()) {
    await completeSuperguessSession(session.id, 'expired');
    return null;
  }

  // Cache with TTL = remaining window time (max 2s for safety)
  const remainingMs = new Date(session.expiresAt).getTime() - Date.now();
  const ttlSeconds = Math.max(1, Math.min(2, Math.floor(remainingMs / 1000)));
  await cacheSet(SuperguessCacheKeys.active(roundId), session, ttlSeconds);

  return session;
}

/**
 * Fast check if a Superguess is currently active for a round
 * Checks Redis first, then DB as fallback
 */
export async function isSuperguessActive(roundId: number): Promise<boolean> {
  // Quick Redis check
  if (redis) {
    const exists = await redis.exists(SuperguessCacheKeys.active(roundId));
    if (exists) return true;
  }

  // DB fallback
  const session = await getActiveSuperguess(roundId);
  return session !== null;
}

/**
 * Check if cooldown is active for a round
 */
export async function isCooldownActive(roundId: number): Promise<{
  active: boolean;
  endsAt?: string;
}> {
  // Check Redis flag first
  if (redis) {
    const cooldownVal = await cacheGet<string>(SuperguessCacheKeys.cooldown(roundId));
    if (cooldownVal) {
      return { active: true, endsAt: cooldownVal };
    }
  }

  // DB fallback: find most recent completed session with cooldown
  const [session] = await db
    .select()
    .from(superguessSessions)
    .where(
      and(
        eq(superguessSessions.roundId, roundId),
        sql`${superguessSessions.cooldownEndsAt} > NOW()`
      )
    )
    .orderBy(desc(superguessSessions.completedAt))
    .limit(1);

  if (session?.cooldownEndsAt) {
    return {
      active: true,
      endsAt: session.cooldownEndsAt.toISOString(),
    };
  }

  return { active: false };
}

/**
 * Start a new Superguess session
 * Atomic insert using partial unique index to prevent races
 */
export async function startSuperguessSession(params: {
  roundId: number;
  fid: number;
  tier: string;
  wordAmountPaid: string;
  usdEquivalent: number;
  burnedAmount: string;
  stakingAmount: string;
  burnTxHash?: string;
  stakingTxHash?: string;
}): Promise<SuperguessSessionRow> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SUPERGUESS_DURATION_MINUTES * 60 * 1000);

  const [session] = await db
    .insert(superguessSessions)
    .values({
      roundId: params.roundId,
      fid: params.fid,
      tier: params.tier,
      wordAmountPaid: params.wordAmountPaid,
      usdEquivalent: params.usdEquivalent.toFixed(2),
      burnedAmount: params.burnedAmount,
      stakingAmount: params.stakingAmount,
      burnTxHash: params.burnTxHash,
      stakingTxHash: params.stakingTxHash,
      status: 'active',
      guessesUsed: 0,
      guessesAllowed: SUPERGUESS_MAX_GUESSES,
      startedAt: now,
      expiresAt,
    })
    .returning();

  // Cache in Redis with TTL = session duration
  const ttlSeconds = SUPERGUESS_DURATION_MINUTES * 60;
  await cacheSet(SuperguessCacheKeys.active(params.roundId), session, ttlSeconds);

  // Clear any stale cooldown
  await cacheDel(SuperguessCacheKeys.cooldown(params.roundId));

  // Invalidate state cache
  await cacheDel(SuperguessCacheKeys.state(params.roundId));

  console.log(
    `🔴 [Superguess] Session started: FID ${params.fid}, round ${params.roundId}, tier ${params.tier}, expires ${expiresAt.toISOString()}`
  );

  return session;
}

/**
 * Record a guess in an active Superguess session
 * Increments counter and invalidates cache
 */
export async function recordSuperguessGuess(
  sessionId: number,
  roundId: number
): Promise<number> {
  const [updated] = await db
    .update(superguessSessions)
    .set({
      guessesUsed: sql`${superguessSessions.guessesUsed} + 1`,
    })
    .where(eq(superguessSessions.id, sessionId))
    .returning();

  const newCount = updated.guessesUsed;

  // Invalidate caches so spectators see the update
  await Promise.all([
    cacheDel(SuperguessCacheKeys.active(roundId)),
    cacheDel(SuperguessCacheKeys.state(roundId)),
  ]);

  // Re-cache the updated session
  if (updated.status === 'active') {
    const remainingMs = new Date(updated.expiresAt).getTime() - Date.now();
    const ttl = Math.max(1, Math.min(2, Math.floor(remainingMs / 1000)));
    await cacheSet(SuperguessCacheKeys.active(roundId), updated, ttl);
  }

  console.log(
    `🔴 [Superguess] Guess ${newCount}/${updated.guessesAllowed} recorded for session ${sessionId}`
  );

  return newCount;
}

/**
 * Complete a Superguess session (won, exhausted, expired, or cancelled)
 * Sets completed_at, cooldown_ends_at, clears Redis
 */
export async function completeSuperguessSession(
  sessionId: number,
  status: Exclude<SuperguessStatus, 'active'>
): Promise<SuperguessSessionRow> {
  const now = new Date();

  // Set cooldown for non-win, non-cancel completions
  const setCooldown = status === 'exhausted' || status === 'expired';
  const cooldownEndsAt = setCooldown
    ? new Date(now.getTime() + SUPERGUESS_COOLDOWN_MINUTES * 60 * 1000)
    : null;

  const [completed] = await db
    .update(superguessSessions)
    .set({
      status,
      completedAt: now,
      cooldownEndsAt,
    })
    .where(eq(superguessSessions.id, sessionId))
    .returning();

  // Clear active cache
  await cacheDel(SuperguessCacheKeys.active(completed.roundId));
  await cacheDel(SuperguessCacheKeys.state(completed.roundId));

  // Set cooldown in Redis if applicable
  if (cooldownEndsAt) {
    const cooldownTtl = Math.max(
      1,
      Math.floor((cooldownEndsAt.getTime() - now.getTime()) / 1000)
    );
    await cacheSet(
      SuperguessCacheKeys.cooldown(completed.roundId),
      cooldownEndsAt.toISOString(),
      cooldownTtl
    );
  }

  console.log(
    `🔴 [Superguess] Session ${sessionId} completed: ${status}${cooldownEndsAt ? `, cooldown until ${cooldownEndsAt.toISOString()}` : ''}`
  );

  return completed;
}

/**
 * Check if a user has already used Superguess in this round
 * (They can use it again after cooldown, but we track for UI)
 */
export async function hasUsedSuperguessThisRound(
  roundId: number,
  fid: number
): Promise<boolean> {
  const [result] = await db
    .select({ id: superguessSessions.id })
    .from(superguessSessions)
    .where(
      and(
        eq(superguessSessions.roundId, roundId),
        eq(superguessSessions.fid, fid)
      )
    )
    .limit(1);

  return !!result;
}

/**
 * Get the current Superguess tier based on remaining word pool size
 */
export function getSuperguessCurrentTier(
  globalGuessCount: number,
  totalDictionaryWords: number
): typeof SUPERGUESS_TIERS[number] | null {
  if (globalGuessCount < SUPERGUESS_MIN_GUESS_COUNT) return null;

  const remaining = totalDictionaryWords - globalGuessCount;

  for (const tier of SUPERGUESS_TIERS) {
    if (remaining >= tier.minRemaining) {
      return tier;
    }
  }

  // Under 2000 remaining
  return SUPERGUESS_TIERS[SUPERGUESS_TIERS.length - 1];
}

/**
 * Get the username for a Superguess session's FID
 */
export async function getSuperguessUsername(fid: number): Promise<string> {
  const [user] = await db
    .select({ username: users.username })
    .from(users)
    .where(eq(users.fid, fid))
    .limit(1);

  return user?.username || `user-${fid}`;
}

// ============================================================
// Dev/Test Helpers
// ============================================================

/**
 * Create a dev/test Superguess session without payment
 * Used by admin trigger endpoint and dev mode
 */
export async function createDevSession(params: {
  roundId: number;
  fid: number;
  tier?: string;
}): Promise<SuperguessSessionRow> {
  return startSuperguessSession({
    roundId: params.roundId,
    fid: params.fid,
    tier: params.tier || 'tier_1',
    wordAmountPaid: '0',
    usdEquivalent: 0,
    burnedAmount: '0',
    stakingAmount: '0',
  });
}

/**
 * Force-cancel an active Superguess session (admin only, no cooldown)
 */
export async function forceCancel(roundId: number): Promise<boolean> {
  const session = await getActiveSuperguess(roundId);
  if (!session) return false;

  await completeSuperguessSession(session.id, 'cancelled');
  return true;
}

/**
 * Get full debug state for admin status endpoint
 */
export async function getDebugState(roundId: number): Promise<{
  featureEnabled: boolean;
  activeSession: SuperguessSessionRow | null;
  cooldown: { active: boolean; endsAt?: string };
  recentSessions: SuperguessSessionRow[];
}> {
  const [activeSession, cooldown, recentSessions] = await Promise.all([
    getActiveSuperguess(roundId),
    isCooldownActive(roundId),
    db
      .select()
      .from(superguessSessions)
      .where(eq(superguessSessions.roundId, roundId))
      .orderBy(desc(superguessSessions.createdAt))
      .limit(10),
  ]);

  return {
    featureEnabled: isSuperguessFeatureEnabled(),
    activeSession,
    cooldown,
    recentSessions,
  };
}

/**
 * Get full state for the /api/superguess/state endpoint
 * Combines active session, cooldown, and eligibility into one response
 */
export async function getSuperguessState(
  roundId: number,
  globalGuessCount: number,
  totalDictionaryWords: number
): Promise<{
  active: boolean;
  session?: {
    id: number;
    fid: number;
    username: string;
    guessesUsed: number;
    guessesAllowed: number;
    expiresAt: string;
    startedAt: string;
    tier: string;
  };
  cooldown?: {
    endsAt: string;
  };
  eligible: boolean;
}> {
  const session = await getActiveSuperguess(roundId);

  if (session) {
    const username = await getSuperguessUsername(session.fid);
    return {
      active: true,
      session: {
        id: session.id,
        fid: session.fid,
        username,
        guessesUsed: session.guessesUsed,
        guessesAllowed: session.guessesAllowed,
        expiresAt: typeof session.expiresAt === 'string' ? session.expiresAt : session.expiresAt.toISOString(),
        startedAt: typeof session.startedAt === 'string' ? session.startedAt : session.startedAt.toISOString(),
        tier: session.tier,
      },
      eligible: false,
    };
  }

  const cooldown = await isCooldownActive(roundId);
  if (cooldown.active) {
    return {
      active: false,
      cooldown: { endsAt: cooldown.endsAt! },
      eligible: false,
    };
  }

  const tier = getSuperguessCurrentTier(globalGuessCount, totalDictionaryWords);
  return {
    active: false,
    eligible: tier !== null,
  };
}
