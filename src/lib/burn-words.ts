/**
 * Burn Words System
 * Milestone 14: 5 hidden burn words per round
 *
 * Discovery permanently destroys $WORD supply (5M per word).
 * The finder gets XP and recognition but NO token reward.
 *
 * Pattern mirrors bonus word system exactly:
 * - Selection at round creation
 * - Encrypted storage
 * - Detection in guess flow
 * - Onchain burn execution
 */

import { db } from '../db';
import { roundBurnWords, roundBonusWords, wordRewards, guesses, users, userBadges } from '../db/schema';
import type { RoundBurnWordRow } from '../db/schema';
import type { SubmitGuessResult } from '../types';
import { eq, and, count, isNull, isNotNull, inArray } from 'drizzle-orm';
import { encryptAndPack, getPlaintextAnswer } from './encryption';
import { hasWordTokenBonus } from './word-token';
import { selectBonusWords } from './word-lists';
import { BURN_WORD_AMOUNT, BURN_WORD_AMOUNT_DISPLAY, BURN_WORDS_PER_ROUND } from '../../config/economy';
import { logXpEvent } from './xp';
import { isDevModeEnabled } from './devGameState';

/**
 * Select burn words for a round
 * Picks BURN_WORDS_PER_ROUND (5) from the FULL word list (same pool as bonus words),
 * excluding the answer and any bonus words already selected.
 *
 * @param excludeWords - Words to exclude (answer + bonus words)
 * @returns Array of selected burn words
 */
export function selectBurnWords(excludeWords: string[] = []): string[] {
  return selectBonusWords(BURN_WORDS_PER_ROUND, excludeWords);
}

/**
 * Store burn words for a round in the database
 * Called after word selection and commitment generation
 *
 * @param roundId - The round to store burn words for
 * @param burnWords - The selected burn words
 * @param salts - The bytes32 salts for each word (from round commitment)
 */
export async function storeBurnWords(
  roundId: number,
  burnWords: string[],
  salts: string[]
): Promise<void> {
  for (let i = 0; i < burnWords.length; i++) {
    await db.insert(roundBurnWords).values({
      roundId,
      wordIndex: i,
      word: encryptAndPack(burnWords[i]),
      salt: salts[i].replace(/^0x/, ''), // Strip 0x prefix for varchar(64) storage
      burnAmount: BURN_WORD_AMOUNT,
    });
  }

  console.log(`[burn-words] ✅ Stored ${burnWords.length} burn words for round ${roundId}`);
}

/**
 * Check if a word is an unclaimed burn word for a round
 * Returns the burn word record if found and unclaimed
 * Timeout: 3 seconds max to prevent request hangs
 */
export async function checkBurnWordMatch(
  roundId: number,
  word: string
): Promise<RoundBurnWordRow | null> {
  try {
    const result = await Promise.race([
      (async () => {
        // Get all unclaimed burn words for this round
        const burnWordRecords = await db
          .select()
          .from(roundBurnWords)
          .where(
            and(
              eq(roundBurnWords.roundId, roundId),
              isNull(roundBurnWords.finderFid)
            )
          );

        // Check each burn word (decrypting to compare)
        for (const record of burnWordRecords) {
          const decryptedWord = getPlaintextAnswer(record.word);
          if (decryptedWord.toUpperCase() === word.toUpperCase()) {
            return record;
          }
        }

        return null;
      })(),
      new Promise<null>((resolve) =>
        setTimeout(() => {
          console.warn(`[burn-words] Check timed out after 3s for round ${roundId}`);
          resolve(null);
        }, 3000)
      ),
    ]);

    return result;
  } catch (error) {
    console.error('[burn-words] Error checking burn word match:', error);
    return null;
  }
}

/**
 * Handle a burn word discovery
 * - Mark the burn word as found
 * - Record the guess with isBurnWord=true
 * - Award 100 XP
 * - Execute onchain burn (when WordManager is deployed)
 * - Record in word_rewards audit trail
 */
export async function handleBurnWordWin(
  roundId: number,
  fid: number,
  word: string,
  burnWord: RoundBurnWordRow,
  isPaidGuess: boolean
): Promise<SubmitGuessResult> {
  console.log(`🔥 BURN WORD FOUND! FID ${fid} found "${word}" (index ${burnWord.wordIndex})`);

  let txHash: string | null = null;

  // Use transaction to atomically update DB state
  await db.transaction(async (tx) => {
    // Insert the guess with isBurnWord=true
    await tx.insert(guesses).values({
      roundId,
      fid,
      word,
      isPaid: isPaidGuess,
      isCorrect: false,
      isBonusWord: false,
      isBurnWord: true,
      createdAt: new Date(),
    });

    // Mark burn word as found
    await tx
      .update(roundBurnWords)
      .set({
        finderFid: fid,
        foundAt: new Date(),
      })
      .where(eq(roundBurnWords.id, burnWord.id));
  });

  // Onchain verified burn execution (commit-reveal pattern)
  // Contract verifies keccak256(abi.encodePacked(word, salt)) matches stored hash
  if (!isDevModeEnabled()) {
    try {
      const { claimBurnWordOnChain } = await import('./word-manager');
      // Re-add 0x prefix stripped during storage for contract call
      const contractSalt = burnWord.salt.startsWith('0x') ? burnWord.salt : '0x' + burnWord.salt;
      txHash = await claimBurnWordOnChain(
        roundId,
        burnWord.wordIndex,
        word,
        contractSalt,
        burnWord.burnAmount
      );

      if (txHash) {
        // Update burn word record with tx hash
        await db
          .update(roundBurnWords)
          .set({ txHash })
          .where(eq(roundBurnWords.id, burnWord.id));
      }
    } catch (error) {
      console.error(`[burn-words] Onchain verified burn failed for round ${roundId}, word "${word}":`, error);
      // Continue — burn word is still marked as found in DB
    }
  } else {
    console.log(`🎮 [DEV MODE] Skipping onchain burn for "${word}"`);
  }

  // Record in word_rewards audit trail
  try {
    await db.insert(wordRewards).values({
      roundId,
      fid: null, // NULL for burns — tokens destroyed, not awarded
      rewardType: 'burn',
      amount: burnWord.burnAmount,
      word,
      txHash,
    });
  } catch (error) {
    console.error('[burn-words] Failed to record word_reward:', error);
  }

  // Award Arsonist wordmark (same pattern as bonus word → BONUS_WORD_FINDER)
  try {
    await db.insert(userBadges).values({
      fid,
      badgeType: 'BURN_WORD_FINDER',
      metadata: { roundId, word },
      awardedAt: new Date(),
    }).onConflictDoNothing();
    console.log(`🔥 Awarded BURN_WORD_FINDER wordmark to FID ${fid}`);
  } catch (error) {
    console.error(`[burn-words] Failed to award BURN_WORD_FINDER wordmark to FID ${fid}:`, error);
  }

  // Award 100 XP for discovering a burn word (fire-and-forget)
  logXpEvent(fid, 'BURN_WORD', {
    roundId,
    metadata: { word, burnAmount: burnWord.burnAmount },
  });

  // Announce the burn (non-blocking)
  try {
    const { announceBurnWordFound } = await import('./announcer');
    await announceBurnWordFound(roundId, fid, word);
  } catch (error) {
    console.error('[burn-words] Failed to announce burn word found:', error);
    // Continue - announcer failures should never break the game
  }

  // Check for DOUBLE_W: count bonus + burn words found by this user in this round
  setTimeout(async () => {
    try {
      const [bonusClaims, burnFinds] = await Promise.all([
        db
          .select({ count: count() })
          .from(roundBonusWords)
          .where(
            and(
              eq(roundBonusWords.roundId, roundId),
              eq(roundBonusWords.claimedByFid, fid)
            )
          ),
        db
          .select({ count: count() })
          .from(roundBurnWords)
          .where(
            and(
              eq(roundBurnWords.roundId, roundId),
              eq(roundBurnWords.finderFid, fid)
            )
          ),
      ]);
      const bonusWordsFound = bonusClaims[0]?.count ?? 0;
      const burnWordsFound = burnFinds[0]?.count ?? 0;
      if (bonusWordsFound + burnWordsFound >= 2) {
        const { checkAndAwardDoubleW } = await import('./wordmarks');
        await checkAndAwardDoubleW(fid, roundId, bonusWordsFound, burnWordsFound, false);
        console.log(`✌️ Checked DOUBLE_W for FID ${fid}: ${bonusWordsFound} bonus + ${burnWordsFound} burn words in round ${roundId}`);
      }
    } catch (error) {
      console.error(`[Wordmark] Failed to check DOUBLE_W from burn word:`, error);
    }
  }, 0);

  return {
    status: 'burn_word',
    word,
    burnAmount: String(BURN_WORD_AMOUNT_DISPLAY),
    txHash: txHash ?? undefined,
    message: `You discovered a burn word! 5M $WORD has been permanently destroyed.`,
  };
}

/**
 * Get burn word status for a round
 */
export async function getBurnWordStatus(roundId: number): Promise<{
  total: number;
  found: number;
  remaining: number;
  totalBurnedThisRound: string;
}> {
  const burnWords = await db
    .select()
    .from(roundBurnWords)
    .where(eq(roundBurnWords.roundId, roundId));

  const found = burnWords.filter(bw => bw.finderFid !== null).length;
  const totalBurned = burnWords
    .filter(bw => bw.finderFid !== null)
    .reduce((sum, bw) => sum + BigInt(bw.burnAmount), 0n);

  return {
    total: burnWords.length,
    found,
    remaining: burnWords.length - found,
    totalBurnedThisRound: totalBurned.toString(),
  };
}

/**
 * Burn word finder info for API responses
 */
export interface BurnWordFinder {
  fid: number;
  username: string;
  pfpUrl: string | null;
  word: string;
  burnAmount: string;
  txHash: string | null;
  foundAt: string;
  hasOgHunterBadge?: boolean;
  hasWordTokenBadge?: boolean;
  hasBonusWordBadge?: boolean;
  hasBurnWordBadge?: boolean;
  hasJackpotWinnerBadge?: boolean;
  hasDoubleWBadge?: boolean;
  hasPatronBadge?: boolean;
  hasQuickdrawBadge?: boolean;
  hasEncyclopedicBadge?: boolean;
  hasBakersDozenBadge?: boolean;
}

/**
 * Get all burn word finders for a round
 * Mirrors getBonusWordWinners() from bonus-words.ts
 */
export async function getBurnWordFinders(roundId: number): Promise<BurnWordFinder[]> {
  // Get all found burn words for this round
  const foundBurnWords = await db
    .select()
    .from(roundBurnWords)
    .where(
      and(
        eq(roundBurnWords.roundId, roundId),
        isNotNull(roundBurnWords.finderFid)
      )
    );

  if (foundBurnWords.length === 0) {
    return [];
  }

  // Decrypt words and collect finder FIDs
  const finderFids = foundBurnWords.map(bw => bw.finderFid!);

  // Fetch user data for all finders
  const userRecords = await db
    .select({
      fid: users.fid,
      username: users.username,
      pfpUrl: users.pfpUrl,
      signerWalletAddress: users.signerWalletAddress,
    })
    .from(users)
    .where(inArray(users.fid, finderFids));

  const userMap = new Map(userRecords.map(u => [u.fid, u]));

  // Fetch badge data for all finders
  const badges = await db
    .select({
      fid: userBadges.fid,
      badgeType: userBadges.badgeType,
    })
    .from(userBadges)
    .where(inArray(userBadges.fid, finderFids));

  // Group badges by FID
  const badgeMap = new Map<number, Set<string>>();
  for (const badge of badges) {
    if (!badgeMap.has(badge.fid)) {
      badgeMap.set(badge.fid, new Set());
    }
    badgeMap.get(badge.fid)!.add(badge.badgeType);
  }

  // Check $WORD token holder status
  const wordTokenHolderMap = new Map<number, boolean>();
  try {
    const walletsToCheck = userRecords
      .filter(u => u.signerWalletAddress)
      .map(u => ({ fid: u.fid, wallet: u.signerWalletAddress! }));

    if (walletsToCheck.length > 0) {
      const tokenResults = await Promise.allSettled(
        walletsToCheck.map(async ({ fid, wallet }) => ({
          fid,
          hasWordToken: await hasWordTokenBonus(wallet),
        }))
      );
      for (const result of tokenResults) {
        if (result.status === 'fulfilled' && result.value.hasWordToken) {
          wordTokenHolderMap.set(result.value.fid, true);
        }
      }
    }
  } catch (error) {
    console.warn('[burn-words] Error checking $WORD token balances:', error);
  }

  return foundBurnWords.map(bw => {
    const fid = bw.finderFid!;
    const user = userMap.get(fid);
    const userBadgeSet = badgeMap.get(fid) || new Set();
    const decryptedWord = getPlaintextAnswer(bw.word);

    return {
      fid,
      username: user?.username || `fid:${fid}`,
      pfpUrl: user?.pfpUrl || null,
      word: decryptedWord,
      burnAmount: bw.burnAmount,
      txHash: bw.txHash,
      foundAt: bw.foundAt?.toISOString() || new Date().toISOString(),
      hasOgHunterBadge: userBadgeSet.has('OG_HUNTER'),
      hasWordTokenBadge: wordTokenHolderMap.get(fid) || false,
      hasBonusWordBadge: userBadgeSet.has('BONUS_WORD_FINDER'),
      hasBurnWordBadge: userBadgeSet.has('BURN_WORD_FINDER'),
      hasJackpotWinnerBadge: userBadgeSet.has('JACKPOT_WINNER'),
      hasDoubleWBadge: userBadgeSet.has('DOUBLE_W'),
      hasPatronBadge: userBadgeSet.has('PATRON'),
      hasQuickdrawBadge: userBadgeSet.has('QUICKDRAW'),
      hasEncyclopedicBadge: userBadgeSet.has('ENCYCLOPEDIC'),
      hasBakersDozenBadge: userBadgeSet.has('BAKERS_DOZEN'),
    };
  });
}
