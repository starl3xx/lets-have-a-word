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
import {
  getWordManagerAddress,
  getWordManagerReadOnly,
  getTotalStaked,
  getTotalBurned,
  getRewardInfo,
} from '../../../../src/lib/word-manager';
import { WORD_TOKEN_ADDRESS } from '../../../../src/lib/word-token';

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

interface WordManagerState {
  configured: boolean;
  contractAddress: string | null;
  tokenBalance: string;
  totalStaked: string;
  totalBurned: string;
  totalDistributed: string;
  operatorAuthorized: boolean;
  ourSigningWallet: string;
  // V3: Synthetix streaming reward fields
  rewardRate: string;
  periodFinish: number;
  rewardsDuration: number;
  rewardPeriodActive: boolean;
  error?: string;
}

function formatTokenAmount(raw: bigint): string {
  const whole = raw / BigInt(1e18);
  if (whole >= 1_000_000_000n) {
    const billions = Number(whole) / 1e9;
    return `${billions.toFixed(1)}B`;
  }
  if (whole >= 1_000_000n) {
    const millions = Number(whole) / 1e6;
    return `${millions.toFixed(1)}M`;
  }
  if (whole >= 1_000n) {
    const thousands = Number(whole) / 1e3;
    return `${thousands.toFixed(1)}K`;
  }
  return whole.toString();
}

async function getWordManagerState(): Promise<WordManagerState> {
  const address = getWordManagerAddress();

  if (!address) {
    return {
      configured: false,
      contractAddress: null,
      tokenBalance: '0',
      totalStaked: '0',
      totalBurned: '0',
      totalDistributed: '0',
      operatorAuthorized: false,
      ourSigningWallet: 'NOT_CONFIGURED',
      rewardRate: '0',
      periodFinish: 0,
      rewardsDuration: 0,
      rewardPeriodActive: false,
    };
  }

  let ourSigningWallet = 'NOT_CONFIGURED';
  try {
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
    if (operatorKey) {
      const wallet = new ethers.Wallet(operatorKey);
      ourSigningWallet = wallet.address;
    }
  } catch {
    ourSigningWallet = 'INVALID_KEY';
  }

  try {
    const contract = getWordManagerReadOnly();
    if (!contract) {
      return {
        configured: true,
        contractAddress: address,
        tokenBalance: '0',
        totalStaked: '0',
        totalBurned: '0',
        totalDistributed: '0',
        operatorAuthorized: false,
        ourSigningWallet,
        rewardRate: '0',
        periodFinish: 0,
        rewardsDuration: 0,
        rewardPeriodActive: false,
        error: 'Failed to create contract instance',
      };
    }

    // Query $WORD token balance of the WordManager contract
    const provider = contract.runner?.provider;
    const tokenContract = provider
      ? new ethers.Contract(WORD_TOKEN_ADDRESS, ['function balanceOf(address) view returns (uint256)'], provider)
      : null;

    const [totalStaked, totalBurned, totalDistributed, rewardInfo, tokenBalance] = await Promise.all([
      getTotalStaked(),
      getTotalBurned(),
      contract.totalDistributed() as Promise<bigint>,
      getRewardInfo(),
      tokenContract ? (tokenContract.balanceOf(address) as Promise<bigint>) : Promise.resolve(0n),
    ]);

    // WordManager uses the same operator wallet — if our wallet can sign, it's authorized
    const operatorAuthorized = ourSigningWallet !== 'NOT_CONFIGURED' && ourSigningWallet !== 'INVALID_KEY';

    const periodFinish = rewardInfo ? Number(rewardInfo.periodFinish) : 0;
    const rewardPeriodActive = periodFinish > Math.floor(Date.now() / 1000);

    return {
      configured: true,
      contractAddress: address,
      tokenBalance: formatTokenAmount(tokenBalance ?? 0n),
      totalStaked: formatTokenAmount(totalStaked ?? 0n),
      totalBurned: formatTokenAmount(totalBurned ?? 0n),
      totalDistributed: formatTokenAmount(totalDistributed ?? 0n),
      operatorAuthorized,
      ourSigningWallet,
      rewardRate: rewardInfo?.rewardRate?.toString() ?? '0',
      periodFinish,
      rewardsDuration: rewardInfo ? Number(rewardInfo.rewardsDuration) : 0,
      rewardPeriodActive,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      configured: true,
      contractAddress: address,
      tokenBalance: '0',
      totalStaked: '0',
      totalBurned: '0',
      totalDistributed: '0',
      operatorAuthorized: false,
      ourSigningWallet,
      rewardRate: '0',
      periodFinish: 0,
      rewardsDuration: 0,
      rewardPeriodActive: false,
      error: message,
    };
  }
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
      // Fetch state for all contracts in parallel
      const [mainnet, sepolia, wordManager] = await Promise.all([
        getMainnetState(),
        getSepoliaState(),
        getWordManagerState(),
      ]);

      return res.status(200).json({
        ok: true,
        mainnet,
        sepolia,
        wordManager,
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
          wordManager: !wordManager.configured
            ? 'ℹ️ WordManager not configured. Set WORD_MANAGER_ADDRESS to enable $WORD contract monitoring.'
            : wordManager.error
              ? `⚠️ WordManager RPC error: ${wordManager.error}`
              : !wordManager.operatorAuthorized
                ? '🚫 Operator wallet not configured. $WORD contract writes will fail.'
                : '✅ WordManager is healthy.',
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
