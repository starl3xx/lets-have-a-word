/**
 * WordJackpot / WordPackSales Contract Integration
 *
 * Backend utilities for the $WORD-denominated economy introduced at round 34.
 *
 * This is the token-denominated counterpart to `jackpot-contract.ts`, which
 * stays in place unchanged: rounds 1-33 resolved in ETH through
 * JackpotManagerV3 and the archive still reads them from there. Nothing in this
 * file touches that contract.
 *
 * Two contracts, split by responsibility:
 *
 * - WordJackpot  — UUPS proxy holding the $WORD prize escrow. Seeds a round
 *                  from a USD target using its own stored price, tops the pool
 *                  up from converted pack revenue, and pays the 80/10/5/5 split.
 * - WordPackSales — immutable, holds nothing long-term. Takes ETH for guess
 *                  packs and emits the event that makes a purchase
 *                  attributable to a payer.
 *
 * The recurring theme in here is refusing early. Every write pre-flights the
 * same conditions the contract enforces, because a custom-error revert costs
 * gas and surfaces as an opaque selector, while a JS check costs nothing and
 * says what is wrong.
 */

import { ethers, Contract, Wallet } from 'ethers';
import { getBaseProvider, getSepoliaProvider } from './word-token';
import { sendWithBuilderCode } from './builder-code';
import { fetchWordTokenMarketCap } from './word-oracle';

/**
 * WordJackpot ABI.
 *
 * The `error` entries are not decoration: WordJackpot reverts with custom
 * errors, and without them in the ABI ethers reports failures as an
 * undecodable selector like `0x1f2a2005`. With them, a failed resolve says
 * `PayoutMismatch(78125000000000000000000000, 78125000000000000000000001)`.
 */
const WORD_JACKPOT_ABI = [
  // Accounting
  'function wordToken() view returns (address)',
  'function operator() view returns (address)',
  'function treasury() view returns (address)',
  'function owner() view returns (address)',
  'function pool() view returns (uint256)',
  'function carry() view returns (uint256)',
  'function totalClaimable() view returns (uint256)',
  'function claimable(address) view returns (uint256)',
  'function unallocated() view returns (uint256)',
  'function solvency() view returns (uint256 balance, uint256 pool_, uint256 carry_, uint256 claimable_, uint256 unallocated_)',
  'function paused() view returns (bool)',

  // Oracle
  'function priceE18() view returns (uint256)',
  'function priceUpdatedAt() view returns (uint64)',
  'function maxPriceAge() view returns (uint64)',
  'function isPriceStale() view returns (bool)',
  'function seedTokensFor(uint256 usdCents) view returns (uint256)',
  'function setWordPrice(uint256 priceE18)',

  // Round lifecycle
  'function activeRoundId() view returns (uint256)',
  'function minSeedTokens() view returns (uint256)',
  'function maxSeedTokens() view returns (uint256)',
  'function MAX_RECIPIENTS() view returns (uint256)',
  'function rounds(uint256) view returns (uint256 startingPool, uint256 finalPool, uint256 winnerPayout, bytes32 commitHash, uint64 startedAt, uint64 resolvedAt, bool active)',
  'function startRound(uint256 roundId, uint256 seedUsdCents, bytes32 commitHash)',
  'function topUpPool(uint256 amount)',
  'function resolveRound(uint256 roundId, address[] recipients, uint256[] amounts, uint256 carryForNextRound)',
  'function claim()',
  'function fund(uint256 amount)',

  // Admin
  'function sweepUnallocated(address to, uint256 amount)',
  'function setOperator(address operator)',
  'function setSeedBounds(uint256 min, uint256 max)',
  'function setMaxPriceAge(uint64 maxPriceAge)',
  'function pause()',
  'function unpause()',

  // Events
  'event PoolFunded(address indexed from, uint256 amount, uint256 unallocated)',
  'event WordPriceUpdated(uint256 priceE18, uint64 updatedAt)',
  'event RoundStarted(uint256 indexed roundId, uint256 seedTokens, uint256 seedUsdCents, bytes32 commitHash)',
  'event PoolToppedUp(uint256 indexed roundId, uint256 amount, uint256 newPool)',
  'event RoundResolved(uint256 indexed roundId, uint256 totalPaid, uint256 carryForNextRound)',
  'event PayoutSent(uint256 indexed roundId, address indexed to, uint256 amount)',
  'event PayoutDeferred(uint256 indexed roundId, address indexed to, uint256 amount)',
  'event Claimed(address indexed to, uint256 amount)',
  'event UnallocatedSwept(address indexed to, uint256 amount)',

  // Custom errors — see note above
  'error NotOperator()',
  'error ZeroAmount()',
  'error ZeroAddress()',
  'error RoundAlreadyActive()',
  'error RoundNotActive()',
  'error WrongRound()',
  'error PriceUnset()',
  'error PriceStale()',
  'error SeedOutOfBounds(uint256 seedTokens)',
  'error InsufficientUnallocated(uint256 requested, uint256 available)',
  'error ArrayLengthMismatch()',
  'error TooManyRecipients()',
  'error PayoutMismatch(uint256 provided, uint256 expected)',
  'error NothingToClaim()',
  'error TransferFailed()',
];

const WORD_PACK_SALES_ABI = [
  'function treasury() view returns (address)',
  'function buyPacks(uint32 packCount, uint256 roundId) payable',
  'function withdraw()',
  'event PacksPurchased(address indexed payer, uint256 indexed roundId, uint32 packCount, uint256 amount)',
  'event Withdrawn(address indexed treasury, uint256 amount)',
  'error ZeroTreasury()',
  'error ZeroPayment()',
  'error ZeroPackCount()',
  'error NothingToWithdraw()',
  'error WithdrawFailed()',
];

/**
 * The amount arithmetic lives in `word-amounts.ts` so the client can import it
 * without dragging in `wallet-identity` -> `db` and the operator key path.
 * Re-exported here so backend callers have one import.
 */
export {
  usdPriceToE18,
  e18PriceToUsd,
  tokensForUsdCents,
  usdCentsForTokens,
  formatWordAmount,
  formatUsdCents,
  validateWordPayouts,
  MAX_PAYOUT_RECIPIENTS,
  type WordPayoutRecipient,
  type PayoutValidation,
} from './word-amounts';

import {
  usdPriceToE18,
  tokensForUsdCents,
  formatWordAmount,
  validateWordPayouts,
  type WordPayoutRecipient,
} from './word-amounts';

// =============================================================================
// Configuration
// =============================================================================

export interface WordJackpotConfig {
  wordJackpotAddress: string;
  wordPackSalesAddress: string;
  treasuryWallet: string;
  operatorWallet: string;
}

function normalizeAddress(addr: string): string {
  return ethers.getAddress(addr.toLowerCase());
}

export function getWordJackpotConfig(): WordJackpotConfig {
  const wordJackpotAddress = process.env.WORD_JACKPOT_ADDRESS;
  if (!wordJackpotAddress) {
    throw new Error('WORD_JACKPOT_ADDRESS not configured');
  }

  const wordPackSalesAddress = process.env.WORD_PACK_SALES_ADDRESS;
  if (!wordPackSalesAddress) {
    throw new Error('WORD_PACK_SALES_ADDRESS not configured');
  }

  return {
    wordJackpotAddress: normalizeAddress(wordJackpotAddress),
    wordPackSalesAddress: normalizeAddress(wordPackSalesAddress),
    treasuryWallet: normalizeAddress(
      process.env.PRIZE_POOL_WALLET || '0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB'
    ),
    operatorWallet: normalizeAddress(
      process.env.OPERATOR_WALLET || '0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38'
    ),
  };
}

export function getSepoliaWordJackpotConfig(): WordJackpotConfig {
  const wordJackpotAddress =
    process.env.SEPOLIA_WORD_JACKPOT_ADDRESS || process.env.WORD_JACKPOT_ADDRESS;
  if (!wordJackpotAddress) {
    throw new Error('SEPOLIA_WORD_JACKPOT_ADDRESS or WORD_JACKPOT_ADDRESS not configured');
  }

  const wordPackSalesAddress =
    process.env.SEPOLIA_WORD_PACK_SALES_ADDRESS || process.env.WORD_PACK_SALES_ADDRESS;
  if (!wordPackSalesAddress) {
    throw new Error('SEPOLIA_WORD_PACK_SALES_ADDRESS or WORD_PACK_SALES_ADDRESS not configured');
  }

  return {
    wordJackpotAddress: normalizeAddress(wordJackpotAddress),
    wordPackSalesAddress: normalizeAddress(wordPackSalesAddress),
    treasuryWallet: normalizeAddress(
      process.env.PRIZE_POOL_WALLET || '0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB'
    ),
    operatorWallet: normalizeAddress(
      process.env.OPERATOR_WALLET || '0xaee1ee60F8534CbFBbe856fEb9655D0c4ed35d38'
    ),
  };
}

/**
 * Whether the $WORD contracts are configured at all.
 *
 * Round 34 is the cutover; before it, callers fall back to the ETH path. This
 * deliberately tests configuration rather than a separate boolean env var, so
 * there is no state where the switch reads "on" but the addresses are missing.
 */
export function isWordEconomyConfigured(): boolean {
  return Boolean(process.env.WORD_JACKPOT_ADDRESS && process.env.WORD_PACK_SALES_ADDRESS);
}

// =============================================================================
// Contract instances
// =============================================================================

export function getWordJackpotReadOnly(): Contract {
  const config = getWordJackpotConfig();
  return new Contract(config.wordJackpotAddress, WORD_JACKPOT_ABI, getBaseProvider());
}

export function getWordJackpotWithOperator(): Contract {
  const config = getWordJackpotConfig();
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not configured for contract writes');
  }
  const wallet = new Wallet(operatorPrivateKey, getBaseProvider());
  return new Contract(config.wordJackpotAddress, WORD_JACKPOT_ABI, wallet);
}

export function getWordJackpotWithOwner(): Contract {
  const config = getWordJackpotConfig();
  const ownerPrivateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!ownerPrivateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY not configured for owner operations');
  }
  const wallet = new Wallet(ownerPrivateKey, getBaseProvider());
  return new Contract(config.wordJackpotAddress, WORD_JACKPOT_ABI, wallet);
}

export function getSepoliaWordJackpotReadOnly(): Contract {
  const config = getSepoliaWordJackpotConfig();
  return new Contract(config.wordJackpotAddress, WORD_JACKPOT_ABI, getSepoliaProvider());
}

export function getSepoliaWordJackpotWithOperator(): Contract {
  const config = getSepoliaWordJackpotConfig();
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not configured for contract writes');
  }
  const wallet = new Wallet(operatorPrivateKey, getSepoliaProvider());
  return new Contract(config.wordJackpotAddress, WORD_JACKPOT_ABI, wallet);
}

export function getWordPackSalesReadOnly(): Contract {
  const config = getWordJackpotConfig();
  return new Contract(config.wordPackSalesAddress, WORD_PACK_SALES_ABI, getBaseProvider());
}

// =============================================================================
// Reads
// =============================================================================

export interface WordJackpotSolvency {
  balanceWei: bigint;
  poolWei: bigint;
  carryWei: bigint;
  claimableWei: bigint;
  unallocatedWei: bigint;
}

/**
 * The contract's full accounting position.
 *
 * `unallocated` is the number that matters operationally: it is the tranche
 * left to seed future rounds, and the low-balance alert watches it. Everything
 * else is already owed to players.
 */
export async function getWordJackpotSolvency(): Promise<WordJackpotSolvency> {
  const contract = getWordJackpotReadOnly();
  const [balance, pool, carry, claimable, unallocated] = await contract.solvency();
  return {
    balanceWei: balance,
    poolWei: pool,
    carryWei: carry,
    claimableWei: claimable,
    unallocatedWei: unallocated,
  };
}

export interface WordRoundInfo {
  roundId: number;
  startingPoolWei: bigint;
  finalPoolWei: bigint;
  winnerPayoutWei: bigint;
  commitHash: string;
  startedAt: Date | null;
  resolvedAt: Date | null;
  active: boolean;
}

export async function getWordRound(roundId: number): Promise<WordRoundInfo> {
  const contract = getWordJackpotReadOnly();
  const r = await contract.rounds(roundId);
  return {
    roundId,
    startingPoolWei: r.startingPool,
    finalPoolWei: r.finalPool,
    winnerPayoutWei: r.winnerPayout,
    commitHash: r.commitHash,
    startedAt: r.startedAt > 0n ? new Date(Number(r.startedAt) * 1000) : null,
    resolvedAt: r.resolvedAt > 0n ? new Date(Number(r.resolvedAt) * 1000) : null,
    active: r.active,
  };
}

export async function getActiveWordRoundId(): Promise<number> {
  const contract = getWordJackpotReadOnly();
  return Number(await contract.activeRoundId());
}

export interface WordPriceState {
  priceE18: bigint;
  priceUsd: number;
  updatedAt: Date | null;
  maxPriceAgeSeconds: number;
  isStale: boolean;
}

export async function getWordPriceOnChain(): Promise<WordPriceState> {
  const contract = getWordJackpotReadOnly();
  const [priceE18, priceUpdatedAt, maxPriceAge, isStale] = await Promise.all([
    contract.priceE18(),
    contract.priceUpdatedAt(),
    contract.maxPriceAge(),
    contract.isPriceStale(),
  ]);

  return {
    priceE18,
    priceUsd: Number(ethers.formatUnits(priceE18, 18)),
    updatedAt: priceUpdatedAt > 0n ? new Date(Number(priceUpdatedAt) * 1000) : null,
    maxPriceAgeSeconds: Number(maxPriceAge),
    isStale,
  };
}

export async function getSeedBounds(): Promise<{ minWei: bigint; maxWei: bigint }> {
  const contract = getWordJackpotReadOnly();
  const [minWei, maxWei] = await Promise.all([
    contract.minSeedTokens(),
    contract.maxSeedTokens(),
  ]);
  return { minWei, maxWei };
}

export async function getMaxRecipients(): Promise<number> {
  const contract = getWordJackpotReadOnly();
  return Number(await contract.MAX_RECIPIENTS());
}

export async function getPendingClaim(address: string): Promise<bigint> {
  const contract = getWordJackpotReadOnly();
  return await contract.claimable(address);
}

// =============================================================================
// Writes
// =============================================================================

/**
 * Push the current oracle price onchain.
 *
 * The contract needs its own copy because it computes seed size itself — if the
 * token amount were passed in, the USD peg would be a comment rather than a
 * property. This is what the oracle cron calls before a round starts.
 *
 * Returns null when the oracle has nothing to say, rather than pushing a
 * guess. A missing update leaves the previous price in place and eventually
 * trips the contract's own staleness check, which fails a round start loudly.
 */
export async function syncWordPriceOnChain(): Promise<{
  txHash: string;
  priceE18: bigint;
  priceUsd: number;
} | null> {
  const marketData = await fetchWordTokenMarketCap();
  if (!marketData || marketData.priceUsd <= 0) {
    console.warn('[WORD-JACKPOT] Oracle returned no usable price — leaving the onchain price alone');
    return null;
  }

  const priceE18 = usdPriceToE18(marketData.priceUsd);

  const contract = getWordJackpotWithOperator();
  console.log(
    `[WORD-JACKPOT] Pushing $WORD price ${marketData.priceUsd.toExponential(4)} ` +
      `(${priceE18} e18) from ${marketData.source}`
  );

  const tx = await sendWithBuilderCode(contract, 'setWordPrice', [priceE18]);
  await tx.wait();

  return { txHash: tx.hash, priceE18, priceUsd: marketData.priceUsd };
}

/**
 * Best available $WORD price for pricing a reward, or null if there is none.
 *
 * Prefers WordJackpot's stored price: it is one cheap call, and it is the same
 * figure the round was seeded against, so a reward and its round agree on what
 * a dollar is worth. Falls back to a live oracle fetch when the contract is
 * unconfigured or its price has gone stale.
 *
 * NOTE the deliberate asymmetry with round seeding. `startWordRoundOnChain`
 * refuses to proceed on a stale price, because a mispriced seed is a large,
 * irreversible commitment. A bonus-word reward is small and frequent, so
 * returning null here lets the caller fall back to the legacy fixed token
 * amount rather than denying a player a reward they earned. Failing loud is
 * right for the seed; failing soft is right for the reward.
 */
export async function getRewardPriceE18(): Promise<bigint | null> {
  if (isWordEconomyConfigured()) {
    try {
      const onchain = await getWordPriceOnChain();
      if (!onchain.isStale && onchain.priceE18 > 0n) {
        return onchain.priceE18;
      }
      console.warn('[WORD-JACKPOT] Onchain price stale — falling back to the live oracle');
    } catch (error) {
      console.warn('[WORD-JACKPOT] Could not read the onchain price:', error);
    }
  }

  try {
    const market = await fetchWordTokenMarketCap();
    if (market && market.priceUsd > 0) {
      return usdPriceToE18(market.priceUsd);
    }
  } catch (error) {
    console.warn('[WORD-JACKPOT] Oracle price fetch failed:', error);
  }

  return null;
}

export interface StartWordRoundResult {
  txHash: string;
  roundId: number;
  seedTokensWei: bigint;
  seedUsdCents: number;
  priceE18: bigint;
}

/**
 * Start a round, seeded with a USD-denominated amount of $WORD.
 *
 * Every failure mode is checked here first. The contract enforces all of it
 * too, but its custom errors cost a reverted transaction to read and the
 * distinction between "price is stale", "seed is out of bounds" and "tranche is
 * empty" is exactly what an operator needs at 3am.
 */
export async function startWordRoundOnChain(
  roundId: number,
  seedUsdCents: number,
  commitHash: string
): Promise<StartWordRoundResult> {
  if (!Number.isInteger(roundId) || roundId <= 0) {
    throw new Error(`Invalid round id: ${roundId}`);
  }
  if (!Number.isInteger(seedUsdCents) || seedUsdCents <= 0) {
    throw new Error(`Invalid seed target: ${seedUsdCents} cents`);
  }
  // The DB stores commit hashes as bare hex in a varchar(64); the ETH path
  // normalizes the prefix inside the contract call rather than at every call
  // site, so this does the same.
  const bytes32Hash = commitHash.startsWith('0x') ? commitHash : `0x${commitHash}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(bytes32Hash)) {
    throw new Error(`Commit hash must be a 32-byte hex string, got: ${commitHash}`);
  }

  const readOnly = getWordJackpotReadOnly();

  const [activeRoundId, existing, price, bounds, solvency] = await Promise.all([
    readOnly.activeRoundId(),
    readOnly.rounds(roundId),
    getWordPriceOnChain(),
    getSeedBounds(),
    getWordJackpotSolvency(),
  ]);

  if (activeRoundId !== 0n) {
    throw new Error(
      `Cannot start round ${roundId}: round ${activeRoundId} is still active onchain`
    );
  }
  if (existing.startedAt > 0n) {
    throw new Error(`Round ${roundId} has already been started onchain — round ids are one-shot`);
  }
  if (price.isStale) {
    throw new Error(
      `Cannot start round ${roundId}: the onchain $WORD price is stale ` +
        `(last updated ${price.updatedAt?.toISOString() ?? 'never'}, max age ` +
        `${price.maxPriceAgeSeconds}s). Run the oracle sync first.`
    );
  }

  const seedTokensWei = tokensForUsdCents(BigInt(seedUsdCents), price.priceE18);

  if (seedTokensWei < bounds.minWei || seedTokensWei > bounds.maxWei) {
    throw new Error(
      `Seed of ${formatWordAmount(seedTokensWei)} $WORD for $${(seedUsdCents / 100).toFixed(2)} ` +
        `is outside the contract bounds [${formatWordAmount(bounds.minWei)}, ` +
        `${formatWordAmount(bounds.maxWei)}]. At $${price.priceUsd.toExponential(4)} per token ` +
        `this usually means the oracle is wrong, not that the bounds are.`
    );
  }

  // The contract spends carry first, then the unallocated tranche.
  const fromCarry = solvency.carryWei >= seedTokensWei ? seedTokensWei : solvency.carryWei;
  const needed = seedTokensWei - fromCarry;
  if (needed > solvency.unallocatedWei) {
    throw new Error(
      `Insufficient tranche to seed round ${roundId}: need ${formatWordAmount(needed)} $WORD ` +
        `beyond the ${formatWordAmount(solvency.carryWei)} carry, but only ` +
        `${formatWordAmount(solvency.unallocatedWei)} is unallocated. Fund the contract from ` +
        `the treasury.`
    );
  }

  const contract = getWordJackpotWithOperator();
  console.log(
    `[WORD-JACKPOT] Starting round ${roundId} — seed $${(seedUsdCents / 100).toFixed(2)} = ` +
      `${formatWordAmount(seedTokensWei)} $WORD (${formatWordAmount(fromCarry)} from carry, ` +
      `${formatWordAmount(needed)} from tranche)`
  );

  const tx = await sendWithBuilderCode(contract, 'startRound', [
    roundId,
    seedUsdCents,
    bytes32Hash,
  ]);
  const receipt = await tx.wait();
  console.log(`[WORD-JACKPOT] Round ${roundId} started — block ${receipt?.blockNumber}`);

  return {
    txHash: tx.hash,
    roundId,
    seedTokensWei,
    seedUsdCents,
    priceE18: price.priceE18,
  };
}

/**
 * Credit converted pack revenue to the live round's pool.
 *
 * The tokens must already be sitting unallocated in the contract — this moves
 * them from tranche to pool, it does not transfer anything in. Funding happens
 * separately via `fund()` from the treasury.
 */
export async function topUpWordPoolOnChain(amountWei: bigint): Promise<string> {
  if (amountWei <= 0n) {
    throw new Error('Top-up amount must be positive');
  }

  const solvency = await getWordJackpotSolvency();
  if (amountWei > solvency.unallocatedWei) {
    throw new Error(
      `Cannot credit ${formatWordAmount(amountWei)} $WORD to the pool: only ` +
        `${formatWordAmount(solvency.unallocatedWei)} is unallocated`
    );
  }

  const contract = getWordJackpotWithOperator();
  const tx = await sendWithBuilderCode(contract, 'topUpPool', [amountWei]);
  await tx.wait();
  console.log(`[WORD-JACKPOT] Pool credited ${formatWordAmount(amountWei)} $WORD — tx ${tx.hash}`);
  return tx.hash;
}

/**
 * Resolve a round, paying every recipient and reserving the carry.
 *
 * Note what is absent: the 1-wei simulation loop that `economics.ts` runs
 * before an ETH resolve to find recipients who cannot receive. That existed
 * because JackpotManagerV3 reverts the whole distribution if a single send
 * fails. WordJackpot credits a failed transfer to `claimable` instead, so one
 * bad recipient costs that recipient an extra click, not everyone else their
 * payout.
 */
export async function resolveWordRoundOnChain(
  roundId: number,
  payouts: WordPayoutRecipient[],
  carryForNextRoundWei: bigint
): Promise<string> {
  const readOnly = getWordJackpotReadOnly();
  const [activeRoundId, poolWei] = await Promise.all([
    readOnly.activeRoundId(),
    readOnly.pool(),
  ]);

  if (Number(activeRoundId) !== roundId) {
    throw new Error(
      `Cannot resolve round ${roundId}: the contract's active round is ` +
        `${activeRoundId === 0n ? 'none' : activeRoundId}`
    );
  }

  const validation = validateWordPayouts(payouts, carryForNextRoundWei, poolWei);
  if (!validation.valid) {
    throw new Error(
      `Refusing to resolve round ${roundId} — ${validation.errors.length} problem(s):\n` +
        validation.errors.map((e) => `  - ${e}`).join('\n')
    );
  }

  console.log(`[WORD-JACKPOT] Resolving round ${roundId} with ${payouts.length} payouts:`);
  for (const p of payouts) {
    console.log(
      `  - ${p.role}${p.fid ? ` (FID ${p.fid})` : ''}: ${p.address} -> ` +
        `${formatWordAmount(p.amountWei)} $WORD`
    );
  }
  console.log(`  - Carry for next round: ${formatWordAmount(carryForNextRoundWei)} $WORD`);

  const contract = getWordJackpotWithOperator();
  const tx = await sendWithBuilderCode(contract, 'resolveRound', [
    roundId,
    payouts.map((p) => p.address),
    payouts.map((p) => p.amountWei),
    carryForNextRoundWei,
  ]);
  const receipt = await tx.wait();

  // A deferred payout is not a failure, but it is the thing an operator most
  // needs to know about after a resolve: that wallet holds a claim, not tokens.
  if (receipt) {
    const iface = new ethers.Interface(WORD_JACKPOT_ABI);
    for (const log of receipt.logs) {
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'PayoutDeferred') {
          console.warn(
            `[WORD-JACKPOT] Payout to ${parsed.args.to} of ` +
              `${formatWordAmount(parsed.args.amount)} $WORD was deferred — they must call claim()`
          );
        }
      } catch {
        // Not one of ours
      }
    }
  }

  console.log(`[WORD-JACKPOT] Round ${roundId} resolved — block ${receipt?.blockNumber}`);
  return tx.hash;
}

// =============================================================================
// Pack purchase verification
// =============================================================================

export interface PackPurchaseVerification {
  valid: boolean;
  /**
   * The address that actually paid. Unlike JackpotManagerV3's GuessesPurchased,
   * which records a caller-supplied `player` argument, this comes from
   * msg.sender and cannot be spoofed.
   */
  payer?: string;
  packCount?: number;
  roundId?: number;
  /** Exact wei paid, decimal string. Compare costs against this, never ethAmount. */
  weiAmount?: string;
  /** Formatted for display only — parsing it back loses precision. */
  ethAmount?: string;
  error?: string;
}

/**
 * Verify a WordPackSales purchase from its transaction receipt.
 *
 * `receipt.to` is deliberately not checked: Farcaster users are largely on
 * ERC-4337 smart accounts, so the transaction goes to the EntryPoint and the
 * purchase appears as an internal call. What is checked is that a
 * PacksPurchased log was emitted *by our contract address*, which is the part
 * that cannot be forged.
 */
export async function verifyPackPurchaseTransaction(
  txHash: string,
  expectedPayer?: string,
  expectedRoundId?: number
): Promise<PackPurchaseVerification> {
  try {
    const config = getWordJackpotConfig();
    const provider = getBaseProvider();

    const receipt = await provider.getTransactionReceipt(txHash);
    if (!receipt) {
      return { valid: false, error: 'Transaction not found or not yet mined' };
    }
    if (receipt.status !== 1) {
      return { valid: false, error: 'Transaction reverted' };
    }

    const iface = new ethers.Interface(WORD_PACK_SALES_ABI);
    let purchaseEvent: ethers.LogDescription | null = null;

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== config.wordPackSalesAddress.toLowerCase()) continue;
      try {
        const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === 'PacksPurchased') {
          purchaseEvent = parsed;
          break;
        }
      } catch {
        // Not this event
      }
    }

    if (!purchaseEvent) {
      return { valid: false, error: 'No PacksPurchased event found in transaction' };
    }

    const payer = purchaseEvent.args.payer as string;
    const roundId = Number(purchaseEvent.args.roundId);
    const packCount = Number(purchaseEvent.args.packCount);
    const weiAmount = (purchaseEvent.args.amount as bigint).toString();
    const ethAmount = ethers.formatEther(purchaseEvent.args.amount);

    if (expectedPayer && payer.toLowerCase() !== expectedPayer.toLowerCase()) {
      return {
        valid: false,
        error: `Payer mismatch: expected ${expectedPayer}, got ${payer}`,
        payer,
        packCount,
        roundId,
        weiAmount,
        ethAmount,
      };
    }

    if (expectedRoundId !== undefined && roundId !== expectedRoundId) {
      return {
        valid: false,
        error: `Round mismatch: expected ${expectedRoundId}, got ${roundId}`,
        payer,
        packCount,
        roundId,
        weiAmount,
        ethAmount,
      };
    }

    return { valid: true, payer, packCount, roundId, weiAmount, ethAmount };
  } catch (error) {
    console.error('[WORD-JACKPOT] Error verifying pack purchase:', error);
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Unknown verification error',
    };
  }
}

/**
 * ETH sitting in WordPackSales awaiting the batch conversion to $WORD.
 *
 * This is one half of the invariant the whole model rests on:
 *   tranche ≈ initial − (seeds + pool credits) + converted ETH
 * A balance that keeps climbing means conversions have stopped running, which
 * shows up as a draining tranche long before anything else notices.
 */
export async function getPackSalesBalanceWei(): Promise<bigint> {
  const config = getWordJackpotConfig();
  return await getBaseProvider().getBalance(config.wordPackSalesAddress);
}

/**
 * Sweep accumulated pack ETH to the treasury.
 *
 * Permissionless onchain — the destination is immutable, so this can only send
 * funds where they were always going. The operator key is used here purely
 * because it is the one the backend holds.
 */
export async function withdrawPackSalesOnChain(): Promise<string> {
  const balance = await getPackSalesBalanceWei();
  if (balance === 0n) {
    throw new Error('WordPackSales holds no ETH to withdraw');
  }

  const config = getWordJackpotConfig();
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not configured for contract writes');
  }

  const wallet = new Wallet(operatorPrivateKey, getBaseProvider());
  const contract = new Contract(config.wordPackSalesAddress, WORD_PACK_SALES_ABI, wallet);

  console.log(`[WORD-JACKPOT] Withdrawing ${ethers.formatEther(balance)} ETH to the treasury`);
  const tx = await sendWithBuilderCode(contract, 'withdraw', []);
  await tx.wait();
  return tx.hash;
}
