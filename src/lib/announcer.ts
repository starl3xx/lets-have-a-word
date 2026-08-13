/**
 * Farcaster Announcer Bot
 *
 * Automatically posts round and jackpot updates from @letshaveaword (FID 1477413)
 * using Neynar's agent/signer infrastructure.
 *
 * CRITICAL: This bot is COMPLETELY DISABLED in dev mode (NODE_ENV !== 'production')
 * to prevent accidental posts from non-production environments.
 *
 * Milestone 5.1: Farcaster announcer bot
 */

import { neynarClient } from './farcaster';
import { db } from '../db';
import { announcerEvents, rounds, roundPayouts, users, roundBonusWords, roundBurnWords } from '../db/schema';
import { eq, and, sql, count, isNull } from 'drizzle-orm';
import type { RoundRow, RoundPayoutRow } from '../db/schema';
import { getPlaintextAnswer } from './encryption';
import { getCurrentJackpotOnChain } from './jackpot-contract';
import { postTweet } from './twitter';
import { notifyRoundStarted, notifyRoundResolved, type NotificationResult } from './notifications';

// Configuration from environment variables
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_SIGNER_UUID = process.env.NEYNAR_SIGNER_UUID;
const ANNOUNCER_FID = process.env.ANNOUNCER_FID;
const ANNOUNCER_ENABLED = process.env.ANNOUNCER_ENABLED;
const ANNOUNCER_DEBUG_LOGS = process.env.ANNOUNCER_DEBUG_LOGS === 'true';
const NODE_ENV = process.env.NODE_ENV;

// Milestone thresholds
export const JACKPOT_MILESTONES = [0.1, 0.25, 0.5, 1.0]; // ETH

/**
 * Milestones for $WORD rounds, in USD cents.
 *
 * A token count cannot be compared against the ETH thresholds above: a $20 seed
 * is ~78,000,000 $WORD, which clears 0.1, 0.25, 0.5 AND 1.0 the instant a round
 * starts — four milestone casts fired before anyone has guessed.
 *
 * USD also travels better across a price move: the point of a milestone is that
 * the prize got meaningfully bigger, not that the token went up. These are set
 * for a $20-seeded round rather than converted from the ETH figures, whose USD
 * equivalents (~$190 to ~$1,900) no round would ever reach.
 */
export const JACKPOT_MILESTONES_USD_CENTS = [5000, 10000, 25000, 50000]; // $50 / $100 / $250 / $500
export const GUESS_MILESTONES = [1000, 2000, 3000, 4000];

// Startup validation (fail fast in production if misconfigured)
if (NODE_ENV === 'production' && ANNOUNCER_ENABLED === 'true') {
  if (!NEYNAR_API_KEY) {
    throw new Error('[announcer] FATAL: NEYNAR_API_KEY is required when ANNOUNCER_ENABLED=true in production');
  }
  if (!NEYNAR_SIGNER_UUID) {
    throw new Error('[announcer] FATAL: NEYNAR_SIGNER_UUID is required when ANNOUNCER_ENABLED=true in production');
  }
  if (!ANNOUNCER_FID) {
    throw new Error('[announcer] FATAL: ANNOUNCER_FID is required when ANNOUNCER_ENABLED=true in production');
  }
}

/**
 * Check if the announcer is active and should post casts
 *
 * CRITICAL: Returns false in any non-production environment
 */
function announcerIsActive(): boolean {
  // Hard stop in non-production - NEVER post from dev/staging
  if (NODE_ENV !== 'production') {
    if (ANNOUNCER_DEBUG_LOGS) {
      console.log('[announcer] inactive: NODE_ENV is not production');
    }
    return false;
  }

  // Check feature flag
  if (ANNOUNCER_ENABLED !== 'true') {
    if (ANNOUNCER_DEBUG_LOGS) {
      console.log('[announcer] inactive: ANNOUNCER_ENABLED is not true');
    }
    return false;
  }

  return true;
}

/**
 * Publish a cast from the announcer account
 *
 * @param text - The cast text (max 320 chars for Farcaster)
 * @param options - Optional reply hash and embeds
 * @returns The published cast data, or null if announcer is inactive
 */
export async function castFromAnnouncer(
  text: string,
  options?: {
    replyToHash?: string;
    embeds?: { url: string }[];
  }
): Promise<{ hash: string } | null> {
  if (!announcerIsActive()) {
    if (ANNOUNCER_DEBUG_LOGS) {
      console.log('[announcer] inactive (dev mode or disabled), skipping cast:', text);
    }
    return null;
  }

  try {
    // Publish cast using Neynar SDK
    // `response.cast.hash`, not `response.hash`. publishCast resolves to a
    // PostCastResponse — `{ success, cast }` — so reading .hash off the
    // response gave undefined every time. The cast itself posted, which is why
    // this went unnoticed, but everything downstream of the hash broke:
    // announcer_events.cast_hash was written as null on every row, the
    // postedAt stamp was only written when the Twitter cross-post happened to
    // succeed (`if (cast?.hash || tweet?.id)`), and the referral-win cast is
    // meant to reply to the round-resolved cast — with an undefined parent it
    // posted unthreaded instead.
    const response = await neynarClient.publishCast({
      signerUuid: NEYNAR_SIGNER_UUID!,
      text,
      embeds: options?.embeds,
      parent: options?.replyToHash,
    });

    if (ANNOUNCER_DEBUG_LOGS) {
      console.log('[announcer] cast created:', response.cast.hash);
    }

    return { hash: response.cast.hash };
  } catch (error) {
    console.error('[announcer] ERROR: Failed to publish cast:', error);
    // Don't throw - announcer failures should never break the game
    return null;
  }
}

/**
 * Parameters for recording and posting an announcer event
 */
export interface AnnouncerEventParams {
  eventType: string;
  roundId: number;
  milestoneKey?: string;
  text: string;
  replyToHash?: string;
  embeds?: { url: string }[];
}

/**
 * Record an announcer event and publish the cast (idempotent)
 *
 * This function ensures each event type/round/milestone combination is posted
 * at most once by checking the announcer_events table first.
 *
 * @param params - Event parameters
 * @returns The created event record and cast result
 */
export async function recordAndCastAnnouncerEvent(params: AnnouncerEventParams) {
  const milestoneKey = params.milestoneKey ?? 'default';

  try {
    // Check if this event has already been posted
    const existing = await db
      .select()
      .from(announcerEvents)
      .where(
        and(
          eq(announcerEvents.eventType, params.eventType),
          eq(announcerEvents.roundId, params.roundId),
          eq(announcerEvents.milestoneKey, milestoneKey)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      if (ANNOUNCER_DEBUG_LOGS) {
        console.log(
          '[announcer] event already exists, skipping:',
          params.eventType,
          params.roundId,
          milestoneKey
        );
      }
      return { created: existing[0], cast: null };
    }

    // Create the event record
    const created = await db
      .insert(announcerEvents)
      .values({
        eventType: params.eventType,
        roundId: params.roundId,
        milestoneKey,
        payload: { text: params.text },
      })
      .returning();

    // Publish the cast to Farcaster
    const cast = await castFromAnnouncer(params.text, {
      replyToHash: params.replyToHash,
      embeds: params.embeds,
    });

    // Cross-post to Twitter/X
    const tweet = await postTweet(params.text);

    // Update with cast hash and tweet ID if successful
    if (cast?.hash || tweet?.id) {
      await db
        .update(announcerEvents)
        .set({
          castHash: cast?.hash ?? null,
          postedAt: new Date(),
          payload: {
            text: params.text,
            tweetId: tweet?.id ?? null,
          },
        })
        .where(eq(announcerEvents.id, created[0].id));
    }

    return { created: created[0], cast, tweet };
  } catch (error) {
    console.error('[announcer] ERROR: Failed to record and cast event:', error);
    // Don't throw - announcer failures should never break the game
    return { created: null, cast: null, tweet: null };
  }
}

/**
 * Format ETH amount for display (remove trailing zeros)
 */
export function formatEth(eth: string | number): string {
  const num = typeof eth === 'string' ? parseFloat(eth) : eth;
  return num.toFixed(4).replace(/\.?0+$/, '');
}

/**
 * Estimate USD value from ETH amount
 */
function estimateUsd(eth: string | number): string {
  const ethUsdRate = parseFloat(process.env.ETH_USD_RATE || '3000');
  const num = typeof eth === 'string' ? parseFloat(eth) : eth;
  const usd = num * ethUsdRate;
  return usd.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * Get the round number for display (1-indexed based on round ID)
 */
function getRoundNumber(round: RoundRow): number {
  return round.id;
}

/**
 * Build the round-started announcement text and metadata.
 *
 * Shared by announceRoundStarted() and the admin re-announce endpoint so the
 * cast/notification copy lives in exactly one place.
 *
 * @param round - The round to announce
 */
export async function buildRoundStartedAnnouncement(round: RoundRow): Promise<{
  roundNumber: number;
  jackpotEth: string;
  prize: string;
  text: string;
}> {
  const roundNumber = getRoundNumber(round);

  // Read prize pool from onchain contract (source of truth)
  // getRoundPrize reads WordJackpot for a $WORD round and JackpotManagerV3
  // otherwise, and returns the amount with its unit already attached.
  const { getRoundPrize } = await import('./round-prize');
  const prize = (await getRoundPrize(round)).display;

  let jackpotEth: string;
  try {
    jackpotEth = formatEth(await getCurrentJackpotOnChain());
  } catch (err) {
    console.error('[announcer] Failed to read jackpot from contract, using database value:', err);
    jackpotEth = formatEth(round.prizePoolEth);
  }

  const text = `🔵 Round #${roundNumber} is live in @letshaveaword

Starting prize pool: ${prize} 🎯

The secret word, bonus words, and burn words are locked onchain 🔒

→ Verify fairness: letshaveaword.fun/verify?round=${roundNumber}

Happy hunting 🕵️‍♂️
letshaveaword.fun`;

  return { roundNumber, jackpotEth, prize, text };
}

/**
 * Announce that a new round has started
 *
 * @param round - The newly created round
 */
export async function announceRoundStarted(round: RoundRow) {
  const { roundNumber, jackpotEth, prize, text } = await buildRoundStartedAnnouncement(round);

  // Send push notification to mini app users (with jackpot data for template)
  const notification = await notifyRoundStarted(roundNumber, prize);

  const result = await recordAndCastAnnouncerEvent({
    eventType: 'round_started',
    roundId: round.id,
    text,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });

  return { ...result, notification };
}

/**
 * Fetch username from database by FID, with Neynar fallback
 *
 * @param fid - Farcaster ID
 * @returns Username string (with @ prefix) or null if not found
 */
async function getUsernameByFid(fid: number | null | undefined): Promise<string | null> {
  if (!fid) return null;

  try {
    // First, try local database
    const [user] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);

    if (user?.username) {
      return `@${user.username}`;
    }

    // Fallback to Neynar API
    if (neynarClient) {
      try {
        const neynarData = await neynarClient.fetchBulkUsers({ fids: [fid] });
        if (neynarData.users && neynarData.users.length > 0 && neynarData.users[0].username) {
          return `@${neynarData.users[0].username}`;
        }
      } catch (neynarError) {
        console.warn('[announcer] Neynar fallback failed for FID:', fid, neynarError);
      }
    }

    return null;
  } catch (error) {
    console.error('[announcer] Error fetching username for FID:', fid, error);
    return null;
  }
}

/**
 * Fetch usernames for multiple FIDs from database, with Neynar fallback
 *
 * @param fids - Array of Farcaster IDs
 * @returns Array of username strings (with @ prefix)
 */
async function getUsernamesByFids(fids: number[]): Promise<string[]> {
  if (fids.length === 0) return [];

  // Create a map for quick lookup, preserving order of input FIDs
  const usernameMap = new Map<number, string>();

  try {
    // First, try local database
    const userRows = await db
      .select({ fid: users.fid, username: users.username })
      .from(users)
      .where(
        fids.length === 1
          ? eq(users.fid, fids[0])
          : sql`${users.fid} IN (${sql.join(fids.map(f => sql`${f}`), sql`, `)})`
      );

    for (const row of userRows) {
      if (row.username) {
        usernameMap.set(row.fid, `@${row.username}`);
      }
    }

    // Find FIDs that weren't in the database
    const missingFids = fids.filter(fid => !usernameMap.has(fid));

    // Fallback to Neynar API for missing usernames
    if (missingFids.length > 0 && neynarClient) {
      try {
        const neynarData = await neynarClient.fetchBulkUsers({ fids: missingFids });
        if (neynarData.users) {
          for (const user of neynarData.users) {
            if (user.username) {
              usernameMap.set(user.fid, `@${user.username}`);
            }
          }
        }
      } catch (neynarError) {
        console.warn('[announcer] Neynar fallback failed for FIDs:', missingFids, neynarError);
        // Continue with @fid:XXX for these users
      }
    }

    // Return usernames in the same order as input FIDs
    return fids.map(fid => usernameMap.get(fid) || `@fid:${fid}`);
  } catch (error) {
    console.error('[announcer] Error fetching usernames for FIDs:', fids, error);
    return fids.map(fid => `@fid:${fid}`);
  }
}

/**
 * Announce that a round has been resolved
 *
 * @param round - The resolved round
 * @param payouts - Array of payout records for this round
 * @param totalGuesses - Total number of guesses in the round
 */
export async function announceRoundResolved(
  round: RoundRow,
  payouts: RoundPayoutRow[],
  totalGuesses: number
) {
  const roundNumber = getRoundNumber(round);
  const answer = getPlaintextAnswer(round.answer).toUpperCase(); // Decrypt and uppercase
  const commitHash = round.commitHash;
  const jackpotEth = formatEth(round.prizePoolEth);
  const { getRoundPrize: getResolvedPrize } = await import('./round-prize');
  const prize = (await getResolvedPrize(round)).display;

  // Shorten hash for display: first 10 chars + last 4 chars
  const shortHash = commitHash.length > 16
    ? `${commitHash.slice(0, 10)}...${commitHash.slice(-4)}`
    : commitHash;

  // Find winner payout and fetch username
  const winnerPayout = payouts.find(p => p.role === 'winner');
  const winnerUsername = await getUsernameByFid(winnerPayout?.fid);
  const winnerMention = winnerUsername || '@winner';

  // Find top 10 guessers payouts and fetch usernames
  const topTenPayouts = payouts.filter(p => p.role === 'top_guesser');
  const { formatPayoutAmount, formatPayoutTotal } = await import('./round-prize');
  const payoutCurrency: 'eth' | 'word' = round.prizeCurrency === 'word' ? 'word' : 'eth';
  const topTenPayoutText = formatPayoutTotal(topTenPayouts, payoutCurrency);

  // Get top 10 FIDs in order (sorted by payout amount desc as a proxy for volume ranking)
  //
  // Sorted in the round's own currency. amountEth is NULL on a $WORD payout, so
  // parseFloat gives NaN, every comparison returns NaN, and the comparator is
  // inconsistent — the ten names would be listed in whatever order the rows
  // arrived, silently misreporting the ranking in a public cast.
  const payoutRank = (p: { amountEth?: string | null; amountWord?: string | null }): bigint => {
    if (payoutCurrency === 'word') {
      try {
        return BigInt(p.amountWord ?? '0');
      } catch {
        return 0n;
      }
    }
    // Scale to wei so both branches compare as integers.
    return BigInt(Math.round((parseFloat(p.amountEth ?? '0') || 0) * 1e18));
  };
  const topTenFids = [...topTenPayouts]
    .sort((a, b) => {
      const diff = payoutRank(b) - payoutRank(a);
      return diff > 0n ? 1 : diff < 0n ? -1 : 0;
    })
    .map(p => p.fid)
    .filter((fid): fid is number => fid !== null);

  const topTenUsernames = await getUsernamesByFids(topTenFids);
  const topTenMentions = topTenUsernames.join(' ');

  // Find referrer payout if exists
  const referrerPayout = payouts.find(p => p.role === 'referrer');
  const referrerPayoutText = referrerPayout ? formatPayoutAmount(referrerPayout, payoutCurrency) : null;
  const referrerUsername = await getUsernameByFid(referrerPayout?.fid);

  // Build referrer line (only if referrer exists and was paid)
  let referrerLine = '';
  if (referrerPayoutText && referrerUsername) {
    referrerLine = `\n\n${winnerMention}'s referrer ${referrerUsername} earned ${referrerPayoutText} for bringing them into the game. 🫂`;
  }

  const text = `🎉 Round #${roundNumber} is complete in Let's Have A Word!

After ${totalGuesses.toLocaleString()} global guesses, ${winnerMention} found the secret word ${answer} and won the ${prize} jackpot! 🏆 Congrats!${referrerLine}

Top 10 early guessers also shared ${topTenPayoutText}:
${topTenMentions} 🙌

Provably fair:
→ Hash: ${shortHash}
→ Verify anytime: https://letshaveaword.fun/verify?round=${roundNumber}

New round starts soon 👀
letshaveaword.fun`;

  // Send push notification to mini app users
  const winnerUsernameClean = winnerUsername?.replace('@', '');
  const notification = await notifyRoundResolved(roundNumber, winnerUsernameClean, prize);

  const result = await recordAndCastAnnouncerEvent({
    eventType: 'round_resolved',
    roundId: round.id,
    text,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });

  return { ...result, notification };
}

/**
 * Check and announce jackpot milestones
 *
 * @param round - The current round
 */
/**
 * Milestone announcements for a $WORD round.
 *
 * Reads the pool from WordJackpot rather than JackpotManagerV3 — the ETH path
 * above reads the wrong contract for these rounds, and its DB fallback column
 * (prizePoolEth) is 0 on a $WORD round, so it would silently announce nothing.
 *
 * Values the pool at the round's seed-time price snapshot, matching what the UI
 * shows. A live quote would let a thin market push a round past a milestone and
 * back again, casting each time.
 */
async function checkWordJackpotMilestones(round: RoundRow, roundNumber: number) {
  const priceE18 = round.seedPriceE18 ? BigInt(round.seedPriceE18) : 0n;
  if (priceE18 <= 0n) {
    console.warn(`[announcer] Round ${roundNumber} has no seed price — skipping $WORD milestones`);
    return;
  }

  let poolWei: bigint;
  try {
    const { getWordJackpotSolvency } = await import('./word-jackpot-contract');
    poolWei = (await getWordJackpotSolvency()).poolWei;
  } catch (err) {
    console.error('[announcer] Failed to read WordJackpot pool, using database value:', err);
    try {
      poolWei = BigInt(round.prizePoolWord ?? '0');
    } catch {
      poolWei = 0n;
    }
  }
  if (poolWei <= 0n) return;

  const { usdCentsForTokens, formatWordAmount } = await import('./word-amounts');
  const poolCents = usdCentsForTokens(poolWei, priceE18);

  for (const milestoneCents of JACKPOT_MILESTONES_USD_CENTS) {
    if (poolCents < BigInt(milestoneCents)) continue;

    const milestoneUsd = (milestoneCents / 100).toFixed(0);
    const poolWord = formatWordAmount(poolWei);

    const text = milestoneCents >= 25000
      ? `🚨 Prize pool just crossed $${milestoneUsd} in Let's Have A Word!

Round #${roundNumber} is getting serious 👀 ${poolWord} $WORD on the line

One correct guess is all it takes ↓
letshaveaword.fun`
      : `🔥 Jackpot milestone in Let's Have A Word!

Round #${roundNumber} prize pool just passed $${milestoneUsd} — ${poolWord} $WORD 🎯

One secret word. One winner.
Every wrong guess narrows the field 👀

Play now ↓
letshaveaword.fun`;

    await recordAndCastAnnouncerEvent({
      eventType: 'jackpot_milestone',
      roundId: round.id,
      milestoneKey: `jackpot_usd_${milestoneCents}`,
      text,
    });
  }
}

export async function checkAndAnnounceJackpotMilestones(round: RoundRow) {
  const roundNumber = getRoundNumber(round);

  // A $WORD round is measured in USD, not in tokens — see
  // JACKPOT_MILESTONES_USD_CENTS for why comparing token counts to the ETH
  // thresholds would fire every milestone at once.
  if (round.prizeCurrency === 'word') {
    await checkWordJackpotMilestones(round, roundNumber);
    return;
  }

  // Read prize pool from onchain contract (source of truth)
  let jackpotEth: number;
  try {
    jackpotEth = parseFloat(await getCurrentJackpotOnChain());
  } catch (err) {
    console.error('[announcer] Failed to read jackpot from contract, using database value:', err);
    jackpotEth = parseFloat(round.prizePoolEth);
  }

  for (const milestone of JACKPOT_MILESTONES) {
    if (jackpotEth >= milestone) {
      const milestoneKey = `jackpot_${milestone.toFixed(2)}`;
      const milestoneEth = formatEth(milestone);
      const milestoneUsd = estimateUsd(milestone);

      // Use different template for 1.0 ETH milestone
      const text = milestone >= 1.0
        ? `🚨 Prize pool just crossed ${milestoneEth} ETH (~$${milestoneUsd}) in Let's Have A Word!

Round #${roundNumber} is getting serious 👀

One correct guess is all it takes ↓
letshaveaword.fun`
        : `🔥 Jackpot milestone in Let's Have A Word!

Round #${roundNumber} prize pool just passed ${milestoneEth} ETH (~$${milestoneUsd}) 🎯

One secret word. One winner.
Every wrong guess narrows the field 👀

Play now ↓
letshaveaword.fun`;

      await recordAndCastAnnouncerEvent({
        eventType: 'jackpot_milestone',
        roundId: round.id,
        milestoneKey,
        text,
        embeds: [{ url: 'https://letshaveaword.fun' }],
      });
    }
  }
}

/**
 * Check and announce guess count milestones
 *
 * @param round - The current round
 * @param guessCount - The current total guess count
 */
export async function checkAndAnnounceGuessMilestones(
  round: RoundRow,
  guessCount: number
) {
  const roundNumber = getRoundNumber(round);

  for (const milestone of GUESS_MILESTONES) {
    if (guessCount >= milestone) {
      const milestoneKey = `guesses_${milestone}`;

      const text = `🎯 Guess milestone in Let's Have A Word!

Round #${roundNumber} just crossed ${milestone.toLocaleString()} global guesses.

Every wrong guess removes one word from the shared global pool.
One correct guess wins the jackpot 👀

letshaveaword.fun`;

      await recordAndCastAnnouncerEvent({
        eventType: 'guess_milestone',
        roundId: round.id,
        milestoneKey,
        text,
        embeds: [{ url: 'https://letshaveaword.fun' }],
      });
    }
  }
}

/**
 * Announce a referral win
 *
 * @param round - The resolved round
 * @param referrerPayout - The referrer's payout record
 * @param resolvedCastHash - Optional hash of the round_resolved cast to reply to
 */
export async function announceReferralWin(
  round: RoundRow,
  referrerPayout: RoundPayoutRow,
  resolvedCastHash?: string
) {
  const roundNumber = getRoundNumber(round);
  const { formatPayoutAmount: fmtPayout } = await import('./round-prize');
  const referrerPayoutText = fmtPayout(
    referrerPayout,
    round.prizeCurrency === 'word' ? 'word' : 'eth'
  );

  // Fetch usernames for winner and referrer
  const [winnerUsername, referrerUsername] = await Promise.all([
    getUsernameByFid(round.winnerFid),
    getUsernameByFid(referrerPayout.fid),
  ]);

  const winnerMention = winnerUsername || '@winner';
  const referrerMention = referrerUsername || '@referrer';

  const text = `🤝 Referral win on Let's Have A Word!

In Round #${roundNumber}, ${winnerMention} hit the jackpot!

${referrerMention} earned ${referrerPayoutText} for referring them to play!

Share your link. You can win even when your friends do 👀
letshaveaword.fun`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'referral_win',
    roundId: round.id,
    text,
    replyToHash: resolvedCastHash,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });
}

/**
 * Wordmark types that should trigger announcements
 */
const ANNOUNCEABLE_WORDMARKS = ['ENCYCLOPEDIC', 'DOUBLE_W', 'BAKERS_DOZEN'] as const;

/**
 * Wordmark display info for announcements
 */
const WORDMARK_ANNOUNCEMENT_INFO: Record<string, { emoji: string; name: string; description: string }> = {
  ENCYCLOPEDIC: {
    emoji: '📚',
    name: 'Encyclopedic',
    description: 'guessed words starting with every letter A–Z',
  },
  DOUBLE_W: {
    emoji: '✌️',
    name: 'Double Dub',
    description: 'found two or more special words (bonus, burn, or secret) in a single round',
  },
  BAKERS_DOZEN: {
    emoji: '🍩',
    name: 'Baker\'s Dozen',
    description: 'played on 13 different days, each with a unique starting letter',
  },
};

/**
 * Announce a wordmark earned by a user
 *
 * Posts a congratulatory cast tagging the user who earned the wordmark.
 * Only announces for specific wordmarks: Encyclopedic, Double Dub, Baker's Dozen
 *
 * @param fid - FID of the user who earned the wordmark
 * @param wordmarkType - The type of wordmark earned
 * @param roundId - Optional round ID (used for idempotency key)
 */
export async function announceWordmarkEarned(
  fid: number,
  wordmarkType: string,
  roundId?: number
): Promise<{ cast: { hash: string } | null } | null> {
  // Only announce specific wordmarks
  if (!ANNOUNCEABLE_WORDMARKS.includes(wordmarkType as any)) {
    return null;
  }

  const info = WORDMARK_ANNOUNCEMENT_INFO[wordmarkType];
  if (!info) {
    console.warn(`[announcer] No announcement info for wordmark: ${wordmarkType}`);
    return null;
  }

  // Get username for the user
  const username = await getUsernameByFid(fid);
  if (!username) {
    console.warn(`[announcer] Could not find username for FID ${fid}, skipping wordmark announcement`);
    return null;
  }

  const text = `${username} Congratulations on earning the ${info.emoji} ${info.name} wordmark!

You ${info.description}. That's dedication 🙌

letshaveaword.fun`;

  // Use roundId for idempotency if provided, otherwise use a timestamp-based key
  const eventRoundId = roundId ?? 0;
  const milestoneKey = `wordmark_${wordmarkType}_fid_${fid}`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'wordmark_earned',
    roundId: eventRoundId,
    milestoneKey,
    text,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });
}

/**
 * Announce a bonus word found
 *
 * @param roundId - The round ID
 * @param finderFid - FID of the user who found the bonus word
 * @param word - The bonus word that was found
 */
export async function announceBonusWordFound(
  roundId: number,
  finderFid: number,
  word: string
) {
  // Get user info for the announcement (DB first, Neynar fallback)
  const username = (await getUsernameByFid(finderFid))?.replace(/^@/, '') ?? `fid:${finderFid}`;

  // Get count of remaining bonus words
  let remainingCount = 0;
  try {
    const claimedResult = await db
      .select({ count: count() })
      .from(roundBonusWords)
      .where(
        and(
          eq(roundBonusWords.roundId, roundId),
          isNull(roundBonusWords.claimedByFid)
        )
      );
    remainingCount = claimedResult[0]?.count ?? 0;
  } catch (error) {
    console.error('[announcer] Error getting remaining bonus words count:', error);
  }

  const text = `🎣 @${username} found a bonus word and won 5M $WORD!

The word was "${word.toUpperCase()}"

${remainingCount} bonus words remaining this round

Play now 👉 letshaveaword.fun`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'bonus_word_found',
    roundId,
    milestoneKey: `bonus_${word.toUpperCase()}`,
    text,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });
}

/**
 * Announce a burn word discovery via cast + tweet
 * @param roundId - The round ID
 * @param finderFid - FID of the user who found the burn word
 * @param word - The burn word that was found
 */
export async function announceBurnWordFound(
  roundId: number,
  finderFid: number,
  word: string
) {
  // Get user info for the announcement (DB first, Neynar fallback)
  const username = (await getUsernameByFid(finderFid))?.replace(/^@/, '') ?? `fid:${finderFid}`;

  // Get count of remaining burn words
  let remainingCount = 0;
  try {
    const unclaimedResult = await db
      .select({ count: count() })
      .from(roundBurnWords)
      .where(
        and(
          eq(roundBurnWords.roundId, roundId),
          isNull(roundBurnWords.finderFid)
        )
      );
    remainingCount = unclaimedResult[0]?.count ?? 0;
  } catch (error) {
    console.error('[announcer] Error getting remaining burn words count:', error);
  }

  const text = `🔥 @${username} found a burn word — 5M $WORD permanently destroyed!

The word was "${word.toUpperCase()}"

${remainingCount} burn words remaining this round

Play now 👉 letshaveaword.fun`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'burn_word_found',
    roundId,
    milestoneKey: `burn_${word.toUpperCase()}`,
    text,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });
}

/**
 * Announce a Superguess started via cast + tweet
 * Milestone 15: Superguess mechanic
 */
export async function announceSuperguessStarted(
  roundId: number,
  guesserFid: number
) {
  const username = (await getUsernameByFid(guesserFid))?.replace(/^@/, '') ?? `fid:${guesserFid}`;

  const text = `🔴 SUPERGUESS activated — @${username} has 25 guesses and 10 minutes. All eyes on them. 👀

Watch live 👉 letshaveaword.fun`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'superguess_started',
    roundId,
    milestoneKey: `superguess_${guesserFid}`,
    text,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });
}

/**
 * Announce a Superguess result via cast + tweet
 * Milestone 15: Superguess mechanic
 *
 * Won = found the secret word (only case for "won" announcement)
 * Failed = includes any bonus/burn words found during the attempt
 */
export async function announceSuperguessResult(
  roundId: number,
  guesserFid: number,
  won: boolean,
  guessesUsed: number,
  sessionStartedAt?: Date | string
) {
  const username = (await getUsernameByFid(guesserFid))?.replace(/^@/, '') ?? `fid:${guesserFid}`;

  if (won) {
    const text = `🔴 SUPERGUESS WON! @${username} found the secret word in ${guessesUsed} guesses! 🎉

What a play! 👉 letshaveaword.fun`;

    return await recordAndCastAnnouncerEvent({
      eventType: 'superguess_result',
      roundId,
      milestoneKey: `superguess_result_${guesserFid}`,
      text,
      embeds: [{ url: 'https://letshaveaword.fun' }],
    });
  }

  // Failed — check for bonus/burn words found during the Superguess window only
  let bonusCount = 0;
  let burnCount = 0;
  try {
    const bonusConditions = [
      eq(roundBonusWords.roundId, roundId),
      eq(roundBonusWords.claimedByFid, guesserFid),
    ];
    const burnConditions = [
      eq(roundBurnWords.roundId, roundId),
      eq(roundBurnWords.finderFid, guesserFid),
    ];
    // Only count finds during the Superguess window (not before purchase)
    if (sessionStartedAt) {
      const startTime = typeof sessionStartedAt === 'string' ? sessionStartedAt : sessionStartedAt.toISOString();
      bonusConditions.push(sql`${roundBonusWords.claimedAt} >= ${startTime}::timestamp`);
      burnConditions.push(sql`${roundBurnWords.foundAt} >= ${startTime}::timestamp`);
    }
    const [bonusResult, burnResult] = await Promise.all([
      db
        .select({ count: count() })
        .from(roundBonusWords)
        .where(and(...bonusConditions)),
      db
        .select({ count: count() })
        .from(roundBurnWords)
        .where(and(...burnConditions)),
    ]);
    bonusCount = bonusResult[0]?.count ?? 0;
    burnCount = burnResult[0]?.count ?? 0;
  } catch (err) {
    console.error('[announcer] Failed to get bonus/burn counts for Superguess result:', err);
  }

  let extras = '';
  if (bonusCount > 0 || burnCount > 0) {
    const parts: string[] = [];
    if (bonusCount > 0) parts.push(`${bonusCount} bonus word${bonusCount > 1 ? 's' : ''}`);
    if (burnCount > 0) parts.push(`${burnCount} burn word${burnCount > 1 ? 's' : ''}`);
    extras = `\n\nBut they did find ${parts.join(' and ')} along the way 🕵️‍♂️`;
  }

  const text = `🔴 Superguess over — @${username} used ${guessesUsed}/25 guesses but didn\u2019t find the secret word.${extras}

Normal play resumes now! 👉 letshaveaword.fun`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'superguess_result',
    roundId,
    milestoneKey: `superguess_result_${guesserFid}`,
    text,
    embeds: [{ url: 'https://letshaveaword.fun' }],
  });
}
