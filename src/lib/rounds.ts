import { db, rounds, roundBonusWords } from '../db';
import { selectBurnWords, storeBurnWords } from './burn-words';
import { eq, isNull, desc, and } from 'drizzle-orm';
import type { Round } from '../types';
import { getRandomAnswerWord, isValidAnswer, selectBonusWords } from './word-lists';
import { createCommitment, createBonusWordsCommitment, createRoundCommitment, verifyCommit } from './commit-reveal';
import type { RoundCommitmentData } from './commit-reveal';
import { resolveRoundAndCreatePayouts, syncPrizePoolFromContract } from './economics';
import { announceRoundStarted } from './announcer';
import { logRoundEvent, AnalyticsEventTypes } from './analytics';
import { trackSlowQuery } from './redis';
import { shouldBlockNewRoundCreation } from './operational-guard';
import { encryptAndPack, getPlaintextAnswer } from './encryption';
import { isDevModeEnabled } from './devGameState';
import {
  startRoundWithCommitmentOnChain,
  startRoundWithBothCommitmentsOnChain,
  isContractDeployed,
  isBonusWordsEnabledOnChain,
} from './jackpot-contract';
import { commitRoundOnChain } from './word-manager';
import {
  isWordEconomyConfigured,
  startWordRoundOnChain,
  getWordJackpotConfig,
  formatWordAmount,
} from './word-jackpot-contract';
import { WORD_SEED_USD_CENTS } from '../../config/economy';

/**
 * Options for creating a new round
 */
export interface CreateRoundOptions {
  forceAnswer?: string; // Force a specific answer (for testing)
  rulesetId?: number; // Game rules ID to use (default 1)
  skipOnChainCommitment?: boolean; // Skip onchain commitment (for testing without contract)
  skipActiveRoundCheck?: boolean; // Skip active round check (for Sepolia simulation)
}

/**
 * Number of bonus words per round
 */
const BONUS_WORDS_COUNT = 10;

/**
 * Create a new round
 *
 * @param opts Optional configuration
 * @returns The created round
 */
export async function createRound(opts?: CreateRoundOptions): Promise<Round> {
  const rulesetId = opts?.rulesetId ?? 1;
  const forceAnswer = opts?.forceAnswer;
  const skipOnChainCommitment = opts?.skipOnChainCommitment ?? false;
  const skipActiveRoundCheck = opts?.skipActiveRoundCheck ?? false;

  // Check if there's already an active round (skip for simulations)
  if (!skipActiveRoundCheck) {
    const existingRound = await getActiveRound();
    if (existingRound) {
      throw new Error(
        `Cannot create new round: Round ${existingRound.id} is still active. ` +
        `Resolve it first before creating a new round.`
      );
    }
  }

  // Select answer
  // Uppercase to match getRandomAnswerWord(), which returns canonical WORDS
  // entries. Storing forceAnswer verbatim meant the test-only path produced a
  // differently-cased answer than production, so anything comparing or
  // displaying the stored answer behaved differently under test.
  const selectedAnswer = (forceAnswer || getRandomAnswerWord()).toUpperCase();

  // Validate answer
  if (!isValidAnswer(selectedAnswer)) {
    throw new Error(`Invalid answer word: ${selectedAnswer}`);
  }

  // Create commitment for secret word
  const { salt, commitHash } = createCommitment(selectedAnswer);

  // Check if bonus words feature is enabled on contract
  let bonusWordsEnabled = false;
  let bonusWords: string[] = [];
  let burnWords: string[] = [];
  let bonusWordsCommitment: {
    masterSalt: string;
    individualSalts: string[];
    commitHash: string;
  } | null = null;
  let roundCommitment: RoundCommitmentData | null = null;

  if (!skipOnChainCommitment) {
    bonusWordsEnabled = await isBonusWordsEnabledOnChain();
    console.log(`[rounds] Bonus words feature enabled: ${bonusWordsEnabled}`);

    if (bonusWordsEnabled) {
      // Select 10 unique bonus words (excluding the secret word)
      bonusWords = selectBonusWords(BONUS_WORDS_COUNT, [selectedAnswer]);
      console.log(`[rounds] Selected ${bonusWords.length} bonus words`);

      // Select 5 burn words from full list (excluding secret + bonus words)
      burnWords = selectBurnWords([selectedAnswer, ...bonusWords]);
      console.log(`[rounds] Selected ${burnWords.length} burn words from full word list`);

      // Create legacy SHA-256 commitment for bonus words (backwards compat with JackpotManager)
      bonusWordsCommitment = createBonusWordsCommitment(bonusWords);
      console.log(`[rounds] Bonus words commit hash: ${bonusWordsCommitment.commitHash}`);

      // Create unified keccak256 commitments for all 16 words (for WordManager)
      roundCommitment = createRoundCommitment(selectedAnswer, bonusWords, burnWords);
      console.log(`[rounds] Round commitment: 1 secret + ${bonusWords.length} bonus + ${burnWords.length} burn word hashes`);
    }
  }

  // Milestone 10.1: Onchain commitment for provably fair verification
  // This MUST succeed before we insert into the database, ensuring the
  // commitment is immutably recorded onchain before the round can accept guesses
  let onChainCommitmentTxHash: string | null = null;
  let roundCommitTxHash: string | null = null;

  // Round 34 onward the prize lives in WordJackpot, not JackpotManagerV3.
  // WordJackpot.startRound needs the round id as its identifier, and that id is
  // assigned by Postgres on insert — so unlike the ETH path this cannot commit
  // before the row exists. The row is inserted 'pending' instead and only
  // becomes 'active' once the onchain call confirms, which preserves the
  // property that actually matters: a round cannot take a guess until its
  // commitment is immutably onchain.
  const useWordEconomy = !skipOnChainCommitment && isWordEconomyConfigured();

  if (!skipOnChainCommitment && !useWordEconomy) {
    // Check if contract is deployed and accessible
    const contractDeployed = await isContractDeployed();

    if (!contractDeployed) {
      throw new Error(
        'Cannot create round: Smart contract is not deployed. ' +
        'All rounds require onchain commitment for provable fairness.'
      );
    }

    if (bonusWordsEnabled && bonusWordsCommitment) {
      // Use new function with both commitments on JackpotManager
      console.log(`[rounds] Committing both secret word and bonus words onchain (JackpotManager)...`);
      onChainCommitmentTxHash = await startRoundWithBothCommitmentsOnChain(
        commitHash,
        bonusWordsCommitment.commitHash
      );
      console.log(`[rounds] ✅ JackpotManager commitment successful: ${onChainCommitmentTxHash}`);

      // Commit all 16 word hashes to WordManager
      if (roundCommitment) {
        try {
          // We use a temporary roundId — will be the next serial ID
          // Actually, we need the round ID first. We'll commit after DB insert.
          // For now, store the commitment data and commit after insert.
          console.log(`[rounds] WordManager round commitment will be submitted after round insert...`);
        } catch (error) {
          console.error('[rounds] WordManager commitment prep failed:', error);
          // Continue — WordManager commitment is additive, not blocking
        }
      }
    } else {
      // Legacy: only secret word commitment
      console.log(`[rounds] Committing answer hash onchain...`);
      onChainCommitmentTxHash = await startRoundWithCommitmentOnChain(commitHash);
      console.log(`[rounds] ✅ Onchain commitment successful: ${onChainCommitmentTxHash}`);
    }
  } else {
    console.log(`[rounds] ⚠️ Skipping onchain commitment (skipOnChainCommitment=true) - FOR TESTING ONLY`);
  }

  // Encrypt the answer for storage
  // The plaintext answer is NEVER stored in the database
  const encryptedAnswer = encryptAndPack(selectedAnswer);

  // Insert round into database with encrypted answer
  const result = await db
    .insert(rounds)
    .values({
      rulesetId,
      answer: encryptedAnswer, // Encrypted: iv:tag:ciphertext
      salt,
      commitHash,
      bonusWordsCommitHash: bonusWordsCommitment?.commitHash ?? null,
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      winnerFid: null,
      referrerFid: null,
      startTxHash: onChainCommitmentTxHash ?? null,
      startedAt: new Date(),
      resolvedAt: null,
      prizeCurrency: useWordEconomy ? 'word' : 'eth',
      // Held out of every active-round query until WordJackpot confirms below.
      status: useWordEconomy ? 'pending' : 'active',
    })
    .returning();

  const round = result[0];

  // CRITICAL: Validate salt immediately after insert to catch any corruption
  // This has been a recurring issue where salt becomes a Date object
  if (typeof round.salt !== 'string' || round.salt.length !== 64 || !/^[a-f0-9]+$/i.test(round.salt)) {
    console.error(`[rounds] ⚠️ SALT CORRUPTION DETECTED after insert for round ${round.id}!`);
    console.error(`[rounds] Salt type: ${typeof round.salt}, isDate: ${round.salt instanceof Date}`);
    console.error(`[rounds] Expected salt: ${salt}`);
    console.error(`[rounds] Actual salt: ${String(round.salt).substring(0, 50)}`);

    // Fix the corruption immediately using raw SQL
    const { sql: rawSql } = await import('drizzle-orm');
    await db.execute(rawSql`UPDATE rounds SET salt = ${salt} WHERE id = ${round.id}`);
    round.salt = salt;
    console.log(`[rounds] ✅ Salt corruption fixed for round ${round.id}`);
  }

  // Seed the round in WordJackpot and only then make it visible. Placed before
  // any further writes so a failure leaves nothing but one cancelled row.
  if (useWordEconomy) {
    try {
      const seed = await startWordRoundOnChain(round.id, WORD_SEED_USD_CENTS, commitHash);

      await db
        .update(rounds)
        .set({
          status: 'active',
          startTxHash: seed.txHash,
          prizePoolWord: seed.seedTokensWei.toString(),
          seedUsdCents: seed.seedUsdCents,
          seedPriceE18: seed.priceE18.toString(),
          jackpotContractAddress: getWordJackpotConfig().wordJackpotAddress,
        })
        .where(eq(rounds.id, round.id));

      round.status = 'active';
      round.startTxHash = seed.txHash;
      round.prizeCurrency = 'word';
      round.prizePoolWord = seed.seedTokensWei.toString();
      // The DB write above records the price snapshot; mirror it here too.
      // Every $WORD USD figure is derived from it, and a null reads as "no
      // price available" — so the round would come back from createRound
      // showing no USD value despite a real snapshot one row away.
      round.seedPriceE18 = seed.priceE18.toString();
      round.seedUsdCents = seed.seedUsdCents;

      console.log(
        `[rounds] ✅ Round ${round.id} seeded with ${formatWordAmount(seed.seedTokensWei)} $WORD ` +
          `($${(seed.seedUsdCents / 100).toFixed(2)}) — tx ${seed.txHash}`
      );
    } catch (error) {
      // The row must not survive as a startable round. Marking it cancelled
      // rather than deleting keeps the answer/salt for forensics and keeps the
      // id burnt, so a retry cannot collide with a WordJackpot round that may
      // have been created by a transaction that landed after this threw.
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[rounds] ❌ WordJackpot seeding failed for round ${round.id}: ${reason}`);

      await db
        .update(rounds)
        .set({
          status: 'cancelled',
          cancelledAt: new Date(),
          cancelledReason: `WordJackpot seeding failed: ${reason}`.slice(0, 500),
        })
        .where(eq(rounds.id, round.id));

      throw error;
    }
  }

  // Insert bonus words if enabled (use round commitment salts for onchain verification)
  if (bonusWordsEnabled && bonusWords.length > 0) {
    console.log(`[rounds] Storing ${bonusWords.length} encrypted bonus words...`);

    for (let i = 0; i < bonusWords.length; i++) {
      await db.insert(roundBonusWords).values({
        roundId: round.id,
        wordIndex: i,
        word: encryptAndPack(bonusWords[i]),
        // Use keccak256-compatible bytes32 salt from round commitment if available,
        // otherwise fall back to legacy SHA-256 individual salts.
        // Strip 0x prefix for varchar(64) storage — re-add when calling contracts.
        salt: roundCommitment
          ? roundCommitment.bonusWordSalts[i].replace(/^0x/, '')
          : bonusWordsCommitment!.individualSalts[i],
      });
    }

    console.log(`[rounds] ✅ Stored ${bonusWords.length} bonus words for round ${round.id}`);
  }

  // Store burn words (already selected before round insert)
  if (burnWords.length > 0 && roundCommitment) {
    try {
      await storeBurnWords(round.id, burnWords, roundCommitment.burnWordSalts);
      console.log(`[rounds] ✅ Stored ${burnWords.length} burn words for round ${round.id}`);
    } catch (error) {
      console.error(`[rounds] Failed to store burn words for round ${round.id}:`, error);
      // Continue — burn word failure should never block round creation
    }
  }

  // Commit all 16 word hashes to WordManager (now that we have the round ID)
  if (roundCommitment && !skipOnChainCommitment) {
    try {
      roundCommitTxHash = await commitRoundOnChain(
        round.id,
        roundCommitment.secretHash,
        roundCommitment.bonusWordHashes,
        roundCommitment.burnWordHashes
      );
      if (roundCommitTxHash) {
        // Store the commitment tx hash
        const { sql: rawSql } = await import('drizzle-orm');
        await db.execute(rawSql`UPDATE rounds SET round_commit_tx_hash = ${roundCommitTxHash} WHERE id = ${round.id}`);
        console.log(`[rounds] ✅ WordManager round commitment tx: ${roundCommitTxHash}`);
      }
    } catch (error) {
      console.error(`[rounds] WordManager round commitment failed for round ${round.id}:`, error);
      // Continue — WordManager commitment enhances fairness but shouldn't block the round
    }
  }

  console.log(`✅ Created round ${round.id} with commit hash: ${round.commitHash}`);
  if (bonusWordsCommitment) {
    console.log(`   Bonus words commit hash: ${bonusWordsCommitment.commitHash}`);
  }
  if (onChainCommitmentTxHash) {
    console.log(`   Onchain commitment tx: ${onChainCommitmentTxHash}`);
  }

  // Milestone 4.10: Seed words removed - wheel shows all GUESS_WORDS from start

  // Sync prize pool from contract (the contract may have seed ETH from previous round)
  if (!skipOnChainCommitment) {
    try {
      const syncedPrizePool = await syncPrizePoolFromContract(round.id);
      round.prizePoolEth = syncedPrizePool;
      console.log(`[rounds] ✅ Synced prize pool from contract: ${syncedPrizePool} ETH`);
    } catch (error) {
      console.error('[rounds] Failed to sync prize pool from contract:', error);
      // Continue - the prize pool will be synced on next purchase or can be manually synced
    }
  }

  // Milestone 5.1: Announce round started (non-blocking)
  try {
    await announceRoundStarted(round);
  } catch (error) {
    console.error('[rounds] Failed to announce round started:', error);
    // Continue - announcer failures should never break the game
  }

  // Milestone 5.2: Log analytics event (non-blocking)
  logRoundEvent(AnalyticsEventTypes.ROUND_STARTED, round.id, {
    prizePoolEth: round.prizePoolEth,
    commitHash: round.commitHash,
    bonusWordsEnabled,
  });

  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: getPlaintextAnswer(round.answer), // Decrypt for internal use
    salt: round.salt,
    commitHash: round.commitHash,
    prizePoolEth: round.prizePoolEth,
    seedNextRoundEth: round.seedNextRoundEth,
    // Same omission as getActiveRound above — see the note there.
    prizeCurrency: round.prizeCurrency,
    prizePoolWord: round.prizePoolWord,
    seedPriceE18: round.seedPriceE18,
    winnerFid: round.winnerFid,
    referrerFid: round.referrerFid,
    startedAt: round.startedAt,
    resolvedAt: round.resolvedAt,
  };
}

/**
 * Get the current active round (latest unresolved round)
 *
 * Milestone 9.5: Excludes cancelled rounds - a cancelled round is not active
 * Also excludes rounds where winnerFid is set (round locked, payouts in progress)
 */
export async function getActiveRound(): Promise<Round | null> {
  return trackSlowQuery('query:getActiveRound', async () => {
    const conditions = [
      isNull(rounds.resolvedAt),
      isNull(rounds.winnerFid), // Round is locked once winner is set
      eq(rounds.status, 'active'), // Exclude cancelled rounds
    ];
    // Only filter out dev test rounds when NOT in dev mode
    if (!isDevModeEnabled()) {
      conditions.push(eq(rounds.isDevTestRound, false));
    }
    const result = await db
      .select()
      .from(rounds)
      .where(and(...conditions))
      .orderBy(desc(rounds.startedAt))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const round = result[0];
    return {
      id: round.id,
      rulesetId: round.rulesetId,
      answer: getPlaintextAnswer(round.answer), // Decrypt for internal use
      salt: round.salt,
      commitHash: round.commitHash,
      prizePoolEth: round.prizePoolEth,
      seedNextRoundEth: round.seedNextRoundEth,
      // Carry the $WORD fields. The select above is `select()` — every column
      // is already fetched — and this object literal was quietly dropping
      // them, so `prizeCurrency` came back undefined for all ~50 callers.
      // `Round` declares it optional, so nothing type-checks the omission, and
      // the type's own comment reads a missing value as "an ETH round": the
      // failure is silent and defaults the wrong way for round 34+.
      prizeCurrency: round.prizeCurrency,
      prizePoolWord: round.prizePoolWord,
      seedPriceE18: round.seedPriceE18,
      winnerFid: round.winnerFid,
      referrerFid: round.referrerFid,
      startedAt: round.startedAt,
      resolvedAt: round.resolvedAt,
    };
  });
}

/**
 * Get the current active round with FOR UPDATE lock (for use in transactions)
 *
 * This acquires a row-level lock on the round, preventing other transactions
 * from modifying it until this transaction commits. Used to prevent race
 * conditions when resolving rounds.
 *
 * Also checks winnerFid to ensure round isn't already locked by a winning guess.
 *
 * @param tx - The transaction context
 * @returns The active round (locked) or null if no active round
 */
export async function getActiveRoundForUpdate(tx: typeof db): Promise<Round | null> {
  const result = await tx
    .select()
    .from(rounds)
    .where(and(
      isNull(rounds.resolvedAt),
      isNull(rounds.winnerFid), // Round is locked once winner is set
      eq(rounds.status, 'active')
    ))
    .orderBy(desc(rounds.startedAt))
    .limit(1)
    .for('update');

  if (result.length === 0) {
    return null;
  }

  const round = result[0];
  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: getPlaintextAnswer(round.answer),
    salt: round.salt,
    commitHash: round.commitHash,
    prizePoolEth: round.prizePoolEth,
    seedNextRoundEth: round.seedNextRoundEth,
    // Same omission as getActiveRound — see the note there. This variant feeds
    // the resolution transaction, so a missing discriminator here decides which
    // contract pays out.
    prizeCurrency: round.prizeCurrency,
    prizePoolWord: round.prizePoolWord,
    seedPriceE18: round.seedPriceE18,
    winnerFid: round.winnerFid,
    referrerFid: round.referrerFid,
    startedAt: round.startedAt,
    resolvedAt: round.resolvedAt,
  };
}

/**
 * Ensure there is an active round, creating one if necessary
 *
 * Milestone 9.5: Will NOT create a new round if:
 * - Kill switch is active
 * - Dead day is enabled (current round finished, waiting to resume)
 *
 * @param opts Optional configuration for round creation
 * @returns The active round (existing or newly created)
 * @throws Error if new round creation is blocked by operational controls
 */
export async function ensureActiveRound(opts?: CreateRoundOptions): Promise<Round> {
  const activeRound = await getActiveRound();

  if (activeRound) {
    return activeRound;
  }

  // No active round exists - check if we can create one
  const blocked = await shouldBlockNewRoundCreation();
  if (blocked) {
    throw new Error(
      'Cannot create new round: Game is paused (kill switch or dead day active). ' +
      'Please wait for the game to resume.'
    );
  }

  // Create new round
  return createRound(opts);
}

/**
 * Alias for getActiveRound() for backwards compatibility
 * @deprecated Use getActiveRound() instead
 */
export const getCurrentRound = getActiveRound;

/**
 * Get a round by ID
 */
export async function getRoundById(roundId: number): Promise<Round | null> {
  const result = await db
    .select()
    .from(rounds)
    .where(eq(rounds.id, roundId))
    .limit(1);

  if (result.length === 0) {
    return null;
  }

  const round = result[0];
  return {
    id: round.id,
    rulesetId: round.rulesetId,
    answer: getPlaintextAnswer(round.answer), // Decrypt for internal use
    salt: round.salt,
    commitHash: round.commitHash,
    prizePoolEth: round.prizePoolEth,
    // The fourth hand-written field list in this codebase to drop the currency
    // discriminator. Without it, the ROUND_RESOLVED analytics event reads its
    // currency off this object and records every $WORD resolve as 'eth' — so
    // the discriminator added for the growth chart never reaches the stream it
    // was added for.
    prizeCurrency: round.prizeCurrency,
    prizePoolWord: round.prizePoolWord,
    seedPriceE18: round.seedPriceE18,
    seedNextRoundEth: round.seedNextRoundEth,
    winnerFid: round.winnerFid,
    referrerFid: round.referrerFid,
    startedAt: round.startedAt,
    resolvedAt: round.resolvedAt,
  };
}

/**
 * Resolve a round (mark as complete with winner)
 *
 * The referrer is not a parameter. It is read from the winner's own user
 * record inside resolveRoundAndCreatePayouts, which is the only place it can
 * be trusted from — the referrer share is 5% of the prize pool, and taking the
 * recipient from an argument would let any caller point that money at an FID
 * of its choosing. This function used to accept a `referrerFid` and pass it
 * nowhere, so callers supplying one got no error and no effect.
 *
 * @param roundId Round to resolve
 * @param winnerFid FID of winning user
 * @returns The resolved round
 * @throws Error if round not found or already resolved
 */
export async function resolveRound(
  roundId: number,
  winnerFid: number
): Promise<Round> {
  // First, check if the round exists and is not already resolved
  const existingRound = await getRoundById(roundId);

  if (!existingRound) {
    throw new Error(`Round ${roundId} not found`);
  }

  if (existingRound.resolvedAt !== null) {
    throw new Error(
      `Round ${roundId} is already resolved (winner: FID ${existingRound.winnerFid})`
    );
  }

  // Create payouts and resolve round (Milestone 3.1)
  // This marks the round as resolved and creates payout records
  await resolveRoundAndCreatePayouts(roundId, winnerFid);

  // Fetch the updated round
  const updatedRound = await getRoundById(roundId);

  if (!updatedRound) {
    throw new Error(`Failed to fetch resolved round ${roundId}`);
  }

  console.log(`✅ Resolved round ${roundId} with winner FID: ${winnerFid}`);

  // Milestone 5.2: Log analytics event (non-blocking)
  // The currency and the $WORD pool travel with the event.
  //
  // view_jackpot_growth (drizzle/0001_analytics_views.sql) charts
  // `data->>'prizePoolEth'` and filters on IS NOT NULL. A $WORD round emits '0'
  // there, which passes the filter — so the admin "Prize Pool Evolution" chart
  // plots round 34+ at zero rather than omitting it, and the trend line falls
  // off a cliff that never happened. Fixing the view alone cannot help while
  // the event itself carries no way to tell the two cases apart.
  logRoundEvent(AnalyticsEventTypes.ROUND_RESOLVED, roundId, {
    winnerFid,
    referrerFid: updatedRound.referrerFid,
    prizeCurrency: updatedRound.prizeCurrency ?? 'eth',
    prizePoolEth: updatedRound.prizePoolEth,
    prizePoolWord: updatedRound.prizePoolWord ?? null,
    seedNextRoundEth: updatedRound.seedNextRoundEth,
  });

  return updatedRound;
}

/**
 * Verify round commitment (for transparency after resolution)
 *
 * @param round The round to verify
 * @returns true if commitment is valid
 */
export function verifyRoundCommitment(round: Round): boolean {
  return verifyCommit(round.salt, round.answer, round.commitHash);
}
