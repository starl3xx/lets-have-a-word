/**
 * Admin Contract State Diagnostics API
 *
 * GET /api/admin/operational/contract-state
 * Returns contract balance and jackpot state for diagnostics
 *
 * POST /api/admin/operational/contract-state
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { isAdminFid } from '../me';
import { ethers } from 'ethers';
import {
  getCurrentJackpotOnChain,
  getMainnetContractBalance,
  getContractRoundInfo,
  getContractConfig,
  getJackpotManagerReadOnly,
} from '../../../../src/lib/jackpot-contract';
import {
  getWordManagerAddress,
  getWordManagerReadOnly,
  getTotalStaked,
  getTotalBurned,
  getRewardInfo,
} from '../../../../src/lib/word-manager';
import { WORD_TOKEN_ADDRESS } from '../../../../src/lib/word-token';
import { getWordJackpotReadOnly } from '../../../../src/lib/word-jackpot-contract';

interface ContractState {
  network: 'mainnet';
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

export interface AddressBookEntry {
  key: string;
  label: string;
  address: string | null;
  envVar: string | null;
  /** What an admin sends to this address — null means "never send funds here". */
  sends: '$WORD' | 'ETH' | null;
  how: string;
  primary: boolean;
}

/**
 * The funding directory: every address an admin needs, with what it funds and
 * how. Pure env + constants — no RPC — so the `?book=1` fast path can serve
 * it instantly and it can never partially fail.
 */
function getAddressBook(): AddressBookEntry[] {
  const wordManagerAddress = getWordManagerAddress();

  let operatorAddress: string | null = null;
  try {
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
    if (operatorKey) operatorAddress = new ethers.Wallet(operatorKey).address;
  } catch {
    operatorAddress = null;
  }

  let ethEraJackpotManager: string | null = null;
  try {
    ethEraJackpotManager = getContractConfig().jackpotManagerAddress;
  } catch {
    ethEraJackpotManager = null;
  }

  return [
    {
      key: 'word-jackpot',
      label: 'Jackpot prize pool',
      address: process.env.WORD_JACKPOT_ADDRESS || null,
      envVar: 'WORD_JACKPOT_ADDRESS',
      sends: '$WORD',
      how: 'Send $WORD here to fund jackpots. A plain transfer arrives as unallocated and seeds future rounds — this is where the tranche lives.',
      primary: true,
    },
    {
      key: 'word-manager-games',
      label: 'Bonus & burn words',
      address: wordManagerAddress,
      envVar: 'WORD_MANAGER_ADDRESS',
      sends: '$WORD',
      how: 'Send $WORD here to fund bonus-word payouts and burn words. Only the balance above staker reserves is spendable (availableForGames) — game payouts can never touch deposits.',
      primary: true,
    },
    {
      key: 'word-manager-staking',
      label: 'Staking rewards',
      address: wordManagerAddress,
      envVar: 'WORD_MANAGER_ADDRESS',
      sends: '$WORD',
      how: 'Same WordManager address as above. Send $WORD, then activate streaming in the "WordManager funding" card below — tokens do not stream until notifyRewardAmount is called.',
      primary: true,
    },
    {
      key: 'word-pack-sales',
      label: 'Pack & Superguess sales (ETH in)',
      address: process.env.WORD_PACK_SALES_ADDRESS || null,
      envVar: 'WORD_PACK_SALES_ADDRESS',
      sends: null,
      how: 'Players pay ETH here. Anyone can call withdraw() but it can only go to the treasury. Never send funds here yourself.',
      primary: false,
    },
    {
      key: 'guess-log',
      label: 'Guess log (Merkle checkpoints)',
      address: process.env.GUESS_LOG_ADDRESS || null,
      envVar: 'GUESS_LOG_ADDRESS',
      sends: null,
      how: 'The operator posts guess checkpoints here. Holds no funds.',
      primary: false,
    },
    {
      key: 'treasury',
      label: 'Treasury (letshaveaword.eth)',
      address: process.env.PRIZE_POOL_WALLET || '0xFd9716B26f3070Bc60AC409Aba13Dca2798771fB',
      envVar: 'PRIZE_POOL_WALLET',
      sends: null,
      how: 'Holds the $WORD tranche and receives ETH revenue. Hand-signed — its key is never on the server.',
      primary: false,
    },
    {
      key: 'operator',
      label: 'Operator wallet (server signer)',
      address: operatorAddress,
      envVar: 'OPERATOR_PRIVATE_KEY',
      sends: 'ETH',
      how: 'Signs every server transaction; needs ETH for gas. Top up from the "Fund Operator Wallet" card below.',
      primary: false,
    },
    {
      key: 'jackpot-manager-eth',
      label: 'JackpotManager (ETH era, rounds 1–33)',
      address: ethEraJackpotManager,
      envVar: 'JACKPOT_MANAGER_ADDRESS',
      sends: null,
      how: 'The legacy ETH-round contract, kept for history and /verify. No new funding goes here.',
      primary: false,
    },
    {
      key: 'word-token',
      label: '$WORD token',
      address: WORD_TOKEN_ADDRESS,
      envVar: null,
      sends: null,
      how: 'The ERC-20 itself. Never send tokens to the token contract.',
      primary: false,
    },
  ];
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

export interface WordJackpotState {
  configured: boolean;
  contractAddress: string | null;
  balance: string;
  pool: string;
  carry: string;
  claimable: string;
  /** The tranche lands here — what fund() and plain transfers credit. */
  unallocated: string;
  solvencyOk: boolean;
  activeRoundId: number;
  priceStale: boolean;
  priceUpdatedAt: number;
  operatorAuthorized: boolean;
  error?: string;
}

async function getWordJackpotState(): Promise<WordJackpotState> {
  const address = process.env.WORD_JACKPOT_ADDRESS || null;
  const empty: WordJackpotState = {
    configured: Boolean(address),
    contractAddress: address,
    balance: '0',
    pool: '0',
    carry: '0',
    claimable: '0',
    unallocated: '0',
    solvencyOk: true,
    activeRoundId: 0,
    priceStale: true,
    priceUpdatedAt: 0,
    operatorAuthorized: false,
  };
  if (!address) return empty;

  let ourSigningWallet: string | null = null;
  try {
    const operatorKey = process.env.OPERATOR_PRIVATE_KEY;
    if (operatorKey) ourSigningWallet = new ethers.Wallet(operatorKey).address;
  } catch {
    ourSigningWallet = null;
  }

  try {
    const contract = getWordJackpotReadOnly();
    const [solvency, activeRoundId, priceStale, priceUpdatedAt, operator] = await Promise.all([
      contract.solvency() as Promise<[bigint, bigint, bigint, bigint, bigint]>,
      contract.activeRoundId() as Promise<bigint>,
      contract.isPriceStale() as Promise<boolean>,
      contract.priceUpdatedAt() as Promise<bigint>,
      contract.operator() as Promise<string>,
    ]);
    const [balance, pool, carry, claimable, unallocated] = solvency;
    return {
      configured: true,
      contractAddress: address,
      balance: formatTokenAmount(balance),
      pool: formatTokenAmount(pool),
      carry: formatTokenAmount(carry),
      claimable: formatTokenAmount(claimable),
      unallocated: formatTokenAmount(unallocated),
      solvencyOk: balance >= pool + carry + claimable,
      activeRoundId: Number(activeRoundId),
      priceStale,
      priceUpdatedAt: Number(priceUpdatedAt),
      operatorAuthorized:
        ourSigningWallet !== null && ourSigningWallet.toLowerCase() === operator.toLowerCase(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return { ...empty, configured: true, error: message };
  }
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
      // Fast path for the Treasury funding directory: env + constants only,
      // no RPC round-trips.
      if (req.query.book === '1') {
        return res.status(200).json({ ok: true, addressBook: getAddressBook() });
      }

      // Fetch state for all contracts in parallel
      const [mainnet, wordManager, wordJackpot] = await Promise.all([
        getMainnetState(),
        getWordManagerState(),
        getWordJackpotState(),
      ]);

      return res.status(200).json({
        ok: true,
        mainnet,
        wordManager,
        wordJackpot,
        addressBook: getAddressBook(),
        timestamp: new Date().toISOString(),
        recommendations: {
          mainnet: !mainnet.operatorAuthorized
            ? `🚫 OPERATOR MISMATCH! Contract expects ${mainnet.contractOperatorWallet} but we're signing with ${mainnet.ourSigningWallet}. All contract writes will fail.`
            : mainnet.hasMismatch
              ? `⚠️ Contract balance (${mainnet.actualBalance} ETH) is less than internal jackpot (${mainnet.internalJackpot} ETH). Resolution will fail. Contact developer to diagnose.`
              : mainnet.isActive
                ? '✅ Contract state is healthy. Resolution should work.'
                : '✅ No active round. Ready to start new round.',
          wordManager: !wordManager.configured
            ? 'ℹ️ WordManager not configured. Set WORD_MANAGER_ADDRESS to enable $WORD contract monitoring.'
            : wordManager.error
              ? `⚠️ WordManager RPC error: ${wordManager.error}`
              : !wordManager.operatorAuthorized
                ? '🚫 Operator wallet not configured. $WORD contract writes will fail.'
                : '✅ WordManager is healthy.',
          wordJackpot: !wordJackpot.configured
            ? 'ℹ️ WordJackpot not configured. Set WORD_JACKPOT_ADDRESS to enable $WORD jackpot monitoring.'
            : wordJackpot.error
              ? `⚠️ WordJackpot RPC error: ${wordJackpot.error}`
              : !wordJackpot.solvencyOk
                ? '🚨 SOLVENCY VIOLATED: balance is below pool + carry + claimable. Investigate before any round action.'
                : !wordJackpot.operatorAuthorized
                  ? '🚫 Operator mismatch on WordJackpot. Round starts and resolutions will fail.'
                  : wordJackpot.unallocated === '0' && wordJackpot.pool === '0' && wordJackpot.carry === '0'
                    ? 'ℹ️ WordJackpot is deployed and empty — fund the tranche to seed rounds.'
                    : wordJackpot.priceStale
                      ? `⚠️ Oracle price ${wordJackpot.priceUpdatedAt === 0 ? 'never pushed' : 'stale'} — startRound will revert until the oracle cron updates it.`
                      : `✅ WordJackpot is healthy. ${wordJackpot.unallocated} $WORD unallocated and ready to seed rounds.`,
        },
      });
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
