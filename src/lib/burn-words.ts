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

import { randomInt } from 'crypto';
import { db } from '../db';
import { roundBurnWords, wordRewards, guesses, users, userBadges } from '../db/schema';
import type { RoundBurnWordRow } from '../db/schema';
import type { SubmitGuessResult } from '../types';
import { eq, and, isNull } from 'drizzle-orm';
import { encryptAndPack, getPlaintextAnswer } from './encryption';
import { createBonusWordsCommitment } from './commit-reveal';
import { BURN_WORD_CANDIDATES } from '../data/burn-word-lists';
import { BURN_WORD_AMOUNT, BURN_WORDS_PER_ROUND } from '../../config/economy';
import { logXpEvent } from './xp';
import { isDevModeEnabled } from './devGameState';

/**
 * Select burn words for a round
 * Picks BURN_WORDS_PER_ROUND (5) from the curated burn word list,
 * excluding the answer and any bonus words already selected.
 *
 * @param roundId - The round to create burn words for
 * @param excludeWords - Words to exclude (answer + bonus words)
 * @returns Array of selected burn words
 */
export async function selectBurnWordsForRound(
  roundId: number,
  excludeWords: string[] = []
): Promise<string[]> {
  const excludeSet = new Set(excludeWords.map(w => w.toUpperCase()));
  const available = BURN_WORD_CANDIDATES.filter(w => !excludeSet.has(w.toUpperCase()));

  const count = Math.min(BURN_WORDS_PER_ROUND, available.length);
  if (count === 0) {
    console.warn(`[burn-words] No burn words available after exclusions for round ${roundId}`);
    return [];
  }

  // Cryptographically random selection (same pattern as selectBonusWords)
  const selected: string[] = [];
  const pool = [...available];
  for (let i = 0; i < count; i++) {
    const idx = randomInt(pool.length);
    selected.push(pool[idx]);
    pool.splice(idx, 1);
  }

  // Create commitment for burn words (reuses bonus word commitment pattern)
  const commitment = createBonusWordsCommitment(selected);

  // Encrypt and store each burn word
  for (let i = 0; i < selected.length; i++) {
    await db.insert(roundBurnWords).values({
      roundId,
      wordIndex: i,
      word: encryptAndPack(selected[i]),
      salt: commitment.individualSalts[i],
      burnAmount: BURN_WORD_AMOUNT,
    });
  }

  console.log(`[burn-words] ✅ Stored ${selected.length} burn words for round ${roundId}`);
  return selected;
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

  // Onchain burn execution (fire-and-forget, non-blocking)
  if (!isDevModeEnabled()) {
    try {
      const { burnWordOnChain } = await import('./word-manager');
      txHash = await burnWordOnChain(roundId, fid, burnWord.burnAmount);

      if (txHash) {
        // Update burn word record with tx hash
        await db
          .update(roundBurnWords)
          .set({ txHash })
          .where(eq(roundBurnWords.id, burnWord.id));
      }
    } catch (error) {
      console.error(`[burn-words] Onchain burn failed for round ${roundId}, word "${word}":`, error);
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

  // Award 100 XP for discovering a burn word (fire-and-forget)
  logXpEvent(fid, 'BURN_WORD', {
    roundId,
    metadata: { word, burnAmount: burnWord.burnAmount },
  });

  return {
    status: 'burn_word',
    word,
    burnAmount: burnWord.burnAmount,
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
