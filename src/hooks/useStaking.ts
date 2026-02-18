/**
 * useStaking Hook
 * XP-Boosted Staking: Wagmi hook for stake, withdraw, and claimRewards
 *
 * Follows the same useWriteContract + useWaitForTransactionReceipt pattern
 * as usePurchaseGuesses.ts.
 *
 * Stake flow is two-step: approve ERC-20 spend, then call stake().
 * Withdraw and claimRewards are single-call operations.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseUnits, toHex } from 'viem';
import { base } from 'wagmi/chains';

// Base Builder Code for attribution
const BASE_BUILDER_CODE = 'bc_lul4sldw';

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
  | 'success'
  | 'error';

export interface UseStakingReturn {
  stake: (amountWhole: string) => void;
  withdraw: (amountWhole: string) => void;
  claimRewards: () => void;
  phase: StakingPhase;
  error: Error | null;
  txHash: `0x${string}` | undefined;
  reset: () => void;
  isConfigError: boolean;
}

export function useStaking(): UseStakingReturn {
  const [phase, setPhase] = useState<StakingPhase>('idle');
  const [currentAction, setCurrentAction] = useState<'stake' | 'withdraw' | 'claim' | null>(null);
  const [pendingStakeAmount, setPendingStakeAmount] = useState<bigint | null>(null);
  const [configError, setConfigError] = useState<Error | null>(null);
  const [actionError, setActionError] = useState<Error | null>(null);

  // Track the final tx hash (stake/withdraw/claim, not approve)
  const [finalTxHash, setFinalTxHash] = useState<`0x${string}` | undefined>(undefined);

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
      // Approve confirmed — now call stake()
      setPhase('staking');
      resetWrite();
      // Small delay to let resetWrite propagate
      setTimeout(() => {
        writeContract({
          address: WORD_MANAGER_ADDRESS,
          abi: WORD_MANAGER_ABI,
          functionName: 'stake',
          args: [pendingStakeAmount],
          chainId: base.id,
          dataSuffix: toHex(BASE_BUILDER_CODE),
        });
      }, 100);
    } else if (phase === 'stake-confirming' || phase === 'withdraw-confirming' || phase === 'claim-confirming') {
      // Final action confirmed
      setFinalTxHash(txHash);
      setPhase('success');
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
  }, [isReceiptSuccess, phase, pendingStakeAmount, txHash, currentAction, resetWrite, writeContract]);

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
    setPhase('approving');
    prevReceiptSuccess.current = false;

    // Step 1: Approve WordManager to spend $WORD tokens
    writeContract({
      address: WORD_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [WORD_MANAGER_ADDRESS, amountWei],
      chainId: base.id,
    });
  }, [writeContract]);

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
      dataSuffix: toHex(BASE_BUILDER_CODE),
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
      dataSuffix: toHex(BASE_BUILDER_CODE),
    });
  }, [writeContract]);

  const reset = useCallback(() => {
    setPhase('idle');
    setCurrentAction(null);
    setPendingStakeAmount(null);
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
    phase,
    error: configError || actionError || null,
    txHash: finalTxHash ?? txHash,
    reset,
    isConfigError,
  };
}
