import { db, rounds, roundBonusWords } from '../db';
import { selectBurnWords, storeBurnWords } from './burn-words';
import { eq, isNull, isNotNull, desc, and } from 'drizzle-orm';
import type { Round } from '../types';
import { getRandomAnswerWord, isValidAnswer, selectBonusWords } from './word-lists';
import { createCommitment, createBonusWordsCommitment, createRoundCommitment, verifyCommit } from './commit-reveal';
import type { RoundCommitmentData } from './commit-reveal';
import { resolveRoundAndCreatePayouts, syncPrizePoolFromContract } from './economics';
import { announceRoundStarted } from './announcer';
import { logRoundEvent, AnalyticsEventTypes } from './analytics';
import {
  trackSlowQuery,
  cacheGet,
  cacheSet,
  cacheDel,
  getRedisClient,
  CacheKeys,
  CacheTTL,
  CACHE_PREFIX,
} from './redis';
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
  getActiveWordRoundId,
  getWordJackpotConfig,
  getWordJackpotReadOnly,
  getSeedBounds,
  getWordJackpotSolvency,
  getWordPriceOnChain,
  syncWordPriceOnChain,
  tokensForUsdCents,
  formatWordAmount,
} from './word-jackpot-contract';
import { WORD_SEED_USD_CENTS, getRoundCooldownMs } from '../../config/economy';

/**
 * Options for creating a new round
 */
export interface CreateRoundOptions {
  forceAnswer?: string; // Force a specific answer (for testing)
  rulesetId?: number; // Game rules ID to use (default 1)
  skipOnChainCommitment?: boolean; // Skip onchain commitment (for testing without contract)
  skipActiveRoundCheck?: boolean; // Skip active round check (for Sepolia simulation)
  /**
   * Suppress the public round-start announcement (cast + tweet). Simulations
   * and drills MUST pass this: on 2026-08-17 the Sepolia sim created a round
   * through this function and the announcer cast "Round #34 is live" to the
   * world for a phantom round.
   */
  skipAnnounce?: boolean;
}

/**
 * Number of bonus words per round
 */
const BONUS_WORDS_COUNT = 10;

/**
 * The DB's view of the round WordJackpot currently calls active, as far as the
 * start preflight needs it. The currency columns travel with every hand-written
 * field list in this repo (CLAUDE.md) — the reason below names the era of the
 * row holding the contract, and a dropped discriminator would report a $WORD
 * wedge as an ETH one.
 */
export interface OnchainActiveRoundRow {
  id: number;
  status: string | null;
  prizeCurrency: string | null;
  prizePoolWord: string | null;
  seedPriceE18: string | null;
}

/**
 * Why a new $WORD round cannot be started right now, or null if it can.
 *
 * Pure on purpose: the decision is the part worth testing, and it needs neither
 * a chain nor a database to make. `startWordRoundOnChain` runs the same
 * activeRoundId check itself (word-jackpot-contract.ts), but it runs it AFTER
 * the row is inserted — so an onchain round the DB does not know about turned
 * every 5-minute tick into an inserted-then-cancelled row and a permanently
 * burnt round id, because the public round number IS rounds.id.
 *
 * The two blocked cases are deliberately worded differently. One is the game
 * working as designed; the other needs an operator.
 */
export function describeOnchainStartBlock(args: {
  onchainActiveRoundId: number;
  dbRow: OnchainActiveRoundRow | null;
}): string | null {
  const { onchainActiveRoundId, dbRow } = args;

  if (onchainActiveRoundId === 0) return null;

  if (dbRow?.status === 'active') {
    // Both sides agree a round is live. getActiveRound() above normally
    // catches this first; reaching here means the round started between that
    // check and this one, which is a race closing correctly, not a fault.
    return (
      `Cannot start a new round: WordJackpot is running round ${onchainActiveRoundId}, ` +
      `which the database also has active. Resolve it first.`
    );
  }

  // The wedge. The contract is holding a round id that the database does not
  // consider startable, so every future start fails the same way. Inserting a
  // row here would burn one more id per tick and change nothing.
  const dbState = dbRow
    ? `status '${dbRow.status ?? 'unknown'}' (${dbRow.prizeCurrency ?? 'eth'} round)`
    : 'no row at all';
  return (
    `Cannot start a new round: WordJackpot still holds round ${onchainActiveRoundId} as its ` +
    `active round, but the database has ${dbState} for it and no active round. Refusing to ` +
    `insert — the id would be burnt and the next start would fail identically. Clear the ` +
    `contract with POST /api/admin/operational/recover-stuck-round ` +
    `{ roundId: ${onchainActiveRoundId}, confirm: 'CLEAR_ONCHAIN_ROUND_${onchainActiveRoundId}' }.`
  );
}

/**
 * The chain-side numbers a $WORD start depends on, read one beat BEFORE the
 * insert. Every field is something `startWordRoundOnChain` reads for itself —
 * this does not replace the contract-side checks, it moves the knowable half
 * of them in front of the row that would otherwise be burnt.
 */
export interface WordSeedReadiness {
  seedUsdCents: number;
  /**
   * WordJackpot's OpenZeppelin pause flag. `startRound` is `whenNotPaused`
   * (contracts/src/WordJackpot.sol:254), so this refuses exactly like a stale
   * price does — and for as long as the owner leaves the contract paused.
   */
  paused: boolean;
  priceE18: bigint;
  priceIsStale: boolean;
  priceUpdatedAt: Date | null;
  maxPriceAgeSeconds: number;
  /** Whether the one-shot oracle sync already ran, so the message can say so. */
  priceSyncAttempted: boolean;
  seedTokensWei: bigint;
  minSeedWei: bigint;
  maxSeedWei: bigint;
  carryWei: bigint;
  unallocatedWei: bigint;
}

/**
 * Why WordJackpot would refuse to seed the next round, or null if it would not.
 *
 * Pure, like describeOnchainStartBlock above, and for the same reason: the
 * decision is the part worth testing and it needs neither a chain nor a
 * database. These are the refusals `startWordRoundOnChain` raises AFTER the
 * insert — a paused contract, a stale price, a seed outside the contract
 * bounds, an empty tranche — and every one of them is a standing condition,
 * not a transient (a pause lasts as long as the incident that caused it). Left
 * unguarded, a 6-hour oracle outage inserts and cancels a row every 5 minutes
 * and the public round number (which IS rounds.id) advances 72 rounds without
 * a round being played.
 *
 * NOT covered here: the contract's "round id has already been started"
 * refusal. It is the one failure that needs the round id, and Postgres assigns
 * that id on the insert this check runs before. Guessing it (max(id) + 1) can
 * be wrong whenever the sequence is ahead of the table, and a preflight that
 * refuses while WordJackpot is idle stops the game outright — a worse failure
 * than the one burnt id it would save. It is also self-limiting: a started id
 * burns one row and the next id is free, where the cases below repeat forever.
 */
export function describeWordSeedBlock(state: WordSeedReadiness): string | null {
  const suffix =
    'Refusing to insert — the round id would be burnt and the next tick would fail identically.';

  // First, because it is the one refusal an operator deliberately caused:
  // `startRound` is whenNotPaused, so every tick of a 6-hour pause used to
  // burn a round id. `resolveRound` is deliberately NOT paused-gated, so the
  // recovery arm still works while this is true.
  if (state.paused) {
    return (
      `Cannot start a new round: WordJackpot is paused, and startRound is whenNotPaused. ` +
      `Unpause the contract (owner-only) before a round can be seeded. ${suffix}`
    );
  }

  if (state.priceE18 <= 0n) {
    return (
      `Cannot start a new round: WordJackpot has no $WORD price at all (priceE18 is 0) and the ` +
      `oracle sync ${state.priceSyncAttempted ? 'did not take effect' : 'was not attempted'}. ${suffix}`
    );
  }

  if (state.priceIsStale) {
    return (
      `Cannot start a new round: the onchain $WORD price is stale (last updated ` +
      `${state.priceUpdatedAt?.toISOString() ?? 'never'}, max age ${state.maxPriceAgeSeconds}s) and ` +
      `the oracle sync ${state.priceSyncAttempted ? 'returned no usable price' : 'was not attempted'}. ` +
      `${suffix}`
    );
  }

  if (state.seedTokensWei < state.minSeedWei || state.seedTokensWei > state.maxSeedWei) {
    return (
      `Cannot start a new round: a $${(state.seedUsdCents / 100).toFixed(2)} seed prices at ` +
      `${formatWordAmount(state.seedTokensWei)} $WORD, outside the contract bounds ` +
      `[${formatWordAmount(state.minSeedWei)}, ${formatWordAmount(state.maxSeedWei)}]. At this ` +
      `price that usually means the oracle is wrong, not the bounds. ${suffix}`
    );
  }

  // The contract spends carry first, then the unallocated tranche.
  const fromCarry = state.carryWei >= state.seedTokensWei ? state.seedTokensWei : state.carryWei;
  const needed = state.seedTokensWei - fromCarry;
  if (needed > state.unallocatedWei) {
    return (
      `Cannot start a new round: seeding needs ${formatWordAmount(needed)} $WORD beyond the ` +
      `${formatWordAmount(state.carryWei)} carry, but only ` +
      `${formatWordAmount(state.unallocatedWei)} is unallocated. Fund WordJackpot from the ` +
      `treasury. ${suffix}`
    );
  }

  return null;
}

/**
 * Read what describeWordSeedBlock judges, including the one-shot price sync.
 *
 * The sync is not an optimisation: nothing keeps the onchain price warm
 * between rounds (the market-cap cron only writes the DB), so a stale price at
 * round start is the NORMAL case. startWordRoundOnChain syncs once and
 * re-reads for exactly that reason; doing it here means the preflight refuses
 * only when the oracle genuinely has nothing to say, and the seeding call a
 * second later finds the price already fresh.
 */
export async function readWordSeedReadiness(seedUsdCents: number): Promise<WordSeedReadiness> {
  const [bounds, solvency, paused] = await Promise.all([
    getSeedBounds(),
    getWordJackpotSolvency(),
    getWordJackpotReadOnly().paused() as Promise<boolean>,
  ]);
  let price = await getWordPriceOnChain();
  let priceSyncAttempted = false;

  if (price.isStale) {
    priceSyncAttempted = true;
    console.log(
      `[rounds] Onchain $WORD price stale before the insert ` +
        `(last updated ${price.updatedAt?.toISOString() ?? 'never'}) — syncing from the oracle`
    );
    const synced = await syncWordPriceOnChain();
    if (synced) price = await getWordPriceOnChain();
  }

  return {
    seedUsdCents,
    paused,
    priceE18: price.priceE18,
    priceIsStale: price.isStale,
    priceUpdatedAt: price.updatedAt,
    maxPriceAgeSeconds: price.maxPriceAgeSeconds,
    priceSyncAttempted,
    // tokensForUsdCents throws on a zero price; the zero case is reported by
    // describeWordSeedBlock instead, so it must not throw on the way there.
    seedTokensWei: price.priceE18 > 0n ? tokensForUsdCents(BigInt(seedUsdCents), price.priceE18) : 0n,
    minSeedWei: bounds.minWei,
    maxSeedWei: bounds.maxWei,
    carryWei: solvency.carryWei,
    unallocatedWei: solvency.unallocatedWei,
  };
}

/**
 * Create a new round.
 *
 * Serialized on the round-creation lock, at THIS level rather than in
 * ensureActiveRound: the cron reaches round creation through ensureActiveRound
 * but /api/admin/operational/start-round calls createRound directly, and
 * admin-vs-cron is the concurrent pair this game actually has (round 34 was
 * started by the admin button, round 35 by the cron). A lock one level up
 * would serialise everything except the pair that exists. Wrapping here also
 * covers src/scripts/* and any future caller.
 *
 * The whole body runs inside the lock, including the active-round check and
 * the onchain preflight — a check-then-act is only worth anything if the check
 * and the act are on the same side of the lock.
 *
 * @param opts Optional configuration
 * @returns The created round
 * @throws RoundCreationInFlightError if another creation holds the lock
 */
export async function createRound(opts?: CreateRoundOptions): Promise<Round> {
  const lockToken = await acquireRoundCreationLock();
  if (!lockToken) {
    // Deliberately not "wait and retry": the holder needs ~25 seconds, longer
    // than a player request should live, and both of this function's callers
    // run again within minutes.
    throw new RoundCreationInFlightError();
  }

  try {
    return await createRoundUnderLock(opts);
  } finally {
    await releaseRoundCreationLock(lockToken);
  }
}

async function createRoundUnderLock(opts?: CreateRoundOptions): Promise<Round> {
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
  } else if (useWordEconomy) {
    // Not skipped, deferred: the $WORD path commits inside
    // startWordRoundOnChain below, because the commitment travels with the
    // round id and Postgres has not assigned one yet. Said out loud because
    // this branch used to log "skipOnChainCommitment=true - FOR TESTING ONLY"
    // on every production round start, which is the opposite of what happened.
    console.log(`[rounds] Onchain commitment deferred to WordJackpot.startRound (needs the round id)`);
  } else {
    console.log(`[rounds] ⚠️ Skipping onchain commitment (skipOnChainCommitment=true) - FOR TESTING ONLY`);
  }

  // Refuse BEFORE the insert, not after the transaction fails.
  //
  // The $WORD path cannot commit before the row exists (the round id is the
  // contract's identifier and Postgres assigns it), so a failure after the
  // insert is unavoidable in general — that path is handled below by marking
  // the row cancelled. What is avoidable is inserting when the answer is
  // already knowable: if WordJackpot is still holding a round id, the seeding
  // call ~a second later will throw on exactly that, and the only lasting
  // effect of having tried is one burnt round id. Auto-start runs every 5
  // minutes, so "try anyway" means burning an id every 5 minutes, forever,
  // while the public round number marches away from reality.
  if (useWordEconomy) {
    let onchainActiveRoundId: number;
    try {
      onchainActiveRoundId = await getActiveWordRoundId();
    } catch (error) {
      // An unreadable contract is a refusal, not a shrug. startWordRoundOnChain
      // reads the same value and would fail anyway — but by then a row exists.
      // Failing here costs a retry in 5 minutes and no round id.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot start a new round: WordJackpot's active round could not be read (${reason}). ` +
        `Refusing to insert a round that could not be seeded.`
      );
    }

    if (onchainActiveRoundId !== 0) {
      const [dbRow] = await db
        .select({
          id: rounds.id,
          status: rounds.status,
          prizeCurrency: rounds.prizeCurrency,
          prizePoolWord: rounds.prizePoolWord,
          seedPriceE18: rounds.seedPriceE18,
        })
        .from(rounds)
        .where(eq(rounds.id, onchainActiveRoundId))
        .limit(1);

      const blocked = describeOnchainStartBlock({
        onchainActiveRoundId,
        dbRow: dbRow ?? null,
      });
      if (blocked) {
        console.error(`[rounds] ❌ ${blocked}`);
        throw new Error(blocked);
      }
    }

    // The refusals that do not need a round id, asked before the insert
    // instead of after it. An activeRoundId of 0 is not the only way the
    // seeding call says no: a stale price, a seed outside the contract bounds
    // and an empty tranche each refuse every 5 minutes for as long as the
    // condition lasts, and each one used to cost a burnt round id per tick.
    let readiness: WordSeedReadiness;
    try {
      readiness = await readWordSeedReadiness(WORD_SEED_USD_CENTS);
    } catch (error) {
      // Unreadable preconditions are a refusal for the same reason as an
      // unreadable activeRoundId: retrying in 5 minutes costs nothing, and
      // finding out after the insert costs a public round number.
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Cannot start a new round: WordJackpot's seeding preconditions could not be read ` +
        `(${reason}). Refusing to insert a round that could not be seeded.`
      );
    }

    const seedBlocked = describeWordSeedBlock(readiness);
    if (seedBlocked) {
      console.error(`[rounds] ❌ ${seedBlocked}`);
      throw new Error(seedBlocked);
    }
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

  // Milestone 5.1: Announce round started.
  //
  // AWAITED, deliberately — the comment here used to say "non-blocking" above
  // this same await, which is the more dangerous of the two ways to be wrong.
  // On Vercel, work scheduled after the response can be frozen (word-oracle.ts
  // documents the same trap for its cache warm), so fire-and-forget here would
  // silently drop the round's public launch: the cast, the tweet and the push
  // that tell players a round exists. The fire-and-forget Wordmark awards
  // elsewhere in the codebase can afford that risk; a round nobody is told
  // about cannot.
  //
  // Nothing is waiting on this call — the caller is a cron, not a player — so
  // the only cost is invocation time, which is why /api/cron/auto-start-round
  // and the admin start-round endpoint carry an explicit maxDuration in
  // vercel.json (the whole path is ~20-25s of serial onchain and API work).
  if (opts?.skipAnnounce) {
    console.log(`[rounds] Round ${round.id}: announcement suppressed (skipAnnounce)`);
  } else {
    try {
      await announceRoundStarted(round);
    } catch (error) {
      console.error('[rounds] Failed to announce round started:', error);
      // Continue - announcer failures should never break the game
    }
  }

  // Milestone 5.2: Log analytics event (non-blocking)
  logRoundEvent(AnalyticsEventTypes.ROUND_STARTED, round.id, {
    prizePoolEth: round.prizePoolEth,
    commitHash: round.commitHash,
    bonusWordsEnabled,
  });

  // A new round just became the active one; drop the cached id so the
  // public endpoints pick it up within a request instead of waiting out
  // the 5s TTL (and re-arming the CDN's between-rounds copy meanwhile).
  await cacheDel(CacheKeys.activeRoundId()).catch(() => {});

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
 * The one definition of "active round", shared by getActiveRound and
 * getActiveRoundId so their WHERE clauses cannot drift. A drifted copy of
 * this filter has already caused an answer disclosure once (see
 * pages/api/wheel/wrong-guesses.ts): two public endpoints disagreeing about
 * which round is active is not a cosmetic bug here.
 */
/**
 * What "the active round" means, in one place.
 *
 * Exported because a hand-rolled `isNull(resolvedAt)` is not the same query and
 * Bugbot caught it being one: a kill-switched round keeps resolvedAt NULL by
 * design (enableKillSwitch writes status 'cancelled' and nothing else), so once
 * a successor auto-starts there are two rows with a null resolvedAt and a
 * caller without these conditions can pick the dead one.
 */
export function activeRoundConditions() {
  const conditions = [
    isNull(rounds.resolvedAt),
    isNull(rounds.winnerFid), // Round is locked once winner is set
    eq(rounds.status, 'active'), // Exclude cancelled rounds
  ];
  // Only filter out dev test rounds when NOT in dev mode
  if (!isDevModeEnabled()) {
    conditions.push(eq(rounds.isDevTestRound, false));
  }
  return conditions;
}

/**
 * The active round's ID ONLY, Redis-cached for CacheTTL.activeRoundId (5s).
 *
 * The hot public endpoints (round-state polled every 15s per client, wheel
 * on every mount) only need the id to build their cache keys, yet each
 * request paid a full getActiveRound() Postgres query even on complete
 * Redis hits. The activeRoundId cache key existed for exactly this and was
 * never read or written; invalidateOnRoundTransition already deletes it.
 *
 * NEVER cache the Round object itself: getActiveRound() returns the
 * DECRYPTED answer, and a serialized copy in Redis would put the secret one
 * cache read away from anything with Redis access. This function selects
 * and stores the integer id (or a no-round sentinel) and nothing else.
 */
const NO_ACTIVE_ROUND_SENTINEL = 'none';

export async function getActiveRoundId(): Promise<number | null> {
  const key = CacheKeys.activeRoundId();
  try {
    const cached = await cacheGet<number | string>(key);
    if (cached !== null && cached !== undefined) {
      if (cached === NO_ACTIVE_ROUND_SENTINEL) return null;
      // Coerce, don't typeof-guard: Upstash round-trips numbers as strings
      // in exactly this deployment (the $WORD price bar froze for two days
      // on a typeof check — commit 0a6299f, word-oracle.ts does the same
      // coercion). A strict number check would silently miss on every
      // request and nullify the cache while logging hits.
      const id = Number(cached);
      if (Number.isInteger(id) && id > 0) return id;
      // Unexpected shape — fall through to the query and rewrite the entry.
    }
  } catch {
    // Cache unavailable — fall through to the query.
  }

  const [row] = await db
    .select({ id: rounds.id })
    .from(rounds)
    .where(and(...activeRoundConditions()))
    .orderBy(desc(rounds.startedAt))
    .limit(1);

  const id = row?.id ?? null;
  await cacheSet(key, id ?? NO_ACTIVE_ROUND_SENTINEL, CacheTTL.activeRoundId).catch(() => {});
  return id;
}

/**
 * Get the current active round (latest unresolved round)
 *
 * Milestone 9.5: Excludes cancelled rounds - a cancelled round is not active
 * Also excludes rounds where winnerFid is set (round locked, payouts in progress)
 */
export async function getActiveRound(): Promise<Round | null> {
  return trackSlowQuery('query:getActiveRound', async () => {
    const conditions = activeRoundConditions();
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
 * Cross-invocation mutex around round creation.
 *
 * Round creation is a check-then-act — read "is there an active round", then
 * create one — reached by three different kinds of caller: the 5-minute cron,
 * the admin Start Round button (which calls createRound directly), and the hot
 * path (pages/api/guess.ts, src/lib/wheel.ts), where between rounds two
 * players guessing in the same second are two concurrent creators. Each would
 * insert a row; the loser's seeding call reverts on the winner's round and its
 * row is cancelled, which burns a public round id — the same cost the onchain
 * preflight in createRound exists to avoid. Held by createRound itself so that
 * every one of those callers is inside it.
 *
 * Held in Redis rather than Postgres because the guard must span serverless
 * invocations that share no connection, and because a long-lived advisory lock
 * would sit idle-in-transaction for the ~25 seconds a round start takes.
 *
 * FAIL-OPEN, matching the rate limiters: with Redis unavailable this behaves
 * exactly as the unlocked code did. A lock that can block round creation
 * outright would be a worse failure than the double-insert it prevents.
 */
const ROUND_CREATION_LOCK_KEY = `${CACHE_PREFIX}lock:create-round`;

/**
 * TTL, not a deadline. Long enough to cover the ~25s start path with room for
 * a slow RPC, short enough that a crashed invocation (which never reaches the
 * release) clears before the next 5-minute tick rather than wedging auto-start.
 */
const ROUND_CREATION_LOCK_TTL_S = 180;

/**
 * Thrown when another invocation is already creating a round.
 *
 * A distinct type because the two callers want opposite things from it:
 * ensureActiveRound wants a round and can answer with the one the other
 * creator is making, while the admin Start Round button asked for a NEW round
 * and must be told it did not get one.
 */
export class RoundCreationInFlightError extends Error {
  readonly code = 'ROUND_CREATION_IN_FLIGHT';

  constructor() {
    super(
      'Cannot create new round: another round creation is already in flight. ' +
      'Wait for it to finish — starting a second one would burn a round id.'
    );
    this.name = 'RoundCreationInFlightError';
  }
}

/**
 * Take the round-creation lock. Returns the token to release with, or null if
 * someone else holds it. Returns a token when Redis is unavailable — see the
 * fail-open note above.
 */
export async function acquireRoundCreationLock(): Promise<string | null> {
  const redis = getRedisClient();
  if (!redis) return 'no-redis';

  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  try {
    const result = await redis.set(ROUND_CREATION_LOCK_KEY, token, {
      nx: true,
      ex: ROUND_CREATION_LOCK_TTL_S,
    });
    return result === 'OK' ? token : null;
  } catch (error) {
    console.error('[rounds] Round-creation lock unavailable, proceeding unlocked:', error);
    return 'lock-error';
  }
}

/**
 * Release the round-creation lock, but only if we still hold it.
 *
 * The read-then-delete is not atomic. The race it leaves is deleting a lock
 * that expired and was retaken between the two calls, which costs nothing the
 * TTL expiry does not already cost — whereas an unconditional delete would let
 * a slow invocation free the NEXT creator's lock.
 */
export async function releaseRoundCreationLock(token: string): Promise<void> {
  const redis = getRedisClient();
  if (!redis || token === 'no-redis' || token === 'lock-error') return;

  try {
    const held = await redis.get<string>(ROUND_CREATION_LOCK_KEY);
    if (held === token) {
      await redis.del(ROUND_CREATION_LOCK_KEY);
    }
  } catch (error) {
    console.error('[rounds] Failed to release the round-creation lock:', error);
  }
}

/**
 * Ensure there is an active round, creating one if necessary
 *
 * Milestone 9.5: Will NOT create a new round if:
 * - Kill switch is active
 * - Dead day is enabled (current round finished, waiting to resume)
 *
 * The check-then-act here is serialized by createRound's own lock: this
 * function is called from the guess and wheel paths as well as the cron, so
 * between rounds two players guessing in the same second are two concurrent
 * creators.
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

  // The lock lives inside createRound (which also re-reads the active round
  // once it holds it), so this is a plain call.
  try {
    return await createRound(opts);
  } catch (error) {
    // This function's contract is "there is an active round", not "I created
    // one". If the refusal was another creator winning the race — or any
    // refusal that arrived after a round became visible — that round IS the
    // answer. A refusal with no round behind it is real and must surface.
    const raced = await getActiveRound();
    if (raced) return raced;
    throw error;
  }
}

/**
 * Alias for getActiveRound() for backwards compatibility
 * @deprecated Use getActiveRound() instead
 */
export const getCurrentRound = getActiveRound;

export type AutoStartCheck =
  | { eligible: true; sinceRoundId: number }
  | {
      eligible: false;
      reason: 'active_round' | 'blocked' | 'no_word_round' | 'cooldown';
      eligibleAt?: Date;
    };

/**
 * Can the cooldown cron start the next round right now?
 *
 * The most recently resolved round anchors the cooldown
 * (resolved_at + getRoundCooldownMs()). Requiring that anchor to be a $WORD
 * round does two jobs at once: it era-gates auto-start (nothing can fire
 * during the paused ETH tail, where the last resolved round is #33), and it
 * keeps the Round 34 launch a manual act — auto-start only begins after the
 * first $WORD round has itself resolved.
 *
 * Read-only. The cron pairs this with ensureActiveRound(), whose own
 * active/blocked guards close the race against a concurrent manual start.
 */
export async function checkAutoStartEligibility(): Promise<AutoStartCheck> {
  const active = await getActiveRound();
  if (active) return { eligible: false, reason: 'active_round' };

  const blocked = await shouldBlockNewRoundCreation();
  if (blocked) return { eligible: false, reason: 'blocked' };

  const anchorConditions = [isNotNull(rounds.resolvedAt)];
  if (!isDevModeEnabled()) {
    anchorConditions.push(eq(rounds.isDevTestRound, false));
  }
  const [lastResolved] = await db
    .select({
      id: rounds.id,
      resolvedAt: rounds.resolvedAt,
      prizeCurrency: rounds.prizeCurrency,
    })
    .from(rounds)
    .where(and(...anchorConditions))
    .orderBy(desc(rounds.resolvedAt))
    .limit(1);

  if (!lastResolved?.resolvedAt || lastResolved.prizeCurrency !== 'word') {
    return { eligible: false, reason: 'no_word_round' };
  }

  const eligibleAt = new Date(lastResolved.resolvedAt.getTime() + getRoundCooldownMs());
  if (Date.now() < eligibleAt.getTime()) {
    return { eligible: false, reason: 'cooldown', eligibleAt };
  }

  return { eligible: true, sinceRoundId: lastResolved.id };
}

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
