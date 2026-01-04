/**
 * Emergency Round Resolution API
 *
 * Handles cases where a winner found the correct word but resolution failed
 * due to missing wallet address or other issues.
 *
 * POST /api/admin/operational/emergency-resolve
 *
 * Actions:
 * - lookup-winner: Look up a user's info by FID to check wallet status
 * - update-wallet: Update a user's wallet address
 * - resolve-round: Complete the resolution with the correct winner
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { users, rounds, guesses } from '../../../../src/db/schema';
import { eq, desc, and, isNull } from 'drizzle-orm';
import { submitGuess } from '../../../../src/lib/guesses';
import { getActiveRound, getRoundById } from '../../../../src/lib/rounds';
import { ethers } from 'ethers';

interface LookupResult {
  fid: number;
  username: string | null;
  signerWalletAddress: string | null;
  custodyAddress: string | null;
  hasValidWallet: boolean;
}

interface RoundInfo {
  id: number;
  status: string;
  answer: string;
  prizePoolEth: string;
  globalGuessCount: number;
  isActive: boolean;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { devFid, action, targetFid, walletAddress } = req.body;

    // Auth check
    if (!devFid || !isAdminFid(devFid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    // ==========================================================================
    // Action: Get current round info
    // ==========================================================================
    if (action === 'get-round-info') {
      const activeRound = await getActiveRound();

      if (!activeRound) {
        return res.status(200).json({
          ok: true,
          round: null,
          message: 'No active round',
        });
      }

      // Get guess count
      const guessCount = await db
        .select()
        .from(guesses)
        .where(eq(guesses.roundId, activeRound.id));

      const roundInfo: RoundInfo = {
        id: activeRound.id,
        status: activeRound.resolvedAt ? 'resolved' : 'active',
        answer: activeRound.answer, // Admin can see the answer
        prizePoolEth: activeRound.prizePoolEth,
        globalGuessCount: guessCount.length,
        isActive: !activeRound.resolvedAt,
      };

      return res.status(200).json({
        ok: true,
        round: roundInfo,
      });
    }

    // ==========================================================================
    // Action: Look up winner's wallet info
    // ==========================================================================
    if (action === 'lookup-winner') {
      if (!targetFid) {
        return res.status(400).json({ error: 'targetFid is required' });
      }

      const fid = parseInt(targetFid, 10);
      if (isNaN(fid)) {
        return res.status(400).json({ error: 'Invalid FID' });
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);

      if (!user) {
        return res.status(200).json({
          ok: true,
          found: false,
          message: `User FID ${fid} not found in database`,
        });
      }

      const result: LookupResult = {
        fid: user.fid,
        username: user.username,
        signerWalletAddress: user.signerWalletAddress,
        custodyAddress: user.custodyAddress,
        hasValidWallet: !!(user.signerWalletAddress || user.custodyAddress),
      };

      return res.status(200).json({
        ok: true,
        found: true,
        user: result,
      });
    }

    // ==========================================================================
    // Action: Update user's wallet address
    // ==========================================================================
    if (action === 'update-wallet') {
      if (!targetFid || !walletAddress) {
        return res.status(400).json({ error: 'targetFid and walletAddress are required' });
      }

      const fid = parseInt(targetFid, 10);
      if (isNaN(fid)) {
        return res.status(400).json({ error: 'Invalid FID' });
      }

      // Validate wallet address
      if (!ethers.isAddress(walletAddress)) {
        return res.status(400).json({ error: 'Invalid wallet address format' });
      }

      const checksumAddress = ethers.getAddress(walletAddress);

      // Check if user exists
      const [existingUser] = await db
        .select()
        .from(users)
        .where(eq(users.fid, fid))
        .limit(1);

      if (!existingUser) {
        // Create the user with the wallet
        await db.insert(users).values({
          fid,
          username: `user-${fid}`,
          signerWalletAddress: checksumAddress,
        });

        console.log(`[emergency-resolve] Created user FID ${fid} with wallet ${checksumAddress}`);

        return res.status(200).json({
          ok: true,
          message: `Created user FID ${fid} with wallet ${checksumAddress}`,
          action: 'created',
        });
      }

      // Update existing user's wallet
      await db
        .update(users)
        .set({
          signerWalletAddress: checksumAddress,
          updatedAt: new Date(),
        })
        .where(eq(users.fid, fid));

      console.log(`[emergency-resolve] Updated FID ${fid} wallet to ${checksumAddress}`);

      return res.status(200).json({
        ok: true,
        message: `Updated FID ${fid} wallet to ${checksumAddress}`,
        action: 'updated',
        previousWallet: existingUser.signerWalletAddress,
      });
    }

    // ==========================================================================
    // Action: Resolve round with winner
    // ==========================================================================
    if (action === 'resolve-round') {
      if (!targetFid) {
        return res.status(400).json({ error: 'targetFid is required' });
      }

      const winnerFid = parseInt(targetFid, 10);
      if (isNaN(winnerFid)) {
        return res.status(400).json({ error: 'Invalid FID' });
      }

      // Get active round
      const activeRound = await getActiveRound();
      if (!activeRound) {
        return res.status(400).json({ error: 'No active round to resolve' });
      }

      // Verify the winner has a wallet now
      const [winner] = await db
        .select()
        .from(users)
        .where(eq(users.fid, winnerFid))
        .limit(1);

      if (!winner) {
        return res.status(400).json({
          error: `User FID ${winnerFid} not found. Create them first with update-wallet action.`,
        });
      }

      const winnerWallet = winner.signerWalletAddress || winner.custodyAddress;
      if (!winnerWallet) {
        return res.status(400).json({
          error: `User FID ${winnerFid} still has no wallet. Update their wallet first.`,
        });
      }

      // Submit the winning guess as the winner
      console.log(`[emergency-resolve] Admin ${devFid} triggering resolution for FID ${winnerFid}`);
      console.log(`[emergency-resolve] Round ${activeRound.id}, answer: ${activeRound.answer}`);
      console.log(`[emergency-resolve] Winner wallet: ${winnerWallet}`);

      try {
        const result = await submitGuess({
          fid: winnerFid,
          word: activeRound.answer,
          isPaidGuess: false,
        });

        if (result.status === 'correct') {
          // Get resolved round info
          const resolvedRound = await getRoundById(activeRound.id);

          return res.status(200).json({
            ok: true,
            message: `Round ${activeRound.id} resolved! Winner: FID ${winnerFid}`,
            roundId: activeRound.id,
            winnerFid,
            winnerWallet,
            prizePoolEth: resolvedRound?.prizePoolEth,
            answer: activeRound.answer,
          });
        } else {
          return res.status(500).json({
            ok: false,
            error: `Unexpected result: ${result.status}`,
            result,
          });
        }
      } catch (resolveError: any) {
        console.error('[emergency-resolve] Resolution failed:', resolveError);
        return res.status(500).json({
          ok: false,
          error: `Resolution failed: ${resolveError.message}`,
        });
      }
    }

    return res.status(400).json({ error: `Unknown action: ${action}` });
  } catch (error) {
    console.error('[admin/operational/emergency-resolve] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-emergency-resolve' },
    });
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
