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
import { announcerEvents, rounds, roundPayouts, users } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import type { RoundRow, RoundPayoutRow } from '../db/schema';
import { getPlaintextAnswer } from './encryption';

// Configuration from environment variables
const NEYNAR_API_KEY = process.env.NEYNAR_API_KEY;
const NEYNAR_SIGNER_UUID = process.env.NEYNAR_SIGNER_UUID;
const ANNOUNCER_FID = process.env.ANNOUNCER_FID;
const ANNOUNCER_ENABLED = process.env.ANNOUNCER_ENABLED;
const ANNOUNCER_DEBUG_LOGS = process.env.ANNOUNCER_DEBUG_LOGS === 'true';
const NODE_ENV = process.env.NODE_ENV;

// Milestone thresholds
export const JACKPOT_MILESTONES = [0.1, 0.25, 0.5, 1.0]; // ETH
export const GUESS_MILESTONES = [100, 500, 1000, 5000, 10000];

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
    const cast = await neynarClient.publishCast({
      signerUuid: NEYNAR_SIGNER_UUID!,
      text,
      embeds: options?.embeds,
      parent: options?.replyToHash,
    });

    if (ANNOUNCER_DEBUG_LOGS) {
      console.log('[announcer] cast created:', cast.hash);
    }

    return { hash: cast.hash };
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

    // Publish the cast
    const cast = await castFromAnnouncer(params.text, {
      replyToHash: params.replyToHash,
      embeds: params.embeds,
    });

    // Update with cast hash if successful
    if (cast?.hash) {
      await db
        .update(announcerEvents)
        .set({
          castHash: cast.hash,
          postedAt: new Date(),
        })
        .where(eq(announcerEvents.id, created[0].id));
    }

    return { created: created[0], cast };
  } catch (error) {
    console.error('[announcer] ERROR: Failed to record and cast event:', error);
    // Don't throw - announcer failures should never break the game
    return { created: null, cast: null };
  }
}

/**
 * Format ETH amount for display (remove trailing zeros)
 */
function formatEth(eth: string | number): string {
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
 * Announce that a new round has started
 *
 * @param round - The newly created round
 */
export async function announceRoundStarted(round: RoundRow) {
  const roundNumber = getRoundNumber(round);
  const jackpotEth = formatEth(round.prizePoolEth);
  const commitHash = round.commitHash;
  // Shorten hash for display: first 10 chars + last 4 chars
  const shortHash = commitHash.length > 16
    ? `${commitHash.slice(0, 10)}...${commitHash.slice(-4)}`
    : commitHash;

  const text = `🔵 Round #${roundNumber} is live in @letshaveaword

Starting prize pool: ${jackpotEth} ETH 🎯

The secret word is locked onchain 🔒

→ Hash: ${shortHash}
→ Verify anytime: https://www.letshaveaword.fun/verify?round=${roundNumber}

Happy hunting 🕵️‍♂️
https://www.letshaveaword.fun`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'round_started',
    roundId: round.id,
    text,
  });
}

/**
 * Fetch username from database by FID
 *
 * @param fid - Farcaster ID
 * @returns Username string (with @ prefix) or null if not found
 */
async function getUsernameByFid(fid: number | null | undefined): Promise<string | null> {
  if (!fid) return null;

  try {
    const [user] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.fid, fid))
      .limit(1);

    if (user?.username) {
      return `@${user.username}`;
    }
    return null;
  } catch (error) {
    console.error('[announcer] Error fetching username for FID:', fid, error);
    return null;
  }
}

/**
 * Fetch usernames for multiple FIDs from database
 *
 * @param fids - Array of Farcaster IDs
 * @returns Array of username strings (with @ prefix)
 */
async function getUsernamesByFids(fids: number[]): Promise<string[]> {
  if (fids.length === 0) return [];

  try {
    const userRows = await db
      .select({ fid: users.fid, username: users.username })
      .from(users)
      .where(
        fids.length === 1
          ? eq(users.fid, fids[0])
          : sql`${users.fid} IN (${sql.join(fids.map(f => sql`${f}`), sql`, `)})`
      );

    // Create a map for quick lookup, preserving order of input FIDs
    const usernameMap = new Map<number, string>();
    for (const row of userRows) {
      if (row.username) {
        usernameMap.set(row.fid, `@${row.username}`);
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
  const answerHash = round.commitHash;
  const salt = round.salt;
  const jackpotEth = formatEth(round.prizePoolEth);

  // Find winner payout and fetch username
  const winnerPayout = payouts.find(p => p.role === 'winner');
  const winnerUsername = await getUsernameByFid(winnerPayout?.fid);
  const winnerMention = winnerUsername || '@winner';

  // Find top 10 guessers payouts and fetch usernames
  const topTenPayouts = payouts.filter(p => p.role === 'top_guesser');
  const topTenTotal = topTenPayouts.reduce((sum, p) => sum + parseFloat(p.amountEth), 0);
  const topTenPayoutEth = formatEth(topTenTotal);

  // Get top 10 FIDs in order (sorted by payout amount desc as a proxy for volume ranking)
  const topTenFids = topTenPayouts
    .sort((a, b) => parseFloat(b.amountEth) - parseFloat(a.amountEth))
    .map(p => p.fid)
    .filter((fid): fid is number => fid !== null);

  const topTenUsernames = await getUsernamesByFids(topTenFids);
  const topTenMentions = topTenUsernames.join(' ');

  // Find referrer payout if exists
  const referrerPayout = payouts.find(p => p.role === 'referrer');
  const referrerPayoutEth = referrerPayout ? formatEth(referrerPayout.amountEth) : null;
  const referrerUsername = await getUsernameByFid(referrerPayout?.fid);

  // Build referrer line (only if referrer exists and was paid)
  let referrerLine = '';
  if (referrerPayoutEth && referrerUsername) {
    referrerLine = `\n\n${winnerMention}'s referrer ${referrerUsername} earned ${referrerPayoutEth} ETH for bringing them into the game. 🫂`;
  }

  const text = `🎉 Round #${roundNumber} is over on Let's Have A Word!

After ${totalGuesses.toLocaleString()} global guesses, ${winnerMention} found the secret word ${answer} and won the ${jackpotEth} ETH jackpot! 🏆 Congrats!${referrerLine}

This round's top 10 guessers by volume also take home a share of ${topTenPayoutEth} ETH: ${topTenMentions} 🙌

Secret word commit–reveal:
→ Hash: ${answerHash}
→ Salt: ${salt}

Anyone can recompute hash(answer + salt) and confirm it matches the onchain commitment.

New round starts soon! One word, one jackpot. 💰`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'round_resolved',
    roundId: round.id,
    text,
  });
}

/**
 * Check and announce jackpot milestones
 *
 * @param round - The current round
 */
export async function checkAndAnnounceJackpotMilestones(round: RoundRow) {
  const jackpotEth = parseFloat(round.prizePoolEth);
  const roundNumber = getRoundNumber(round);

  for (const milestone of JACKPOT_MILESTONES) {
    if (jackpotEth >= milestone) {
      const milestoneKey = `jackpot_${milestone.toFixed(2)}`;
      const milestoneEth = formatEth(milestone);
      const milestoneUsd = estimateUsd(milestone);

      const text = `💰 Jackpot milestone on Let's Have A Word!

Round #${roundNumber} prize pool just passed ${milestoneEth} ETH (${milestoneUsd} USD est).

One player will hit the secret word and take it all. Every wrong guess helps everyone else.

Play now in the Farcaster mini app.`;

      await recordAndCastAnnouncerEvent({
        eventType: 'jackpot_milestone',
        roundId: round.id,
        milestoneKey,
        text,
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

      const text = `🎯 Guess milestone on Let's Have A Word!

Round #${roundNumber} just crossed ${milestone.toLocaleString()} total guesses.

Every wrong guess eliminates one more word from the global pool. One correct guess wins the jackpot.

Jump in via the Farcaster mini app.`;

      await recordAndCastAnnouncerEvent({
        eventType: 'guess_milestone',
        roundId: round.id,
        milestoneKey,
        text,
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
  const referrerPayoutEth = formatEth(referrerPayout.amountEth);

  const text = `🤝 Referral win on Let's Have A Word!

In Round #${roundNumber}, the jackpot winner came in through a referral.

Their referrer earned ${referrerPayoutEth} ETH just for inviting a friend to play.

Play daily, share your link, and you might win even when your friends do.`;

  return await recordAndCastAnnouncerEvent({
    eventType: 'referral_win',
    roundId: round.id,
    text,
    replyToHash: resolvedCastHash,
  });
}
