/**
 * Refund Processing Module
 * Milestone 9.5: Kill Switch refund support
 *
 * Handles aggregation and processing of refunds when a round is cancelled.
 * Refunds are per-user (aggregated from individual pack purchases).
 */

import * as Sentry from '@sentry/nextjs';
import { ethers, Wallet } from 'ethers';
import { db } from '../db';
import {
  packPurchases,
  refunds,
  rounds,
  operationalEvents,
  type RefundRow,
  type RefundStatus,
  type OperationalEventType,
} from '../db/schema';
import { eq, sql, and, inArray } from 'drizzle-orm';
import { acquireRefundLock, releaseRefundLock } from './operational';
import { resolveWalletIdentity } from './wallet-identity';
import { getBaseProvider } from './clankton';

// ============================================================
// Types
// ============================================================

/**
 * Refund preview for a single user
 */
export interface UserRefundPreview {
  fid: number;
  totalAmountEth: string;
  totalAmountWei: string;
  purchaseCount: number;
  purchaseIds: number[];
}

/**
 * Preview of all refunds for a cancelled round
 */
export interface RefundPreview {
  roundId: number;
  totalRefundEth: string;
  totalRefundWei: string;
  userCount: number;
  users: UserRefundPreview[];
}

/**
 * Refund processing result
 */
export interface RefundProcessingResult {
  success: boolean;
  roundId: number;
  totalProcessed: number;
  pendingCount: number;
  sentCount: number;
  failedCount: number;
  errors: string[];
}

// ============================================================
// On-chain Refund Transfer
// ============================================================

/**
 * Get operator wallet for sending refunds
 * Uses the same operator private key as jackpot contract operations
 */
function getOperatorWallet(): Wallet {
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not configured for refunds');
  }
  const provider = getBaseProvider();
  return new Wallet(operatorPrivateKey, provider);
}

/**
 * Send an onchain ETH refund to a user's Farcaster custody address
 *
 * @param fid - User's Farcaster ID
 * @param amountWei - Amount to refund in wei
 * @returns Transaction hash if successful
 * @throws Error if transaction fails
 */
async function sendRefundTransaction(
  fid: number,
  amountWei: string
): Promise<string> {
  // Resolve user's wallet address
  const identity = await resolveWalletIdentity(fid);
  if (!identity.isValid) {
    throw new Error(`Cannot resolve wallet for FID ${fid}: ${identity.error}`);
  }

  const recipientAddress = identity.walletAddress;
  const wallet = getOperatorWallet();
  const amount = BigInt(amountWei);

  // Check operator wallet balance
  const balance = await wallet.provider!.getBalance(wallet.address);
  if (balance < amount) {
    throw new Error(
      `Insufficient operator balance: ${ethers.formatEther(balance)} ETH, need ${ethers.formatEther(amount)} ETH`
    );
  }

  console.log(
    `[Refunds] Sending ${ethers.formatEther(amount)} ETH to FID ${fid} (${recipientAddress})`
  );

  // Send transaction
  const tx = await wallet.sendTransaction({
    to: recipientAddress,
    value: amount,
  });

  console.log(`[Refunds] Transaction submitted: ${tx.hash}`);

  // Wait for confirmation (1 block)
  const receipt = await tx.wait(1);

  if (!receipt || receipt.status !== 1) {
    throw new Error(`Transaction failed: ${tx.hash}`);
  }

  console.log(
    `[Refunds] Refund confirmed - Block: ${receipt.blockNumber}, Gas: ${receipt.gasUsed}`
  );

  return tx.hash;
}

/**
 * Check operator wallet balance for refunds
 */
export async function getOperatorBalanceForRefunds(): Promise<{
  balanceEth: string;
  balanceWei: string;
  address: string;
}> {
  try {
    const wallet = getOperatorWallet();
    const balance = await wallet.provider!.getBalance(wallet.address);
    return {
      balanceEth: ethers.formatEther(balance),
      balanceWei: balance.toString(),
      address: wallet.address,
    };
  } catch (error) {
    console.error('[Refunds] Failed to get operator balance:', error);
    return {
      balanceEth: '0',
      balanceWei: '0',
      address: 'unknown',
    };
  }
}

// ============================================================
// Core Functions
// ============================================================

/**
 * Get a preview of refunds for a cancelled round
 *
 * This aggregates all pack purchases by user and calculates total refund amounts.
 * Does NOT create refund records - use createRefundsForRound for that.
 */
export async function getRefundPreview(roundId: number): Promise<RefundPreview | null> {
  try {
    // Verify round is cancelled
    const [round] = await db
      .select({ status: rounds.status })
      .from(rounds)
      .where(eq(rounds.id, roundId))
      .limit(1);

    if (!round || round.status !== 'cancelled') {
      console.log(`[Refunds] Round ${roundId} is not cancelled (status: ${round?.status})`);
      return null;
    }

    // Aggregate purchases by user
    const purchases = await db
      .select({
        fid: packPurchases.fid,
        totalEth: sql<string>`SUM(${packPurchases.totalPriceEth})`,
        totalWei: sql<string>`SUM(CAST(${packPurchases.totalPriceWei} AS NUMERIC))`,
        count: sql<number>`CAST(COUNT(*) AS INT)`,
        ids: sql<number[]>`ARRAY_AGG(${packPurchases.id})`,
      })
      .from(packPurchases)
      .where(eq(packPurchases.roundId, roundId))
      .groupBy(packPurchases.fid);

    if (purchases.length === 0) {
      console.log(`[Refunds] No pack purchases found for round ${roundId}`);
      return {
        roundId,
        totalRefundEth: '0',
        totalRefundWei: '0',
        userCount: 0,
        users: [],
      };
    }

    // Calculate totals
    let totalWei = BigInt(0);
    const users: UserRefundPreview[] = purchases.map(p => {
      const userWei = BigInt(Math.floor(parseFloat(p.totalWei || '0')));
      totalWei += userWei;
      return {
        fid: p.fid,
        totalAmountEth: p.totalEth || '0',
        totalAmountWei: userWei.toString(),
        purchaseCount: p.count,
        purchaseIds: p.ids || [],
      };
    });

    return {
      roundId,
      totalRefundEth: (parseFloat(totalWei.toString()) / 1e18).toString(),
      totalRefundWei: totalWei.toString(),
      userCount: users.length,
      users,
    };
  } catch (error) {
    console.error(`[Refunds] Failed to get refund preview for round ${roundId}:`, error);
    Sentry.captureException(error, {
      tags: { module: 'refunds', action: 'get_preview' },
      extra: { roundId },
    });
    return null;
  }
}

/**
 * Create refund records for a cancelled round
 *
 * This creates pending refund records for each user who made purchases.
 * Idempotent - will skip users who already have refund records.
 */
export async function createRefundsForRound(
  roundId: number,
  triggeredBy: number
): Promise<{ created: number; skipped: number }> {
  try {
    // Get refund preview
    const preview = await getRefundPreview(roundId);
    if (!preview || preview.users.length === 0) {
      console.log(`[Refunds] No refunds to create for round ${roundId}`);
      return { created: 0, skipped: 0 };
    }

    // Check existing refunds to avoid duplicates
    const existingRefunds = await db
      .select({ fid: refunds.fid })
      .from(refunds)
      .where(eq(refunds.roundId, roundId));

    const existingFids = new Set(existingRefunds.map(r => r.fid));

    let created = 0;
    let skipped = 0;

    // Create refund records for each user
    for (const user of preview.users) {
      if (existingFids.has(user.fid)) {
        skipped++;
        continue;
      }

      await db.insert(refunds).values({
        roundId,
        fid: user.fid,
        amountEth: user.totalAmountEth,
        amountWei: user.totalAmountWei,
        status: 'pending',
        purchaseIds: user.purchaseIds,
      });
      created++;
    }

    // Log operational event
    if (created > 0) {
      await db.insert(operationalEvents).values({
        eventType: 'refunds_started' as OperationalEventType,
        roundId,
        triggeredBy,
        reason: `Created ${created} refund records`,
        metadata: {
          created,
          skipped,
          totalEth: preview.totalRefundEth,
        },
      });

      // Update round to mark refunds started
      await db.update(rounds)
        .set({ refundsStartedAt: new Date() })
        .where(eq(rounds.id, roundId));
    }

    console.log(`[Refunds] Created ${created} refunds for round ${roundId} (skipped ${skipped} existing)`);

    return { created, skipped };
  } catch (error) {
    console.error(`[Refunds] Failed to create refunds for round ${roundId}:`, error);
    Sentry.captureException(error, {
      tags: { module: 'refunds', action: 'create_refunds' },
      extra: { roundId, triggeredBy },
    });
    throw error;
  }
}

/**
 * Process pending refunds for a round
 *
 * This is called by the cron job to process refunds.
 * Uses distributed locking to prevent concurrent processing.
 *
 * NOTE: Sends actual onchain ETH transfers from the operator wallet
 * to each user's Farcaster custody address.
 */
export async function processRefunds(roundId: number): Promise<RefundProcessingResult> {
  const result: RefundProcessingResult = {
    success: false,
    roundId,
    totalProcessed: 0,
    pendingCount: 0,
    sentCount: 0,
    failedCount: 0,
    errors: [],
  };

  // Acquire distributed lock
  const lockAcquired = await acquireRefundLock();
  if (!lockAcquired) {
    result.errors.push('Failed to acquire refund processing lock - another process may be running');
    console.log('[Refunds] Failed to acquire lock, skipping processing');
    return result;
  }

  try {
    // Get pending refunds for this round
    const pendingRefunds = await db
      .select()
      .from(refunds)
      .where(and(
        eq(refunds.roundId, roundId),
        eq(refunds.status, 'pending')
      ));

    result.pendingCount = pendingRefunds.length;

    if (pendingRefunds.length === 0) {
      console.log(`[Refunds] No pending refunds for round ${roundId}`);
      result.success = true;
      return result;
    }

    console.log(`[Refunds] Processing ${pendingRefunds.length} pending refunds for round ${roundId}`);

    // Process each refund
    for (const refund of pendingRefunds) {
      try {
        // Mark as processing
        await db.update(refunds)
          .set({
            status: 'processing' as RefundStatus,
            updatedAt: new Date(),
          })
          .where(eq(refunds.id, refund.id));

        // Send actual onchain refund transaction
        const txHash = await sendRefundTransaction(refund.fid, refund.amountWei);

        // Mark as sent with real transaction hash
        await db.update(refunds)
          .set({
            status: 'sent' as RefundStatus,
            refundTxHash: txHash,
            sentAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(refunds.id, refund.id));

        result.sentCount++;
        result.totalProcessed++;

        console.log(`[Refunds] Refund ${refund.id} sent to FID ${refund.fid}: ${refund.amountEth} ETH (tx: ${txHash})`);
      } catch (refundError: any) {
        // Mark as failed
        const retryCount = (refund.retryCount || 0) + 1;
        await db.update(refunds)
          .set({
            status: 'failed' as RefundStatus,
            errorMessage: refundError.message?.slice(0, 1000),
            retryCount,
            updatedAt: new Date(),
          })
          .where(eq(refunds.id, refund.id));

        result.failedCount++;
        result.totalProcessed++;
        result.errors.push(`Refund ${refund.id} failed: ${refundError.message}`);

        console.error(`[Refunds] Failed to process refund ${refund.id}:`, refundError);
        Sentry.captureException(refundError, {
          tags: { module: 'refunds', action: 'process_refund' },
          extra: { refundId: refund.id, fid: refund.fid, roundId },
        });
      }
    }

    // Check if all refunds are complete
    const [statusCheck] = await db
      .select({
        pending: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'pending' THEN 1 ELSE 0 END) AS INT)`,
        processing: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'processing' THEN 1 ELSE 0 END) AS INT)`,
        sent: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'sent' THEN 1 ELSE 0 END) AS INT)`,
        failed: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'failed' THEN 1 ELSE 0 END) AS INT)`,
      })
      .from(refunds)
      .where(eq(refunds.roundId, roundId));

    const allComplete = (statusCheck.pending || 0) === 0 && (statusCheck.processing || 0) === 0;

    if (allComplete && result.sentCount > 0) {
      // Mark round refunds as completed
      await db.update(rounds)
        .set({ refundsCompletedAt: new Date() })
        .where(eq(rounds.id, roundId));

      // Log completion event
      await db.insert(operationalEvents).values({
        eventType: 'refunds_completed' as OperationalEventType,
        roundId,
        triggeredBy: 0, // System/cron
        reason: 'All refunds processed',
        metadata: {
          sent: statusCheck.sent,
          failed: statusCheck.failed,
        },
      });

      Sentry.captureMessage('Refunds completed for round', {
        level: 'info',
        tags: { type: 'operational', action: 'refunds_completed' },
        extra: { roundId, sent: statusCheck.sent, failed: statusCheck.failed },
      });

      console.log(`[Refunds] All refunds completed for round ${roundId}`);
    }

    result.success = result.failedCount === 0;
    return result;
  } catch (error) {
    console.error(`[Refunds] Error processing refunds for round ${roundId}:`, error);
    result.errors.push(error instanceof Error ? error.message : 'Unknown error');
    Sentry.captureException(error, {
      tags: { module: 'refunds', action: 'process_refunds' },
      extra: { roundId },
    });
    return result;
  } finally {
    // Always release lock
    await releaseRefundLock();
  }
}

/**
 * Get refund status for a user in a specific round
 */
export async function getUserRefundStatus(
  fid: number,
  roundId: number
): Promise<RefundRow | null> {
  try {
    const [refund] = await db
      .select()
      .from(refunds)
      .where(and(
        eq(refunds.roundId, roundId),
        eq(refunds.fid, fid)
      ))
      .limit(1);

    return refund || null;
  } catch (error) {
    console.error(`[Refunds] Failed to get refund status for FID ${fid} round ${roundId}:`, error);
    return null;
  }
}

/**
 * Get all refunds for a round (for admin view)
 */
export async function getRoundRefunds(roundId: number): Promise<RefundRow[]> {
  try {
    return await db
      .select()
      .from(refunds)
      .where(eq(refunds.roundId, roundId))
      .orderBy(refunds.createdAt);
  } catch (error) {
    console.error(`[Refunds] Failed to get refunds for round ${roundId}:`, error);
    return [];
  }
}

/**
 * Retry failed refunds for a round
 *
 * Resets failed refunds back to pending status for reprocessing.
 */
export async function retryFailedRefunds(roundId: number): Promise<number> {
  try {
    const result = await db.update(refunds)
      .set({
        status: 'pending' as RefundStatus,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(and(
        eq(refunds.roundId, roundId),
        eq(refunds.status, 'failed')
      ))
      .returning({ id: refunds.id });

    console.log(`[Refunds] Reset ${result.length} failed refunds to pending for round ${roundId}`);
    return result.length;
  } catch (error) {
    console.error(`[Refunds] Failed to retry refunds for round ${roundId}:`, error);
    throw error;
  }
}

/**
 * Get refund summary statistics for a round
 */
export async function getRefundSummary(roundId: number): Promise<{
  total: number;
  pending: number;
  processing: number;
  sent: number;
  failed: number;
  totalAmountEth: string;
}> {
  try {
    const [stats] = await db
      .select({
        total: sql<number>`CAST(COUNT(*) AS INT)`,
        pending: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'pending' THEN 1 ELSE 0 END) AS INT)`,
        processing: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'processing' THEN 1 ELSE 0 END) AS INT)`,
        sent: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'sent' THEN 1 ELSE 0 END) AS INT)`,
        failed: sql<number>`CAST(SUM(CASE WHEN ${refunds.status} = 'failed' THEN 1 ELSE 0 END) AS INT)`,
        totalAmountEth: sql<string>`COALESCE(SUM(${refunds.amountEth}), 0)`,
      })
      .from(refunds)
      .where(eq(refunds.roundId, roundId));

    return {
      total: stats.total || 0,
      pending: stats.pending || 0,
      processing: stats.processing || 0,
      sent: stats.sent || 0,
      failed: stats.failed || 0,
      totalAmountEth: stats.totalAmountEth || '0',
    };
  } catch (error) {
    console.error(`[Refunds] Failed to get refund summary for round ${roundId}:`, error);
    return {
      total: 0,
      pending: 0,
      processing: 0,
      sent: 0,
      failed: 0,
      totalAmountEth: '0',
    };
  }
}
