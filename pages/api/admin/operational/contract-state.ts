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
  getContractConfig,
  getSepoliaContractConfig,
  getJackpotManagerReadOnly,
  getSepoliaJackpotManagerReadOnly,
} from '../../../../src/lib/jackpot-contract';

interface ContractState {
  network: 'mainnet' | 'sepolia';
  contractAddress: string;
  rpcUrl: string;
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
  // Operator wallet diagnostics
  contractOperatorWallet: string;
  ourSigningWallet: string;
  operatorAuthorized: boolean;
  error?: string;
}

async function getMainnetState(): Promise<ContractState> {
  const config = getContractConfig();
  const rpcUrl = process.env.BASE_RPC_URL || 'https://mainnet.base.org';

  // Get our signing wallet address from OPERATOR_PRIVATE_KEY
  let ourSigningWallet = 'NOT_CONFIGURED';
  try {
    const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
    if (operatorPrivateKey) {
      const wallet = new ethers.Wallet(operatorPrivateKey);
      ourSigningWallet = wallet.address;
    }
  } catch {
    ourSigningWallet = 'INVALID_KEY';
  }

  try {
    const contract = getJackpotManagerReadOnly();
    const [roundInfo, internalJackpot, actualBalance, contractOperatorWallet] = await Promise.all([
      getContractRoundInfo(),
      getCurrentJackpotOnChain(),
      getMainnetContractBalance(),
      contract.operatorWallet() as Promise<string>,
    ]);

    const jackpotWei = ethers.parseEther(internalJackpot);
    const balanceWei = ethers.parseEther(actualBalance);
    const diff = jackpotWei - balanceWei;
    const absDiff = diff < 0n ? -diff : diff;
    const mismatchPercent = jackpotWei > 0n
      ? Number((absDiff * 10000n) / jackpotWei) / 100
      : 0;

    const operatorAuthorized = ourSigningWallet.toLowerCase() === contractOperatorWallet.toLowerCase();

    return {
      network: 'mainnet',
      contractAddress: config.jackpotManagerAddress,
      rpcUrl,
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
      contractOperatorWallet,
      ourSigningWallet,
      operatorAuthorized,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      network: 'mainnet',
      contractAddress: config.jackpotManagerAddress,
      rpcUrl,
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
      contractOperatorWallet: 'UNKNOWN',
      ourSigningWallet,
      operatorAuthorized: false,
      error: message,
    };
  }
}

async function getSepoliaState(): Promise<ContractState> {
  const config = getSepoliaContractConfig();
  const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org';

  // Get our signing wallet address from OPERATOR_PRIVATE_KEY
  let ourSigningWallet = 'NOT_CONFIGURED';
  try {
    const operatorPrivateKey = process.env.OPERATOR_PRIVATE_KEY;
    if (operatorPrivateKey) {
      const wallet = new ethers.Wallet(operatorPrivateKey);
      ourSigningWallet = wallet.address;
    }
  } catch {
    ourSigningWallet = 'INVALID_KEY';
  }

  try {
    const contract = getSepoliaJackpotManagerReadOnly();
    const [roundInfo, internalJackpot, actualBalance, contractOperatorWallet] = await Promise.all([
      getSepoliaRoundInfo(),
      getCurrentJackpotOnSepolia(),
      getSepoliaContractBalance(),
      contract.operatorWallet() as Promise<string>,
    ]);

    const jackpotWei = ethers.parseEther(internalJackpot);
    const balanceWei = ethers.parseEther(actualBalance);
    const diff = jackpotWei - balanceWei;
    const absDiff = diff < 0n ? -diff : diff;
    const mismatchPercent = jackpotWei > 0n
      ? Number((absDiff * 10000n) / jackpotWei) / 100
      : 0;

    const operatorAuthorized = ourSigningWallet.toLowerCase() === contractOperatorWallet.toLowerCase();

    return {
      network: 'sepolia',
      contractAddress: config.jackpotManagerAddress,
      rpcUrl,
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
      contractOperatorWallet,
      ourSigningWallet,
      operatorAuthorized,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      network: 'sepolia',
      contractAddress: config.jackpotManagerAddress,
      rpcUrl,
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
      contractOperatorWallet: 'UNKNOWN',
      ourSigningWallet,
      operatorAuthorized: false,
      error: message,
    };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    // Auth check - support devFid from query (GET) or body (POST)
    const devFidFromQuery = req.query.devFid ? parseInt(req.query.devFid as string, 10) : null;
    const devFidFromBody = req.body?.devFid ? parseInt(req.body.devFid, 10) : null;
    const fidFromCookie = req.cookies.siwn_fid ? parseInt(req.cookies.siwn_fid, 10) : null;
    const fid = devFidFromQuery || devFidFromBody || fidFromCookie;

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
          mainnet: !mainnet.operatorAuthorized
            ? `🚫 OPERATOR MISMATCH! Contract expects ${mainnet.contractOperatorWallet} but we're signing with ${mainnet.ourSigningWallet}. All contract writes will fail.`
            : mainnet.hasMismatch
              ? `⚠️ Contract balance (${mainnet.actualBalance} ETH) is less than internal jackpot (${mainnet.internalJackpot} ETH). Resolution will fail. Contact developer to diagnose.`
              : mainnet.isActive
                ? '✅ Contract state is healthy. Resolution should work.'
                : '✅ No active round. Ready to start new round.',
          sepolia: !sepolia.operatorAuthorized
            ? `🚫 OPERATOR MISMATCH! Contract expects ${sepolia.contractOperatorWallet} but we're signing with ${sepolia.ourSigningWallet}. All contract writes will fail.`
            : sepolia.hasMismatch
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
