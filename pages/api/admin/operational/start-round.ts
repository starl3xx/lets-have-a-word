/**
 * Start Round API Endpoint
 * Creates a new round with a random solution
 *
 * POST /api/admin/operational/start-round
 *
 * Requires admin authentication (FID in LHAW_ADMIN_USER_IDS)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { isAdminFid } from '../me';
import { createRound, getActiveRound } from '../../../../src/lib/rounds';
import { getJackpotManagerReadOnly, getContractRoundInfo, topUpJackpotOnChain, seedFromTreasuryOnChain } from '../../../../src/lib/jackpot-contract';

interface StartRoundResponse {
  success: boolean;
  message: string;
  roundId?: number;
  commitHash?: string;
  prizePoolEth?: string;
  startedAt?: string;
  error?: string;
  seedingPerformed?: boolean;
  seedingTxHash?: string;
  seedingAmountEth?: string;
  newJackpotEth?: string;
  treasurySeedingPerformed?: boolean;
  treasurySeedingAmountEth?: string;
  treasurySeedingTxHash?: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<StartRoundResponse>
) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    console.log(`[start-round] Received ${req.method} request, expected POST`);
    return res.status(405).json({
      success: false,
      message: `Method ${req.method} not allowed. Use POST.`,
    });
  }

  try {
    // Get FID from request (supports devFid query param or cookie)
    let fid: number | null = null;

    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    } else if (req.body?.fid) {
      fid = parseInt(req.body.fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({
        success: false,
        message: 'Not authenticated - FID required',
      });
    }

    // Check admin status
    if (!isAdminFid(fid)) {
      return res.status(403).json({
        success: false,
        message: `FID ${fid} is not authorized as admin`,
      });
    }

    // Check if there's already an active round
    const existingRound = await getActiveRound();
    if (existingRound) {
      return res.status(409).json({
        success: false,
        message: `Round ${existingRound.id} is already active. Resolve it first before starting a new round.`,
        roundId: existingRound.id,
        prizePoolEth: existingRound.prizePoolEth,
        startedAt: existingRound.startedAt.toISOString(),
      });
    }

    // Pre-flight check: Verify operator wallet authorization
    try {
      const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
      if (!operatorPrivateKey) {
        return res.status(500).json({
          success: false,
          message: 'OPERATOR_PRIVATE_KEY not configured. Cannot sign contract transactions.',
        });
      }

      const ourWallet = new ethers.Wallet(operatorPrivateKey);
      const contract = getJackpotManagerReadOnly();
      const contractOperator = await contract.operatorWallet() as string;

      if (ourWallet.address.toLowerCase() !== contractOperator.toLowerCase()) {
        console.error(`[start-round] OPERATOR MISMATCH: Contract expects ${contractOperator} but we have ${ourWallet.address}`);
        return res.status(500).json({
          success: false,
          message: `Operator wallet mismatch! Contract expects ${contractOperator} but backend is configured with ${ourWallet.address}. Update OPERATOR_PRIVATE_KEY to the correct wallet.`,
        });
      }

      console.log(`[start-round] Operator authorization verified: ${ourWallet.address}`);
    } catch (operatorError) {
      console.error('[start-round] Failed to verify operator:', operatorError);
      // Continue anyway - let the contract call fail with its error
    }

    // Auto-top-up: check contract jackpot and seed if needed
    // Strategy: treasury first, operator wallet as fallback
    let seedingPerformed = false;
    let seedingTxHash: string | undefined;
    let seedingAmountEth: string | undefined;
    let newJackpotEth: string | undefined;
    let treasurySeedingPerformed = false;
    let treasurySeedingAmountEth: string | undefined;
    let treasurySeedingTxHash: string | undefined;

    try {
      // Read the current jackpot, MINIMUM_SEED, and treasury balance from contract
      const contract = getJackpotManagerReadOnly();
      const [roundInfo, minimumSeedWei, treasuryWei] = await Promise.all([
        getContractRoundInfo(),
        contract.MINIMUM_SEED() as Promise<bigint>,
        contract.creatorProfitAccumulated() as Promise<bigint>,
      ]);
      const currentJackpotWei = roundInfo.jackpot;
      console.log(`[start-round] Current contract jackpot: ${ethers.formatEther(currentJackpotWei)} ETH`);
      console.log(`[start-round] Contract MINIMUM_SEED: ${ethers.formatEther(minimumSeedWei)} ETH`);
      console.log(`[start-round] Treasury (creatorProfitAccumulated): ${ethers.formatEther(treasuryWei)} ETH`);

      if (currentJackpotWei >= minimumSeedWei) {
        console.log(`[start-round] Jackpot already at or above minimum seed, no top-up needed`);
      } else {
        const shortfallWei = minimumSeedWei - currentJackpotWei;
        console.log(`[start-round] Jackpot shortfall: ${ethers.formatEther(shortfallWei)} ETH`);

        if (treasuryWei >= shortfallWei) {
          // Treasury covers the entire shortfall
          console.log(`[start-round] Treasury covers full shortfall, calling seedFromTreasury(${ethers.formatEther(shortfallWei)} ETH)...`);
          const treasuryResult = await seedFromTreasuryOnChain(shortfallWei);
          treasurySeedingPerformed = true;
          treasurySeedingAmountEth = treasuryResult.amountEth;
          treasurySeedingTxHash = treasuryResult.txHash;
          newJackpotEth = treasuryResult.newJackpotEth;
          console.log(`[start-round] Treasury seed complete: ${treasuryResult.amountEth} ETH from treasury, new jackpot: ${treasuryResult.newJackpotEth} ETH`);
        } else if (treasuryWei > 0n) {
          // Treasury partially covers — use all treasury, then operator covers the rest
          console.log(`[start-round] Treasury partially covers shortfall, using all ${ethers.formatEther(treasuryWei)} ETH from treasury...`);
          const treasuryResult = await seedFromTreasuryOnChain(treasuryWei);
          treasurySeedingPerformed = true;
          treasurySeedingAmountEth = treasuryResult.amountEth;
          treasurySeedingTxHash = treasuryResult.txHash;

          const remainingShortfall = shortfallWei - treasuryWei;
          console.log(`[start-round] Remaining shortfall after treasury: ${ethers.formatEther(remainingShortfall)} ETH, topping up from operator wallet...`);
          const topUpResult = await topUpJackpotOnChain(remainingShortfall);
          seedingPerformed = true;
          seedingTxHash = topUpResult.txHash;
          seedingAmountEth = topUpResult.amountEth;
          newJackpotEth = topUpResult.newJackpotEth;
          console.log(`[start-round] Operator top-up complete: ${topUpResult.amountEth} ETH, new jackpot: ${topUpResult.newJackpotEth} ETH`);
        } else {
          // Treasury empty — operator covers all (original behavior)
          console.log(`[start-round] Treasury empty, topping up ${ethers.formatEther(shortfallWei)} ETH from operator wallet...`);
          const topUpResult = await topUpJackpotOnChain(shortfallWei);
          seedingPerformed = true;
          seedingTxHash = topUpResult.txHash;
          seedingAmountEth = topUpResult.amountEth;
          newJackpotEth = topUpResult.newJackpotEth;
          console.log(`[start-round] Operator top-up complete: ${topUpResult.amountEth} ETH, new jackpot: ${topUpResult.newJackpotEth} ETH`);
        }

        // Verify post-seed jackpot meets minimum
        const postSeedJackpot = await contract.currentJackpot() as bigint;
        if (postSeedJackpot < minimumSeedWei) {
          return res.status(500).json({
            success: false,
            message: `Jackpot still below minimum after seeding. Current: ${ethers.formatEther(postSeedJackpot)} ETH, need: ${ethers.formatEther(minimumSeedWei)} ETH`,
          });
        }
      }
    } catch (topUpError) {
      console.error('[start-round] Failed to seed jackpot:', topUpError);
      return res.status(500).json({
        success: false,
        message: `Failed to seed jackpot: ${topUpError instanceof Error ? topUpError.message : 'Unknown error'}`,
        error: topUpError instanceof Error ? topUpError.message : 'Unknown error',
      });
    }

    // Create new round
    console.log(`[start-round] Admin FID ${fid} starting new round...`);
    const round = await createRound();

    console.log(`[start-round] Round ${round.id} created successfully`);

    return res.status(200).json({
      success: true,
      message: `Round ${round.id} started successfully!`,
      roundId: round.id,
      commitHash: round.commitHash,
      prizePoolEth: round.prizePoolEth,
      startedAt: round.startedAt.toISOString(),
      seedingPerformed,
      seedingTxHash,
      seedingAmountEth,
      newJackpotEth,
      treasurySeedingPerformed,
      treasurySeedingAmountEth,
      treasurySeedingTxHash,
    });
  } catch (error) {
    console.error('[start-round] Error:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to start round',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
