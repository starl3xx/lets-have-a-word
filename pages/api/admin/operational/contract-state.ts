/**
 * Admin Contract State Diagnostics API
 *
 * GET /api/admin/operational/contract-state
 * Returns contract balance and jackpot state for diagnostics
 *
 * POST /api/admin/operational/contract-state
 * Actions: { action: 'resolve-with-balance' } - Resolve using actual balance (emergency)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import { ethers } from 'ethers';
import {
  getCurrentJackpotOnChain,
  getMainnetContractBalance,
  getCurrentJackpotOnSepolia,
  getSepoliaContractBalance,
  getSepoliaRoundInfo,
  getContractRoundInfo,
  resolveSepoliaPreviousRound,
} from '../../../../src/lib/jackpot-contract';

interface ContractState {
  network: 'mainnet' | 'sepolia';
  roundNumber: number;
  isActive: boolean;
  internalJackpot: string;
  actualBalance: string;
  internalJackpotWei: string;
  actualBalanceWei: string;
  hasMismatch: boolean;
  mismatchAmount: string;
  mismatchPercent: number;
  canResolve: boolean;
  error?: string;
}

async function getMainnetState(): Promise<ContractState> {
  try {
    const [roundInfo, internalJackpot, actualBalance] = await Promise.all([
      getContractRoundInfo(),
      getCurrentJackpotOnChain(),
      getMainnetContractBalance(),
    ]);

    const jackpotWei = ethers.parseEther(internalJackpot);
    const balanceWei = ethers.parseEther(actualBalance);
    const diff = jackpotWei - balanceWei;
    const absDiff = diff < 0n ? -diff : diff;
    const mismatchPercent = jackpotWei > 0n
      ? Number((absDiff * 10000n) / jackpotWei) / 100
      : 0;

    return {
      network: 'mainnet',
      roundNumber: Number(roundInfo.roundNumber),
      isActive: roundInfo.isActive,
      internalJackpot,
      actualBalance,
      internalJackpotWei: jackpotWei.toString(),
      actualBalanceWei: balanceWei.toString(),
      hasMismatch: balanceWei < jackpotWei,
      mismatchAmount: ethers.formatEther(absDiff),
      mismatchPercent,
      canResolve: roundInfo.isActive && balanceWei >= jackpotWei,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      network: 'mainnet',
      roundNumber: 0,
      isActive: false,
      internalJackpot: '0',
      actualBalance: '0',
      internalJackpotWei: '0',
      actualBalanceWei: '0',
      hasMismatch: false,
      mismatchAmount: '0',
      mismatchPercent: 0,
      canResolve: false,
      error: message,
    };
  }
}

async function getSepoliaState(): Promise<ContractState> {
  try {
    const [roundInfo, internalJackpot, actualBalance] = await Promise.all([
      getSepoliaRoundInfo(),
      getCurrentJackpotOnSepolia(),
      getSepoliaContractBalance(),
    ]);

    const jackpotWei = ethers.parseEther(internalJackpot);
    const balanceWei = ethers.parseEther(actualBalance);
    const diff = jackpotWei - balanceWei;
    const absDiff = diff < 0n ? -diff : diff;
    const mismatchPercent = jackpotWei > 0n
      ? Number((absDiff * 10000n) / jackpotWei) / 100
      : 0;

    return {
      network: 'sepolia',
      roundNumber: Number(roundInfo.roundNumber),
      isActive: roundInfo.isActive,
      internalJackpot,
      actualBalance,
      internalJackpotWei: jackpotWei.toString(),
      actualBalanceWei: balanceWei.toString(),
      hasMismatch: balanceWei < jackpotWei,
      mismatchAmount: ethers.formatEther(absDiff),
      mismatchPercent,
      canResolve: roundInfo.isActive && balanceWei >= jackpotWei,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      network: 'sepolia',
      roundNumber: 0,
      isActive: false,
      internalJackpot: '0',
      actualBalance: '0',
      internalJackpotWei: '0',
      actualBalanceWei: '0',
      hasMismatch: false,
      mismatchAmount: '0',
      mismatchPercent: 0,
      canResolve: false,
      error: message,
    };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Auth check
    const devFid = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
    const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
    const fid = devFid || fidFromCookie;

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    if (req.method === 'GET') {
      // Fetch state for both networks in parallel
      const [mainnet, sepolia] = await Promise.all([
        getMainnetState(),
        getSepoliaState(),
      ]);

      return res.status(200).json({
        ok: true,
        mainnet,
        sepolia,
        timestamp: new Date().toISOString(),
        recommendations: {
          mainnet: mainnet.hasMismatch
            ? `⚠️ Contract balance (${mainnet.actualBalance} ETH) is less than internal jackpot (${mainnet.internalJackpot} ETH). Resolution will fail. Contact developer to diagnose.`
            : mainnet.isActive
              ? '✅ Contract state is healthy. Resolution should work.'
              : 'ℹ️ No active round.',
          sepolia: sepolia.hasMismatch
            ? `⚠️ Use "Clear Sepolia Round" to reset contract state. This pays the jackpot to the operator wallet.`
            : sepolia.isActive
              ? '✅ Contract state is healthy. Simulation should work.'
              : 'ℹ️ No active round. Start a simulation to create one.',
        },
      });
    }

    if (req.method === 'POST') {
      const { action, network } = req.body as { action: string; network: 'mainnet' | 'sepolia' };

      if (action === 'clear-sepolia-round') {
        if (network !== 'sepolia') {
          return res.status(400).json({ error: 'This action is only available for Sepolia' });
        }

        // Check if Sepolia has an active round
        const sepoliaState = await getSepoliaState();
        if (!sepoliaState.isActive) {
          return res.status(400).json({ error: 'No active Sepolia round to clear' });
        }

        // Resolve the Sepolia round by paying 100% to operator
        console.log(`[contract-state] Admin ${fid} clearing Sepolia round #${sepoliaState.roundNumber}`);
        const txHash = await resolveSepoliaPreviousRound();
        console.log(`[contract-state] Sepolia round cleared: ${txHash}`);

        return res.status(200).json({
          ok: true,
          action: 'clear-sepolia-round',
          txHash,
          message: `Cleared Sepolia round #${sepoliaState.roundNumber}. Jackpot (${sepoliaState.actualBalance} ETH) returned to operator.`,
        });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[admin/operational/contract-state] Error:', error);
    Sentry.captureException(error, {
      tags: { endpoint: 'admin-contract-state' },
    });
    const message = error instanceof Error ? error.message : 'Internal server error';
    return res.status(500).json({ error: message });
  }
}
