/**
 * Top-10 Guesser Tiered Payout System
 * Milestone 6.9b - Tiered distribution for top guessers
 *
 * Allocation schedule (basis points, total = 10000):
 * - Rank 1: 19% (1900 bps)
 * - Rank 2: 16% (1600 bps)
 * - Rank 3: 14% (1400 bps)
 * - Rank 4: 11% (1100 bps)
 * - Rank 5: 10% (1000 bps)
 * - Ranks 6-10: 6% each (600 bps each)
 */

/** Basis points allocation for ranks 1-10 */
const BPS = [1900n, 1600n, 1400n, 1100n, 1000n, 600n, 600n, 600n, 600n, 600n] as const;

/** Total basis points (should equal 10000) */
const BPS_TOTAL = 10000n;

export interface TopGuesserPayout {
  address: string;
  amountWei: bigint;
}

export class TopGuesserPayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TopGuesserPayoutError';
  }
}

/**
 * Calculate tiered payouts for top guessers
 *
 * @param topGuessersOrdered - Addresses ordered best → worst (length 1-10)
 * @param TWei - Total top-10 pool in wei (source of truth)
 * @returns Array of payouts where sum(amountWei) === TWei exactly
 * @throws TopGuesserPayoutError if inputs are invalid
 */
export function calculateTopGuesserPayouts(
  topGuessersOrdered: string[],
  TWei: bigint
): TopGuesserPayout[] {
  const N = topGuessersOrdered.length;

  // Validation
  if (N === 0) {
    throw new TopGuesserPayoutError('topGuessersOrdered must have at least 1 address');
  }
  if (N > 10) {
    throw new TopGuesserPayoutError('topGuessersOrdered cannot exceed 10 addresses');
  }
  if (TWei < 0n) {
    throw new TopGuesserPayoutError('TWei cannot be negative');
  }

  // Check for invalid or duplicate addresses
  const seen = new Set<string>();
  for (const addr of topGuessersOrdered) {
    if (!addr || typeof addr !== 'string') {
      throw new TopGuesserPayoutError(`Invalid address: ${addr}`);
    }
    const normalized = addr.toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(normalized)) {
      throw new TopGuesserPayoutError(`Invalid Ethereum address format: ${addr}`);
    }
    if (seen.has(normalized)) {
      throw new TopGuesserPayoutError(`Duplicate address: ${addr}`);
    }
    seen.add(normalized);
  }

  // Handle zero pool
  if (TWei === 0n) {
    return topGuessersOrdered.map(address => ({ address, amountWei: 0n }));
  }

  // Get BPS for the N participants
  const participantBps = BPS.slice(0, N);

  // Calculate sum of BPS for normalization
  const bpsSum = participantBps.reduce((sum, bps) => sum + bps, 0n);

  // Normalize BPS to sum to 10000 (when N < 10)
  const normalizedBps: bigint[] = participantBps.map(bps =>
    (bps * BPS_TOTAL) / bpsSum
  );

  // Calculate payouts using normalized BPS
  const payouts: TopGuesserPayout[] = [];
  let allocated = 0n;

  for (let i = 0; i < N; i++) {
    const amountWei = (TWei * normalizedBps[i]) / BPS_TOTAL;
    payouts.push({
      address: topGuessersOrdered[i],
      amountWei,
    });
    allocated += amountWei;
  }

  // Add dust to rank 1 (index 0)
  const dust = TWei - allocated;
  if (dust > 0n) {
    payouts[0].amountWei += dust;
  }

  // Assert sum equals TWei exactly
  const totalPaid = payouts.reduce((sum, p) => sum + p.amountWei, 0n);
  if (totalPaid !== TWei) {
    throw new TopGuesserPayoutError(
      `Payout sum mismatch: expected ${TWei}, got ${totalPaid}`
    );
  }

  // Assert all payouts are non-negative
  for (const payout of payouts) {
    if (payout.amountWei < 0n) {
      throw new TopGuesserPayoutError(
        `Negative payout for ${payout.address}: ${payout.amountWei}`
      );
    }
  }

  return payouts;
}

/**
 * Get the BPS allocation for a given number of participants
 * Useful for debugging/display purposes
 *
 * @param N - Number of participants (1-10)
 * @returns Normalized BPS array that sums to 10000
 */
export function getNormalizedBpsForN(N: number): bigint[] {
  if (N < 1 || N > 10) {
    throw new TopGuesserPayoutError('N must be between 1 and 10');
  }

  const participantBps = BPS.slice(0, N);
  const bpsSum = participantBps.reduce((sum, bps) => sum + bps, 0n);

  return participantBps.map(bps => (bps * BPS_TOTAL) / bpsSum);
}

/**
 * Format payouts for logging
 */
export function formatPayoutsForLog(payouts: TopGuesserPayout[]): string {
  return payouts
    .map((p, i) => `  #${i + 1}: ${p.address.slice(0, 10)}... → ${p.amountWei} wei`)
    .join('\n');
}
