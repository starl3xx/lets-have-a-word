/**
 * useStaking Hook
 * XP-Boosted Staking: Wagmi hook for stake, withdraw, and claimRewards
 *
 * Follows the same useWriteContract + useWaitForTransactionReceipt pattern
 * as usePurchaseGuesses.ts.
 *
 * Stake flow: checks allowance first, skips approve if sufficient.
 * Approve uses MAX_UINT256 so subsequent stakes never re-approve.
 * Withdraw and claimRewards are single-call operations.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi';
import { parseUnits, maxUint256 } from 'viem';
import { base } from 'wagmi/chains';
import { ERC_8021_SUFFIX } from '../config/wagmi';

// $WORD token address (ERC-20 for approve)
const WORD_TOKEN_ADDRESS = '0x304e649e69979298bd1aee63e175adf07885fb4b' as `0x${string}`;

// WordManager address (client-side)
const WORD_MANAGER_ADDRESS = (process.env.NEXT_PUBLIC_WORD_MANAGER_ADDRESS || '').trim() as `0x${string}`;

// Minimal ABI fragments (viem format)
const ERC20_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

const WORD_MANAGER_ABI = [
  {
    name: 'stake',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'withdraw',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getReward',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claimRewards',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const;

export type StakingPhase =
  | 'idle'
  | 'approving'
  | 'approve-confirming'
  | 'staking'
  | 'stake-confirming'
  | 'withdrawing'
  | 'withdraw-confirming'
  | 'claiming'
  | 'claim-confirming'
  | 'compound-claiming'
  | 'compound-claim-confirming'
  | 'compound-staking'
  | 'compound-stake-confirming'
  | 'success'
  | 'error';

export interface UseStakingReturn {
  stake: (amountWhole: string) => void;
  withdraw: (amountWhole: string) => void;
  claimRewards: () => void;
  compound: (rewardAmountWhole: string) => void;
  phase: StakingPhase;
  error: Error | null;
  txHash: `0x${string}` | undefined;
  reset: () => void;
  isConfigError: boolean;
  currentAction: 'stake' | 'withdraw' | 'claim' | 'compound' | null;
}

export function useStaking(): UseStakingReturn {
  const [phase, setPhase] = useState<StakingPhase>('idle');
  const [currentAction, setCurrentAction] = useState<'stake' | 'withdraw' | 'claim' | 'compound' | null>(null);
  const [pendingStakeAmount, setPendingStakeAmount] = useState<bigint | null>(null);
  const [pendingCompoundAmount, setPendingCompoundAmount] = useState<bigint | null>(null);
  const [configError, setConfigError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  // Track the final tx hash (stake/withdraw/claim, not approve)
  const [finalTxHash, setFinalTxHash] = useState<`0x${string}` | undefined>(undefined);

  const { address: userAddress } = useAccount();

  // Read current allowance to skip approve when sufficient
  const { data: currentAllowance, refetch: refetchAllowance } = useReadContract({
    address: WORD_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: userAddress && WORD_MANAGER_ADDRESS ? [userAddress, WORD_MANAGER_ADDRESS] : undefined,
    query: { enabled: !!userAddress && !!WORD_MANAGER_ADDRESS },
  });

  // Read token balance — used to cap compound stake at actual post-claim balance
  const { refetch: refetchTokenBalance } = useReadContract({
    address: WORD_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: userAddress ? [userAddress] : undefined,
    query: { enabled: !!userAddress },
  });

  const {
    writeContract,
    data: txHash,
    isPending,
    isError: isWriteError,
    error: writeError,
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess: isReceiptSuccess,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const isConfigError = !WORD_MANAGER_ADDRESS;

  // Track previous receipt success to detect transitions
  const prevReceiptSuccess = useRef(false);

  // Handle transaction confirmation transitions
  useEffect(() => {
    // Only act on a fresh success (transition from false → true)
    if (!isReceiptSuccess || prevReceiptSuccess.current) return;
    prevReceiptSuccess.current = true;

    if (phase === 'approve-confirming' && pendingStakeAmount !== null) {
      // Approve confirmed — now call stake() after a delay for RPC propagation.
      // Farcaster's wallet pre-simulates txs against its own RPC node; without
      // this delay, the simulation may not see the new allowance yet.
      setPhase(currentAction === 'compound' ? 'compound-staking' : 'staking');
      resetWrite();
      setTimeout(() => {
        writeContract({
          address: WORD_MANAGER_ADDRESS,
          abi: WORD_MANAGER_ABI,
          functionName: 'stake',
          args: [pendingStakeAmount],
          chainId: base.id,
          dataSuffix: ERC_8021_SUFFIX,
        });
      }, 3000);
    } else if (phase === 'compound-claim-confirming' && pendingCompoundAmount !== null) {
      // Compound: claim confirmed — now stake the claimed rewards.
      // Refetch actual token balance after RPC delay to avoid staking more than claimed.
      resetWrite();
      setPhase('compound-staking');
      setTimeout(async () => {
        // Get actual post-claim balance to cap stake amount
        const { data: freshBalance } = await refetchTokenBalance();
        const stakeAmount = (freshBalance !== undefined && freshBalance < pendingCompoundAmount)
          ? freshBalance
          : pendingCompoundAmount;

        if (stakeAmount <= 0n) {
          setActionError(new Error('No tokens available to restake.'));
          setPhase('error');
          return;
        }

        if (currentAllowance !== undefined && currentAllowance >= stakeAmount) {
          writeContract({
            address: WORD_MANAGER_ADDRESS,
            abi: WORD_MANAGER_ABI,
            functionName: 'stake',
            args: [stakeAmount],
            chainId: base.id,
            dataSuffix: ERC_8021_SUFFIX,
          });
        } else {
          // Need approval first — reuse approve → stake chain
          setPendingStakeAmount(stakeAmount);
          setPhase('approving');
          writeContract({
            address: WORD_TOKEN_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [WORD_MANAGER_ADDRESS, maxUint256],
            chainId: base.id,
          });
        }
      }, 3000);
    } else if (phase === 'stake-confirming' || phase === 'withdraw-confirming' || phase === 'claim-confirming' || phase === 'compound-stake-confirming') {
      // Final action confirmed
      setFinalTxHash(txHash);
      setPhase('success');
      // Refresh allowance for next stake
      refetchAllowance();
      // Fire audit trail (non-blocking)
      if (txHash && currentAction) {
        fetch('/api/word-staking', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: currentAction,
            txHash,
            walletAddress: '0x', // Placeholder — server only logs
          }),
        }).catch(() => {}); // Fire-and-forget
      }
    }
  }, [isReceiptSuccess, phase, pendingStakeAmount, pendingCompoundAmount, currentAllowance, txHash, currentAction, resetWrite, writeContract, refetchAllowance, refetchTokenBalance]);

  // Track write pending → confirming transitions
  useEffect(() => {
    if (txHash && phase === 'approving') {
      setPhase('approve-confirming');
      prevReceiptSuccess.current = false;
    } else if (txHash && phase === 'staking') {
      setPhase('stake-confirming');
      prevReceiptSuccess.current = false;
    } else if (txHash && phase === 'withdrawing') {
      setPhase('withdraw-confirming');
      prevReceiptSuccess.current = false;
    } else if (txHash && phase === 'claiming') {
      setPhase('claim-confirming');
      prevReceiptSuccess.current = false;
    } else if (txHash && phase === 'compound-claiming') {
      setPhase('compound-claim-confirming');
      prevReceiptSuccess.current = false;
    } else if (txHash && phase === 'compound-staking') {
      setPhase('compound-stake-confirming');
      prevReceiptSuccess.current = false;
    }
  }, [txHash, phase]);

  // Handle errors
  useEffect(() => {
    if (isWriteError || isReceiptError) {
      setActionError(writeError || receiptError || null);
      setPhase('error');
    }
  }, [isWriteError, isReceiptError, writeError, receiptError]);

  const stake = useCallback((amountWhole: string) => {
    setConfigError(null);
    setActionError(null);

    if (!WORD_MANAGER_ADDRESS) {
      setConfigError(new Error('Staking not available. Contract address not configured.'));
      setPhase('error');
      return;
    }

    const amountWei = parseUnits(amountWhole, 18);
    setPendingStakeAmount(amountWei);
    setCurrentAction('stake');
    prevReceiptSuccess.current = false;

    // Skip approve if allowance is already sufficient
    if (currentAllowance !== undefined && currentAllowance >= amountWei) {
      setPhase('staking');
      writeContract({
        address: WORD_MANAGER_ADDRESS,
        abi: WORD_MANAGER_ABI,
        functionName: 'stake',
        args: [amountWei],
        chainId: base.id,
        dataSuffix: ERC_8021_SUFFIX,
      });
      return;
    }

    // Need to approve first — use MAX_UINT256 so future stakes skip approve
    setPhase('approving');
    writeContract({
      address: WORD_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [WORD_MANAGER_ADDRESS, maxUint256],
      chainId: base.id,
    });
  }, [writeContract, currentAllowance]);

  const withdraw = useCallback((amountWhole: string) => {
    setConfigError(null);
    setActionError(null);

    if (!WORD_MANAGER_ADDRESS) {
      setConfigError(new Error('Staking not available. Contract address not configured.'));
      setPhase('error');
      return;
    }

    const amountWei = parseUnits(amountWhole, 18);
    setCurrentAction('withdraw');
    setPhase('withdrawing');
    prevReceiptSuccess.current = false;

    writeContract({
      address: WORD_MANAGER_ADDRESS,
      abi: WORD_MANAGER_ABI,
      functionName: 'withdraw',
      args: [amountWei],
      chainId: base.id,
      dataSuffix: ERC_8021_SUFFIX,
    });
  }, [writeContract]);

  const claimRewards = useCallback(() => {
    setConfigError(null);
    setActionError(null);

    if (!WORD_MANAGER_ADDRESS) {
      setConfigError(new Error('Staking not available. Contract address not configured.'));
      setPhase('error');
      return;
    }

    setCurrentAction('claim');
    setPhase('claiming');
    prevReceiptSuccess.current = false;

    writeContract({
      address: WORD_MANAGER_ADDRESS,
      abi: WORD_MANAGER_ABI,
      functionName: 'claimRewards',
      args: [],
      chainId: base.id,
      dataSuffix: ERC_8021_SUFFIX,
    });
  }, [writeContract]);

  const compound = useCallback((rewardAmountWhole: string) => {
    setConfigError(null);
    setActionError(null);

    if (!WORD_MANAGER_ADDRESS) {
      setConfigError(new Error('Staking not available. Contract address not configured.'));
      setPhase('error');
      return;
    }

    const amountWei = parseUnits(rewardAmountWhole, 18);
    setPendingCompoundAmount(amountWei);
    setCurrentAction('compound');
    prevReceiptSuccess.current = false;

    // Step 1: Claim rewards first, then auto-stake on confirmation
    setPhase('compound-claiming');
    writeContract({
      address: WORD_MANAGER_ADDRESS,
      abi: WORD_MANAGER_ABI,
      functionName: 'claimRewards',
      args: [],
      chainId: base.id,
      dataSuffix: ERC_8021_SUFFIX,
    });
  }, [writeContract]);

  const reset = useCallback(() => {
    setPhase('idle');
    setCurrentAction(null);
    setPendingStakeAmount(null);
    setPendingCompoundAmount(null);
    setConfigError(null);
    setActionError(null);
    setFinalTxHash(undefined);
    prevReceiptSuccess.current = false;
    resetWrite();
  }, [resetWrite]);

  return {
    stake,
    withdraw,
    claimRewards,
    compound,
    phase,
    error: configError || actionError || null,
    txHash: finalTxHash ?? txHash,
    reset,
    isConfigError,
    currentAction,
  };
}
