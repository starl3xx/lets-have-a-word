/**
 * useSuperguessPayment Hook
 * Milestone 15: Wagmi ERC-20 transfer for Superguess purchase
 *
 * Flow: pay ETH to WordPackSales.buySuperguess → call /api/superguess/purchase
 * with the txHash.
 *
 * Superguess moved from $WORD to ETH. Players earn $WORD by playing — jackpot,
 * bonus words, top ten — and spend ETH to buy, matching guess packs. A
 * first-time player is far likelier to hold ETH than the reward token, and
 * pricing purchases in $WORD pushed holders to sell the thing staking exists
 * to encourage them to keep.
 *
 * Paying through the contract rather than transferring to the operator wallet
 * is what makes the purchase verifiable: buySuperguess emits an event carrying
 * msg.sender, so the backend can bind the payment to a payer and credit it
 * exactly once. The previous flow — a bare $WORD transfer — left the server
 * scanning for any transfer of roughly the right size, which accepted a
 * stranger's historical transaction.
 * Pattern follows useStaking.ts (approve + useWriteContract + useWaitForTransactionReceipt)
 */

import { useState, useCallback, useEffect } from 'react';
import { useWriteContract, useWaitForTransactionReceipt, useAccount, useBalance } from 'wagmi';
import { parseEther } from 'viem';
import { base } from 'wagmi/chains';

const WORD_PACK_SALES_ADDRESS = process.env
  .NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS as `0x${string}` | undefined;

/** Superguess is bought through the same contract as guess packs. */
const WORD_PACK_SALES_ABI = [
  {
    name: 'buySuperguess',
    type: 'function',
    stateMutability: 'payable',
    inputs: [{ name: 'roundId', type: 'uint256' }],
    outputs: [],
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
  startPayment: (ethAmount: string, roundId?: number) => void;
  reset: () => void;
  ethBalance: { value: bigint; formatted: string; symbol: string } | undefined;
}

export function useSuperguessPayment(
  devFid?: number,
  authToken?: string | null
): UseSuperguessPaymentReturn {
  const { address } = useAccount();
  const [phase, setPhase] = useState<SuperguessPaymentPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);

  // Native ETH balance — what the purchase is now paid in. A first-time
  // player is far likelier to hold this than the reward token.
  const { data: ethBalance } = useBalance({
    address,
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
    (ethAmount: string, roundId?: number) => {
      if (!address) {
        setError('Wallet not connected');
        return;
      }

      setPhase('transferring');
      setError(null);
      setSessionId(null);

      if (!WORD_PACK_SALES_ADDRESS) {
        setError('Superguess purchases are not available yet');
        setPhase('error');
        return;
      }

      writeTransfer({
        address: WORD_PACK_SALES_ADDRESS,
        abi: WORD_PACK_SALES_ABI,
        functionName: 'buySuperguess',
        args: [BigInt(roundId ?? 0)],
        value: parseEther(ethAmount),
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
  }, [transferConfirmed, transferHash, phase, devFid, authToken]);

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
    ethBalance,
  };
}
