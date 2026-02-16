/**
 * Admin Airdrop API
 * Sends ETH to a list of recipients by FID
 *
 * POST /api/admin/operational/airdrop
 * Body: {
 *   devFid: number,
 *   action: 'preview' | 'execute',
 *   recipients: Array<{ fid: number, amountEth: string }>,
 *   reason: string
 * }
 *
 * Preview mode: resolves wallets, checks balances, returns summary
 * Execute mode: sends ETH transactions sequentially
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers, Wallet } from 'ethers';
import { isAdminFid } from '../me';
import { resolveWalletIdentity } from '../../../../src/lib/wallet-identity';
import { getBaseProvider } from '../../../../src/lib/word-token';
import { db } from '../../../../src/db';
import { users, operationalEvents, type OperationalEventType } from '../../../../src/db/schema';
import { eq } from 'drizzle-orm';

// ============================================================
// Types
// ============================================================

interface Recipient {
  fid: number;
  amountEth: string;
}

interface ResolvedRecipient {
  fid: number;
  username: string | null;
  amountEth: string;
  walletAddress: string | null;
  error: string | null;
}

interface PreviewResponse {
  ok: boolean;
  action: 'preview';
  recipients: ResolvedRecipient[];
  totalEth: string;
  resolvedCount: number;
  errorCount: number;
  operatorBalance: string;
  operatorAddress: string;
  sufficientBalance: boolean;
}

interface ExecuteRecipientResult {
  fid: number;
  username: string | null;
  amountEth: string;
  walletAddress: string | null;
  txHash: string | null;
  success: boolean;
  error: string | null;
}

interface ExecuteResponse {
  ok: boolean;
  action: 'execute';
  results: ExecuteRecipientResult[];
  successCount: number;
  failureCount: number;
  totalEthSent: string;
}

type AirdropResponse = PreviewResponse | ExecuteResponse | { error: string };

// ============================================================
// Helpers
// ============================================================

function getOperatorWallet(): Wallet {
  const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
  if (!operatorPrivateKey) {
    throw new Error('OPERATOR_PRIVATE_KEY not configured');
  }
  const provider = getBaseProvider();
  return new Wallet(operatorPrivateKey, provider);
}

// ============================================================
// Handler
// ============================================================

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AirdropResponse>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth check
  const devFid = req.body.devFid ? parseInt(req.body.devFid, 10) : null;
  const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
  const adminFid = devFid || fidFromCookie;

  if (!adminFid || !isAdminFid(adminFid)) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  const { action, recipients, reason } = req.body;

  // Validate inputs
  if (!action || (action !== 'preview' && action !== 'execute')) {
    return res.status(400).json({ error: 'action must be "preview" or "execute"' });
  }

  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'recipients must be a non-empty array' });
  }

  if (recipients.length > 100) {
    return res.status(400).json({ error: 'Maximum 100 recipients per airdrop' });
  }

  if (!reason || typeof reason !== 'string' || reason.trim().length < 5) {
    return res.status(400).json({ error: 'reason is required (at least 5 characters)' });
  }

  // Validate each recipient
  for (const r of recipients) {
    if (!r.fid || typeof r.fid !== 'number' || r.fid <= 0) {
      return res.status(400).json({ error: `Invalid FID: ${r.fid}` });
    }
    if (!r.amountEth || isNaN(parseFloat(r.amountEth)) || parseFloat(r.amountEth) <= 0) {
      return res.status(400).json({ error: `Invalid amount for FID ${r.fid}: ${r.amountEth}` });
    }
  }

  try {
    if (action === 'preview') {
      return await handlePreview(req, res, recipients, adminFid);
    } else {
      return await handleExecute(req, res, recipients, reason.trim(), adminFid);
    }
  } catch (error) {
    console.error('[admin/airdrop] Unexpected error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

// ============================================================
// Preview
// ============================================================

async function handlePreview(
  _req: NextApiRequest,
  res: NextApiResponse<AirdropResponse>,
  recipients: Recipient[],
  _adminFid: number
) {
  const resolved: ResolvedRecipient[] = [];
  let totalWei = BigInt(0);
  let errorCount = 0;

  for (const r of recipients) {
    // Look up username
    const [user] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.fid, r.fid))
      .limit(1);

    // Resolve wallet
    const identity = await resolveWalletIdentity(r.fid);

    if (!identity.isValid) {
      resolved.push({
        fid: r.fid,
        username: user?.username ?? null,
        amountEth: r.amountEth,
        walletAddress: null,
        error: identity.error || 'Cannot resolve wallet',
      });
      errorCount++;
    } else {
      const amountWei = ethers.parseEther(r.amountEth);
      totalWei += amountWei;
      resolved.push({
        fid: r.fid,
        username: user?.username ?? null,
        amountEth: r.amountEth,
        walletAddress: identity.walletAddress,
        error: null,
      });
    }
  }

  // Check operator balance
  let operatorBalance = '0';
  let operatorAddress = 'unknown';
  try {
    const wallet = getOperatorWallet();
    operatorAddress = wallet.address;
    const balance = await wallet.provider!.getBalance(wallet.address);
    operatorBalance = ethers.formatEther(balance);
  } catch {
    // If we can't get balance, still return preview
  }

  const totalEth = ethers.formatEther(totalWei);
  const sufficientBalance = parseFloat(operatorBalance) >= parseFloat(totalEth);

  return res.status(200).json({
    ok: true,
    action: 'preview',
    recipients: resolved,
    totalEth,
    resolvedCount: resolved.length - errorCount,
    errorCount,
    operatorBalance,
    operatorAddress,
    sufficientBalance,
  });
}

// ============================================================
// Execute
// ============================================================

async function handleExecute(
  _req: NextApiRequest,
  res: NextApiResponse<AirdropResponse>,
  recipients: Recipient[],
  reason: string,
  adminFid: number
) {
  const wallet = getOperatorWallet();
  const results: ExecuteRecipientResult[] = [];
  let successCount = 0;
  let failureCount = 0;
  let totalSentWei = BigInt(0);

  for (const r of recipients) {
    // Look up username
    const [user] = await db
      .select({ username: users.username })
      .from(users)
      .where(eq(users.fid, r.fid))
      .limit(1);

    // Resolve wallet
    const identity = await resolveWalletIdentity(r.fid);

    if (!identity.isValid) {
      results.push({
        fid: r.fid,
        username: user?.username ?? null,
        amountEth: r.amountEth,
        walletAddress: null,
        txHash: null,
        success: false,
        error: identity.error || 'Cannot resolve wallet',
      });
      failureCount++;
      continue;
    }

    try {
      const amountWei = ethers.parseEther(r.amountEth);

      console.log(
        `[admin/airdrop] Sending ${r.amountEth} ETH to FID ${r.fid} (@${user?.username || 'unknown'}) at ${identity.walletAddress}`
      );

      const tx = await wallet.sendTransaction({
        to: identity.walletAddress,
        value: amountWei,
      });

      // Wait for 1-block confirmation
      const receipt = await tx.wait(1);

      if (!receipt || receipt.status !== 1) {
        throw new Error(`Transaction failed: ${tx.hash}`);
      }

      console.log(
        `[admin/airdrop] Confirmed: ${tx.hash} (block ${receipt.blockNumber})`
      );

      totalSentWei += amountWei;
      successCount++;
      results.push({
        fid: r.fid,
        username: user?.username ?? null,
        amountEth: r.amountEth,
        walletAddress: identity.walletAddress,
        txHash: tx.hash,
        success: true,
        error: null,
      });
    } catch (txError: any) {
      console.error(`[admin/airdrop] Failed to send to FID ${r.fid}:`, txError);
      failureCount++;
      results.push({
        fid: r.fid,
        username: user?.username ?? null,
        amountEth: r.amountEth,
        walletAddress: identity.walletAddress,
        txHash: null,
        success: false,
        error: txError.message?.slice(0, 500) || 'Transaction failed',
      });
    }
  }

  // Log operational event
  try {
    await db.insert(operationalEvents).values({
      eventType: 'airdrop' as OperationalEventType,
      triggeredBy: adminFid,
      reason,
      metadata: {
        recipientCount: recipients.length,
        successCount,
        failureCount,
        totalEthSent: ethers.formatEther(totalSentWei),
        results: results.map(r => ({
          fid: r.fid,
          amountEth: r.amountEth,
          txHash: r.txHash,
          success: r.success,
        })),
      },
    });
  } catch (logError) {
    console.error('[admin/airdrop] Failed to log operational event:', logError);
  }

  return res.status(200).json({
    ok: true,
    action: 'execute',
    results,
    successCount,
    failureCount,
    totalEthSent: ethers.formatEther(totalSentWei),
  });
}
