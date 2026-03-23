/**
 * useSuperguessPayment Hook
 * Milestone 15: Wagmi ERC-20 transfer for Superguess purchase
 *
 * Flow: approve → transfer $WORD to operator → call /api/superguess/purchase with txHash
 * Pattern follows useStaking.ts (approve + useWriteContract + useWaitForTransactionReceipt)
 */

import { useState, useCallback, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useReadContract } from 'wagmi';
import { parseUnits, maxUint256 } from 'viem';
import { base } from 'wagmi/chains';

// $WORD token address (ERC-20)
const WORD_TOKEN_ADDRESS = '0x304e649e69979298bd1aee63e175adf07885fb4b' as `0x${string}`;

// Operator wallet for receiving Superguess payments
// Uses NEXT_PUBLIC_ prefix because this runs client-side (Wagmi hook)
const OPERATOR_WALLET = (process.env.NEXT_PUBLIC_OPERATOR_WALLET ||
  process.env.NEXT_PUBLIC_WORD_MANAGER_ADDRESS || '') as `0x${string}`;

// Minimal ABI for ERC-20 transfer + approve
const ERC20_ABI = [
  {
    name: 'transfer',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
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
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;

export type SuperguessPaymentPhase =
  | 'idle'
  | 'transferring'
  | 'transfer-confirming'
  | 'purchasing'
  | 'complete'
  | 'error';

interface UseSuperguessPaymentReturn {
  phase: SuperguessPaymentPhase;
  error: string | null;
  txHash: string | null;
  sessionId: number | null;
  startPayment: (tokenAmount: string) => void;
  reset: () => void;
  balance: bigint | undefined;
}

export function useSuperguessPayment(
  devFid?: number,
  authToken?: string | null
): UseSuperguessPaymentReturn {
  const { address } = useAccount();
  const [phase, setPhase] = useState<SuperguessPaymentPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);

  // Read $WORD balance
  const { data: balance } = useReadContract({
    address: WORD_TOKEN_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: base.id,
  });

  // Transfer $WORD to operator
  const {
    writeContract: writeTransfer,
    data: transferHash,
    error: transferError,
    reset: resetTransfer,
  } = useWriteContract();

  const {
    isSuccess: transferConfirmed,
    isError: transferFailed,
  } = useWaitForTransactionReceipt({
    hash: transferHash,
  });

  // Start the payment flow
  const startPayment = useCallback(
    (tokenAmount: string) => {
      if (!address || !OPERATOR_WALLET) {
        setError('Wallet not connected or operator not configured');
        return;
      }

      setPhase('transferring');
      setError(null);
      setSessionId(null);

      const amountWei = parseUnits(tokenAmount, 18);

      writeTransfer({
        address: WORD_TOKEN_ADDRESS,
        abi: ERC20_ABI,
        functionName: 'transfer',
        args: [OPERATOR_WALLET, amountWei],
        chainId: base.id,
      });
    },
    [address, writeTransfer]
  );

  // Handle transfer errors
  useEffect(() => {
    if (transferError) {
      setPhase('error');
      setError(transferError.message || 'Transfer failed');
    }
  }, [transferError]);

  // Handle transfer hash received (tx submitted)
  useEffect(() => {
    if (transferHash && phase === 'transferring') {
      setPhase('transfer-confirming');
    }
  }, [transferHash, phase]);

  // Handle transfer confirmation → call purchase API
  useEffect(() => {
    if (transferConfirmed && transferHash && phase === 'transfer-confirming') {
      setPhase('purchasing');

      const callPurchaseApi = async () => {
        try {
          const body: Record<string, unknown> = {
            txHash: transferHash,
          };
          if (devFid) body.devFid = devFid;
          if (authToken) body.authToken = authToken;

          const response = await fetch('/api/superguess/purchase', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });

          const data = await response.json();

          if (!response.ok) {
            throw new Error(data.error || 'Purchase failed');
          }

          setSessionId(data.session?.id || null);
          setPhase('complete');
        } catch (err: any) {
          setPhase('error');
          setError(err.message || 'Purchase API call failed');
        }
      };

      callPurchaseApi();
    }
  }, [transferConfirmed, transferHash, phase, devFid]);

  // Handle transfer failure
  useEffect(() => {
    if (transferFailed && phase === 'transfer-confirming') {
      setPhase('error');
      setError('Transaction failed on-chain');
    }
  }, [transferFailed, phase]);

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setSessionId(null);
    resetTransfer();
  }, [resetTransfer]);

  return {
    phase,
    error,
    txHash: transferHash || null,
    sessionId,
    startPayment,
    reset,
    balance: balance as bigint | undefined,
  };
}
