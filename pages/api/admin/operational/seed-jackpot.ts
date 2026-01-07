/**
 * Admin endpoint to seed the jackpot on mainnet
 *
 * Used when the contract's currentJackpot is below the 0.03 ETH minimum
 * required to start a new round.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { seedJackpotOnChain, getContractRoundInfo } from '../../../../src/lib/jackpot-contract';
import { ethers } from 'ethers';

// Minimum seed required (same as contract constant)
const MINIMUM_SEED_ETH = 0.03;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Verify admin authentication
  const devFid = req.query.devFid as string;
  if (!devFid || !isAdminFid(parseInt(devFid, 10))) {
    return res.status(403).json({ error: 'Unauthorized' });
  }

  if (req.method === 'GET') {
    // Check current contract state
    try {
      const roundInfo = await getContractRoundInfo();
      const currentJackpotEth = parseFloat(ethers.formatEther(roundInfo.jackpot));
      const shortfall = Math.max(0, MINIMUM_SEED_ETH - currentJackpotEth);

      return res.status(200).json({
        currentRound: roundInfo.roundNumber,
        isActive: roundInfo.isActive,
        currentJackpotEth: currentJackpotEth.toFixed(6),
        minimumSeedEth: MINIMUM_SEED_ETH.toFixed(6),
        shortfallEth: shortfall.toFixed(6),
        canStartNewRound: currentJackpotEth >= MINIMUM_SEED_ETH,
        message: shortfall > 0
          ? `Need to seed ${shortfall.toFixed(6)} ETH more to reach ${MINIMUM_SEED_ETH} ETH minimum`
          : 'Contract has sufficient seed to start a new round',
      });
    } catch (error) {
      console.error('[seed-jackpot] Error checking contract state:', error);
      return res.status(500).json({
        error: 'Failed to check contract state',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  if (req.method === 'POST') {
    // Seed the jackpot
    const { amountEth } = req.body;

    if (!amountEth || typeof amountEth !== 'string') {
      return res.status(400).json({ error: 'amountEth is required (string)' });
    }

    const amount = parseFloat(amountEth);
    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amountEth must be a positive number' });
    }

    if (amount > 1) {
      return res.status(400).json({ error: 'Safety limit: cannot seed more than 1 ETH at once' });
    }

    try {
      // Check current state
      const beforeInfo = await getContractRoundInfo();

      if (beforeInfo.isActive) {
        return res.status(400).json({
          error: 'Cannot seed while a round is active',
          currentRound: beforeInfo.roundNumber,
        });
      }

      console.log(`[seed-jackpot] Admin FID ${devFid} seeding jackpot with ${amountEth} ETH`);
      console.log(`[seed-jackpot] Current jackpot: ${ethers.formatEther(beforeInfo.jackpot)} ETH`);

      // Seed the jackpot
      const txHash = await seedJackpotOnChain(amountEth);

      // Check new state
      const afterInfo = await getContractRoundInfo();
      const afterJackpotEth = parseFloat(ethers.formatEther(afterInfo.jackpot));
      const canStartRound = afterJackpotEth >= MINIMUM_SEED_ETH;

      console.log(`[seed-jackpot] ✅ Seeded successfully: ${txHash}`);
      console.log(`[seed-jackpot] New jackpot: ${afterJackpotEth.toFixed(6)} ETH`);

      return res.status(200).json({
        success: true,
        txHash,
        previousJackpotEth: ethers.formatEther(beforeInfo.jackpot),
        newJackpotEth: afterJackpotEth.toFixed(6),
        canStartNewRound: canStartRound,
        message: canStartRound
          ? 'Jackpot seeded! You can now start a new round.'
          : `Seeded, but still ${(MINIMUM_SEED_ETH - afterJackpotEth).toFixed(6)} ETH short of minimum`,
        basescanUrl: `https://basescan.org/tx/${txHash}`,
      });
    } catch (error) {
      console.error('[seed-jackpot] Error seeding jackpot:', error);
      return res.status(500).json({
        error: 'Failed to seed jackpot',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
