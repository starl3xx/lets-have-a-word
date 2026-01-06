/**
 * Bonus Words Module
 * Bonus Words Feature: Query functions for bonus word status and winners
 */

import { db, roundBonusWords, users, rounds } from '../db';
import { eq, and, isNotNull, isNull, desc } from 'drizzle-orm';
import { getPlaintextAnswer } from './encryption';

/**
 * Claimed bonus word info for API responses
 */
export interface ClaimedBonusWord {
  word: string;
  wordIndex: number;
  claimedBy: {
    fid: number;
    username: string;
    pfpUrl: string;
  };
  claimedAt: string;
  txHash: string | null;
}

/**
 * Bonus word status for current round
 */
export interface BonusWordStatus {
  roundId: number;
  totalBonusWords: number;
  claimedCount: number;
  remainingCount: number;
  claimedWords: ClaimedBonusWord[];
}

/**
 * Get bonus word status for a specific round
 *
 * Returns count of claimed/remaining bonus words and details of claimed ones.
 * Words themselves are only revealed once claimed.
 */
export async function getBonusWordStatus(roundId: number): Promise<BonusWordStatus | null> {
  // Get all bonus words for this round
  const bonusWords = await db
    .select({
      id: roundBonusWords.id,
      wordIndex: roundBonusWords.wordIndex,
      word: roundBonusWords.word,
      claimedByFid: roundBonusWords.claimedByFid,
      claimedAt: roundBonusWords.claimedAt,
      txHash: roundBonusWords.txHash,
    })
    .from(roundBonusWords)
    .where(eq(roundBonusWords.roundId, roundId))
    .orderBy(roundBonusWords.wordIndex);

  if (bonusWords.length === 0) {
    // Round has no bonus words (legacy round or feature disabled)
    return null;
  }

  const totalBonusWords = bonusWords.length;
  const claimedWords = bonusWords.filter(bw => bw.claimedByFid !== null);
  const claimedCount = claimedWords.length;

  // Get user info for all claimed bonus words
  const claimedFids = claimedWords.map(bw => bw.claimedByFid!);
  const userDataMap = new Map<number, { username: string | null; pfpUrl: string }>();

  if (claimedFids.length > 0) {
    const userRecords = await db
      .select({ fid: users.fid, username: users.username })
      .from(users)
      .where(eq(users.fid, claimedFids[0])); // Drizzle doesn't have inArray in older versions

    // Query each FID individually for compatibility
    for (const fid of claimedFids) {
      const userRecord = await db
        .select({ fid: users.fid, username: users.username })
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);

      if (userRecord.length > 0) {
        userDataMap.set(fid, {
          username: userRecord[0].username,
          pfpUrl: `https://avatar.vercel.sh/${fid}`,
        });
      }
    }

    // Optionally enrich with Neynar data for profile pictures
    try {
      const { neynarClient } = await import('./farcaster');
      const neynarData = await neynarClient.fetchBulkUsers({ fids: claimedFids });
      if (neynarData.users) {
        for (const user of neynarData.users) {
          const existing = userDataMap.get(user.fid) || { username: null, pfpUrl: `https://avatar.vercel.sh/${user.fid}` };
          userDataMap.set(user.fid, {
            username: user.username || existing.username,
            pfpUrl: user.pfp_url || existing.pfpUrl,
          });
        }
      }
    } catch (error) {
      console.warn('[bonus-words] Error fetching profiles from Neynar:', error);
      // Continue with local data
    }
  }

  // Build claimed words list with user info
  const claimedWordsWithInfo: ClaimedBonusWord[] = claimedWords.map(bw => {
    const userData = userDataMap.get(bw.claimedByFid!) || {
      username: null,
      pfpUrl: `https://avatar.vercel.sh/${bw.claimedByFid}`,
    };

    return {
      word: getPlaintextAnswer(bw.word), // Decrypt the word
      wordIndex: bw.wordIndex,
      claimedBy: {
        fid: bw.claimedByFid!,
        username: userData.username || `fid:${bw.claimedByFid}`,
        pfpUrl: userData.pfpUrl,
      },
      claimedAt: bw.claimedAt?.toISOString() || new Date().toISOString(),
      txHash: bw.txHash,
    };
  });

  return {
    roundId,
    totalBonusWords,
    claimedCount,
    remainingCount: totalBonusWords - claimedCount,
    claimedWords: claimedWordsWithInfo,
  };
}

/**
 * Get bonus word status for the current active round
 */
export async function getActiveBonusWordStatus(): Promise<BonusWordStatus | null> {
  // Get active round
  const activeRound = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(
      isNull(rounds.resolvedAt),
      isNull(rounds.winnerFid),
      eq(rounds.status, 'active')
    ))
    .orderBy(desc(rounds.startedAt))
    .limit(1);

  if (activeRound.length === 0) {
    return null;
  }

  return getBonusWordStatus(activeRound[0].id);
}

/**
 * Get bonus word winners for display (simplified format)
 */
export interface BonusWordWinner {
  fid: number;
  username: string;
  pfpUrl: string;
  word: string;
  wordIndex: number;
  claimedAt: string;
  txHash: string | null;
  clanktonAmount: string; // "5000000" (5M CLANKTON)
}

/**
 * Get all bonus word winners for a round
 */
export async function getBonusWordWinners(roundId: number): Promise<BonusWordWinner[]> {
  const status = await getBonusWordStatus(roundId);

  if (!status) {
    return [];
  }

  return status.claimedWords.map(cw => ({
    fid: cw.claimedBy.fid,
    username: cw.claimedBy.username,
    pfpUrl: cw.claimedBy.pfpUrl,
    word: cw.word,
    wordIndex: cw.wordIndex,
    claimedAt: cw.claimedAt,
    txHash: cw.txHash,
    clanktonAmount: '5000000', // 5M CLANKTON per bonus word
  }));
}

/**
 * Get unclaimed bonus word count for a round
 */
export async function getUnclaimedBonusWordCount(roundId: number): Promise<number> {
  const count = await db
    .select({ id: roundBonusWords.id })
    .from(roundBonusWords)
    .where(and(
      eq(roundBonusWords.roundId, roundId),
      isNull(roundBonusWords.claimedByFid)
    ));

  return count.length;
}
