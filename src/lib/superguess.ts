/**
 * Superguess — Core State Management
 * Milestone 15: High-stakes late-game mechanic
 *
 * After guess #850, a player pays ETH for an exclusive 25-guess, 10-minute
 * window. All other players are blocked and watch as spectators. 80% of the
 * payment is credited to the round's $WORD prize pool on the same terms as a
 * guess pack; 20% accumulates as treasury revenue. (The original $WORD-paid
 * 50% burn / 50% staking split is legacy — see purchase.ts.)
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
import { usdCentsForTokens } from './word-amounts';

// ============================================================
// Configuration & Constants
// ============================================================

/** Superguess window duration in minutes */
export const SUPERGUESS_DURATION_MINUTES = 10;

/** No cooldown — play resumes immediately after Superguess ends */

/** Maximum guesses per Superguess session */
export const SUPERGUESS_MAX_GUESSES = 25;

/** Minimum global guess count before Superguess is available */
export const SUPERGUESS_MIN_GUESS_COUNT = 850;

/**
 * LEGACY pricing tiers based on remaining words in pool.
 * Pool size = total_dictionary_words - global_guess_count
 *
 * On a $WORD round the price is half the live pool (see getSuperguessQuote);
 * this ladder remains only as the fallback for non-$WORD rounds and for a
 * $WORD round with no usable price basis. Fixed USD tiers were retired because
 * they cannot track the pool: round 34 quoted $90 against a $35 pool, where
 * even a guaranteed win (80% of pool + 64% of your own payment back through
 * the pool credit) returns $85.60.
 */
export const SUPERGUESS_TIERS = [
  { id: 'tier_1', minRemaining: 3200, usdPrice: 20 },
  { id: 'tier_2', minRemaining: 2600, usdPrice: 40 },
  { id: 'tier_3', minRemaining: 2000, usdPrice: 60 },
  { id: 'tier_4', minRemaining: 0, usdPrice: 90 },
] as const;

export type SuperguessTierId = typeof SUPERGUESS_TIERS[number]['id'];

/**
 * Pool-fraction pricing ($WORD rounds): half the pool, floored.
 *
 * Half, because the buyer's rational-entry point then depends only on the
 * remaining-word count, never on pool size: a win pays 80% of (pool + 80% of
 * the payment), so at half the pool the purchase breaks even at ~45% win
 * probability regardless of whether the pool is $40 or $400. A fixed-USD
 * price cannot do that — too high it is a donation (the $90/$35 case), too
 * low it goes +EV on carry-inflated pools and snipers drain the other
 * players' pot.
 *
 * The floor prices the blocking externality (10 minutes of everyone else's
 * round) when the pool is at its smallest; one-per-round already caps how
 * often that can happen.
 */
export const SUPERGUESS_POOL_FRACTION_BPS = 5000n;
export const SUPERGUESS_MIN_PRICE_USD_CENTS = 1000n; // $10.00

/** Pure pricing rule, in cents: max(floor, pool × fraction). */
export function superguessPriceUsdCents(poolUsdCents: bigint): bigint {
  const priced = (poolUsdCents * SUPERGUESS_POOL_FRACTION_BPS) / 10_000n;
  return priced > SUPERGUESS_MIN_PRICE_USD_CENTS
    ? priced
    : SUPERGUESS_MIN_PRICE_USD_CENTS;
}

export interface SuperguessQuote {
  id: 'pool_half' | SuperguessTierId;
  usdPrice: number;
}

/**
 * The current Superguess price.
 *
 * On a $WORD round: half the pool's USD value, on exactly the same basis as
 * the pool figure the player is looking at (live cached $WORD price when
 * warm, the round's frozen seed snapshot otherwise — the wheel.ts pattern),
 * so the quote is visibly half of the displayed number. Whole dollars.
 *
 * Anywhere that basis is missing (non-$WORD round, no price snapshot), the
 * legacy fixed-USD ladder answers instead — era-gating, not dead code.
 *
 * The round object must carry prizeCurrency, prizePoolWord and seedPriceE18:
 * pass the row getActiveRound() returns, never a hand-rebuilt subset.
 */
export async function getSuperguessQuote(
  round: {
    prizeCurrency?: string | null;
    prizePoolWord?: string | null;
    seedPriceE18?: string | null;
  } | null,
  globalGuessCount: number,
  totalDictionaryWords: number
): Promise<SuperguessQuote | null> {
  if (globalGuessCount < SUPERGUESS_MIN_GUESS_COUNT) return null;

  // A $WORD round whose object lacks the pool column is a rebuilt subset
  // (the hand-written-field-list hazard — the schema defaults the real
  // column to '0', so undefined means dropped, not empty). Quoting the $10
  // floor against a real pool would be a silent 95% discount; the loud
  // ladder is the safer wrong answer.
  if (round?.prizeCurrency === 'word' && round.prizePoolWord != null) {
    const snapshotE18 = round.seedPriceE18 ? BigInt(round.seedPriceE18) : 0n;
    let priceE18 = snapshotE18;
    try {
      const { getCachedWordPriceUsd } = await import('./word-oracle');
      const { usdPriceToE18 } = await import('./word-amounts');
      const livePriceUsd = await getCachedWordPriceUsd();
      if (livePriceUsd && livePriceUsd > 0) {
        let liveE18 = usdPriceToE18(livePriceUsd);
        // Junk-low clamp: this quote SELLS at the price the oracle names,
        // and the cached feed's first source has no cross-check — a 10x-low
        // print would fire-sale the Superguess against the real pool for up
        // to 30 minutes of cache TTL. Floor the basis at half the round's
        // seed snapshot: a genuine 50% drawdown still halves the quote, a
        // junk print is bounded to a 2x discount. Junk-HIGH needs no clamp —
        // an overpriced quote just doesn't sell, and keep-min pinning stops
        // it overcharging anyone.
        if (snapshotE18 > 0n && liveE18 < snapshotE18 / 2n) {
          liveE18 = snapshotE18 / 2n;
        }
        priceE18 = liveE18;
      }
    } catch {
      // The frozen seed snapshot stands.
    }

    if (priceE18 > 0n) {
      const poolWei = BigInt(round.prizePoolWord);
      const priceCents = superguessPriceUsdCents(
        usdCentsForTokens(poolWei, priceE18)
      );
      return {
        id: 'pool_half',
        usdPrice: Math.max(10, Math.round(Number(priceCents) / 100)),
      };
    }
  }

  const tier = getSuperguessCurrentTier(globalGuessCount, totalDictionaryWords);
  return tier ? { id: tier.id, usdPrice: tier.usdPrice } : null;
}

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
  /** State endpoint cache (2s TTL, invalidated on each guess) */
  state: (roundId: number) => `${CACHE_PREFIX}superguess:state:${roundId}`,
  /** Guess log (Redis list, appended on each guess) */
  guessLog: (roundId: number) => `${CACHE_PREFIX}superguess:guesslog:${roundId}`,
  /**
   * The GLOBAL "has anyone used Superguess this round" boolean. Deliberately
   * no fid in the key: the per-fid variant of hasUsedSuperguessThisRound
   * answers a different question and must never share an entry with the
   * global one.
   */
  used: (roundId: number) => `${CACHE_PREFIX}superguess:used:${roundId}`,
  /** Lowest USD quote served recently — see pinSuperguessQuote. */
  quotePin: (roundId: number) => `${CACHE_PREFIX}superguess:quotepin:${roundId}`,
};

/** TTL for the global used-this-round boolean (seconds). */
const SUPERGUESS_USED_TTL = 10;

/**
 * How long a served quote stays honored (seconds). Sized to a wallet flow:
 * open modal, read, sign, confirm.
 */
const SUPERGUESS_QUOTE_PIN_TTL_S = 300;

/**
 * Remember the LOWEST quote served in the last few minutes, per round.
 *
 * Why: the pool only grows mid-round (every pack purchase credits it
 * immediately), so a pool-linked price can rise between the quote a buyer
 * signed against and the recompute at confirm time. Without the pin, that
 * honest payment lands under the validation floor AFTER the ETH is onchain —
 * the exact stuck-payment failure the 90% floor exists to prevent.
 *
 * Per-round rather than per-buyer because /api/superguess/status is
 * unauthenticated and only one Superguess can ever be bought per round. The
 * cost of keep-min is bounded: at most a few minutes of pool growth of
 * discount, and 80% of whatever is actually paid still credits the pool.
 * Best-effort: a cache outage just means validation uses the live price.
 */
export async function pinSuperguessQuote(
  roundId: number,
  usdPrice: number
): Promise<void> {
  const key = SuperguessCacheKeys.quotePin(roundId);
  try {
    // Upstash can round-trip numbers as strings in this deployment; coerce.
    const existing = await cacheGet<number | string>(key);
    const existingNum = existing == null ? NaN : Number(existing);
    if (Number.isFinite(existingNum) && existingNum > 0 && existingNum <= usdPrice) {
      return;
    }
    await cacheSet(key, usdPrice, SUPERGUESS_QUOTE_PIN_TTL_S);
  } catch {
    // Best-effort only.
  }
}

/** The pinned quote for a round, or null if none is fresh. */
export async function getPinnedSuperguessQuote(
  roundId: number
): Promise<number | null> {
  try {
    const cached = await cacheGet<number | string>(
      SuperguessCacheKeys.quotePin(roundId)
    );
    const n = cached == null ? NaN : Number(cached);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

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
 * Delegates to getActiveSuperguess which handles lazy expiry
 */
export async function isSuperguessActive(roundId: number): Promise<boolean> {
  const session = await getActiveSuperguess(roundId);
  return session !== null;
}

/**
 * Start a new Superguess session
 * Atomic insert using partial unique index to prevent races
 */
export async function startSuperguessSession(params: {
  roundId: number;
  fid: number;
  tier: string;
  usdEquivalent: number;
  /** 'eth' for anything bought now; 'word' exists only for legacy rows. */
  currency?: 'eth' | 'word';
  /** wei, when currency is 'eth'. */
  ethAmountPaid?: string;
  /**
   * The payment that bought this session. Recorded so one payment grants
   * exactly one session — its absence was the replay hole.
   */
  txHash?: string | null;
  logIndex?: number | null;
  wordAmountPaid?: string;
  burnedAmount?: string;
  stakingAmount?: string;
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
      currency: params.currency ?? 'eth',
      ethAmountPaid: params.ethAmountPaid,
      txHash: params.txHash ?? undefined,
      logIndex: params.logIndex ?? undefined,
      wordAmountPaid: params.wordAmountPaid,
      usdEquivalent: params.usdEquivalent.toFixed(2),
      // Zero rather than null, and true rather than a placeholder: an ETH
      // purchase burns no $WORD and sends none to staking.
      burnedAmount: params.burnedAmount ?? '0',
      stakingAmount: params.stakingAmount ?? '0',
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


  // Invalidate state cache, and the global used-this-round boolean it just
  // flipped — spectator polling is 3s, so waiting out a TTL here would show
  // a buyable Superguess that no longer exists.
  await cacheDel(SuperguessCacheKeys.state(params.roundId));
  await cacheDel(SuperguessCacheKeys.used(params.roundId)).catch(() => {});

  console.log(
    `🔴 [Superguess] Session started: FID ${params.fid}, round ${params.roundId}, tier ${params.tier}, expires ${expiresAt.toISOString()}`
  );

  return session;
}

/**
 * Record a guess in an active Superguess session
 * Increments counter and invalidates cache
 */
export interface SuperguessGuessLogEntry {
  word: string;
  result: 'incorrect' | 'correct' | 'bonus_word' | 'burn_word' | 'already_guessed';
  timestamp: string;
}

/**
 * Record a guess in an active Superguess session
 * Increments counter, appends to guess log in Redis, invalidates cache
 */
export async function recordSuperguessGuess(
  sessionId: number,
  roundId: number,
  word: string,
  result: SuperguessGuessLogEntry['result']
): Promise<number> {
  const updateResult = await db
    .update(superguessSessions)
    .set({
      guessesUsed: sql`${superguessSessions.guessesUsed} + 1`,
    })
    .where(and(
      eq(superguessSessions.id, sessionId),
      eq(superguessSessions.status, 'active')
    ))
    .returning();

  // If session already completed (race with exhaustion/expiry), bail out
  if (updateResult.length === 0) {
    console.log(`🔴 [Superguess] Session ${sessionId} already completed, skipping guess record`);
    return -1;
  }

  const updated = updateResult[0];
  const newCount = updated.guessesUsed;

  // Append to guess log in Redis (spectators poll this)
  const logEntry: SuperguessGuessLogEntry = {
    word,
    result,
    timestamp: new Date().toISOString(),
  };

  if (redis) {
    const logKey = SuperguessCacheKeys.guessLog(roundId);
    try {
      await redis.rpush(logKey, JSON.stringify(logEntry));
      // Set TTL to match session (in case it doesn't exist yet)
      const remainingMs = new Date(updated.expiresAt).getTime() - Date.now();
      if (remainingMs > 0) {
        await redis.expire(logKey, Math.ceil(remainingMs / 1000) + 60);
      }
    } catch (err) {
      console.error('[Superguess] Failed to append guess log:', err);
    }
  }

  // Auto-complete if all guesses used (handles bonus/burn word edge case)
  // Skip if result is 'correct' — the caller handles win completion separately
  const shouldExhaust = newCount >= updated.guessesAllowed && updated.status === 'active' && result !== 'correct';

  if (shouldExhaust) {
    await completeSuperguessSession(sessionId, 'exhausted');
    console.log(`🔴 [Superguess] Session ${sessionId} auto-exhausted after ${newCount} guesses`);
  } else {
    // Only invalidate+re-cache if session is still active (not just exhausted)
    await Promise.all([
      cacheDel(SuperguessCacheKeys.active(roundId)),
      cacheDel(SuperguessCacheKeys.state(roundId)),
    ]);
    if (updated.status === 'active') {
      const remainingMs = new Date(updated.expiresAt).getTime() - Date.now();
      const ttl = Math.max(1, Math.min(2, Math.floor(remainingMs / 1000)));
      await cacheSet(SuperguessCacheKeys.active(roundId), updated, ttl);
    }
  }

  console.log(
    `🔴 [Superguess] Guess ${newCount}/${updated.guessesAllowed} "${word}" (${result}) for session ${sessionId}`
  );

  return newCount;
}

/**
 * Get the guess log for a Superguess session from Redis
 */
export async function getGuessLog(roundId: number): Promise<SuperguessGuessLogEntry[]> {
  if (!redis) return [];

  try {
    const logKey = SuperguessCacheKeys.guessLog(roundId);
    const entries = await redis.lrange(logKey, 0, -1);
    return entries.map((e: string) => {
      if (typeof e === 'string') return JSON.parse(e);
      return e as unknown as SuperguessGuessLogEntry;
    });
  } catch (err) {
    console.error('[Superguess] Failed to read guess log:', err);
    return [];
  }
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

  // Only transition from active → terminal (prevents overwriting terminal states)
  const result = await db
    .update(superguessSessions)
    .set({
      status,
      completedAt: now,
    })
    .where(and(
      eq(superguessSessions.id, sessionId),
      eq(superguessSessions.status, 'active')
    ))
    .returning();

  // If no rows updated, session was already completed by another caller
  if (result.length === 0) {
    console.log(`🔴 [Superguess] Session ${sessionId} already completed, skipping ${status}`);
    const [existing] = await db
      .select()
      .from(superguessSessions)
      .where(eq(superguessSessions.id, sessionId))
      .limit(1);
    return existing;
  }

  const completed = result[0];

  // Clear active/state caches — play resumes immediately
  // Keep guess log for 30s so spectators can poll the final guess before it's gone
  // An admin CANCEL also flips the global used-this-round boolean back to
  // false (cancels don't count), so its cache entry must go with it.
  await Promise.all([
    cacheDel(SuperguessCacheKeys.active(completed.roundId)),
    cacheDel(SuperguessCacheKeys.state(completed.roundId)),
    ...(status === 'cancelled'
      ? [
          cacheDel(SuperguessCacheKeys.guessLog(completed.roundId)),
          cacheDel(SuperguessCacheKeys.used(completed.roundId)),
        ]
      : redis ? [redis.expire(SuperguessCacheKeys.guessLog(completed.roundId), 30)] : []),
  ]);

  console.log(
    `🔴 [Superguess] Session ${sessionId} completed: ${status}`
  );

  // Announce the result (fire-and-forget)
  if (status !== 'cancelled') {
    import('./announcer').then(({ announceSuperguessResult }) => {
      announceSuperguessResult(
        completed.roundId,
        completed.fid,
        status === 'won',
        completed.guessesUsed,
        completed.startedAt
      ).catch(err => {
        console.error('[Superguess] Failed to announce result:', err);
      });
    }).catch(() => {});
  }

  return completed;
}

/**
 * Check if Superguess has already been used this round (by any player)
 * One Superguess per round total.
 * Optional fid param checks if a specific player used it (for UI messaging).
 */
export async function hasUsedSuperguessThisRound(
  roundId: number,
  fid?: number
): Promise<boolean> {
  const conditions = [
    eq(superguessSessions.roundId, roundId),
    sql`${superguessSessions.status} != 'cancelled'`, // Admin cancels don't count
  ];
  if (fid) conditions.push(eq(superguessSessions.fid, fid));

  const [result] = await db
    .select({ id: superguessSessions.id })
    .from(superguessSessions)
    .where(and(...conditions))
    .limit(1);

  return !!result;
}

/**
 * The GLOBAL used-this-round boolean, Redis-cached for 10 seconds — for the
 * round-state DISPLAY path only, which ran the query serially on every 15s
 * poll from every connected client for an answer that flips once per round.
 *
 * The cache is OPT-IN by being a separate function on purpose: the
 * uncached hasUsedSuperguessThisRound above stays what every money point
 * calls (superguess purchase included — money points read uncached, always).
 * The two flip points (session creation, admin cancel) invalidate the
 * entry, so the TTL only covers the no-Redis and racing cases; a stale
 * `false` briefly shows a CTA that the purchase endpoint still rejects
 * with its own uncached checks.
 */
export async function hasUsedSuperguessThisRoundCached(roundId: number): Promise<boolean> {
  try {
    const cached = await cacheGet<boolean | string>(SuperguessCacheKeys.used(roundId));
    if (typeof cached === 'boolean') return cached;
    // Upstash can round-trip primitives as strings in this deployment
    // (commit 0a6299f); accept both spellings rather than silently missing
    // on every request.
    if (cached === 'true') return true;
    if (cached === 'false') return false;
  } catch {
    // Cache unavailable — fall through to the query.
  }

  const used = await hasUsedSuperguessThisRound(roundId);
  await cacheSet(SuperguessCacheKeys.used(roundId), used, SUPERGUESS_USED_TTL).catch(() => {});
  return used;
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
  recentSessions: SuperguessSessionRow[];
}> {
  const [activeSession, recentSessions] = await Promise.all([
    getActiveSuperguess(roundId),
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
  guessLog?: SuperguessGuessLogEntry[];
  eligible: boolean;
}> {
  const session = await getActiveSuperguess(roundId);

  if (session) {
    const [username, guessLog] = await Promise.all([
      getSuperguessUsername(session.fid),
      getGuessLog(roundId),
    ]);
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
      guessLog,
      eligible: false,
    };
  }

  const tier = getSuperguessCurrentTier(globalGuessCount, totalDictionaryWords);
  const alreadyUsed = await hasUsedSuperguessThisRound(roundId);
  return {
    active: false,
    eligible: tier !== null && !alreadyUsed,
  };
}
