/**
 * Hook for purchasing guesses onchain
 * Milestone 6.4 - On-chain pack purchases
 *
 * Uses wagmi to call purchaseGuesses() on the JackpotManager contract
 */

import { useWriteContract, useWaitForTransactionReceipt } from 'wagmi';
import { parseEther } from 'viem';
import { base } from 'wagmi/chains';

// JackpotManager contract ABI (minimal - just purchaseGuesses)
const JACKPOT_MANAGER_ABI = [
  {
    name: 'purchaseGuesses',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'player', type: 'address' },
      { name: 'quantity', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'GuessesPurchased',
    type: 'event',
    inputs: [
      { name: 'roundNumber', type: 'uint256', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'quantity', type: 'uint256', indexed: false },
      { name: 'ethAmount', type: 'uint256', indexed: false },
      { name: 'toJackpot', type: 'uint256', indexed: false },
      { name: 'toCreator', type: 'uint256', indexed: false },
    ],
  },
] as const;

// Contract address from environment
const JACKPOT_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_JACKPOT_MANAGER_ADDRESS as `0x${string}`;

export interface PurchaseGuessesParams {
  playerAddress: `0x${string}`;
  quantity: number;
  totalPriceEth: string;
}

export interface UsePurchaseGuessesReturn {
  purchaseGuesses: (params: PurchaseGuessesParams) => void;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: Error | null;
  txHash: `0x${string}` | undefined;
  reset: () => void;
}

/**
 * Hook for onchain guess pack purchases
 *
 * Usage:
 * ```
 * const { purchaseGuesses, isPending, isConfirming, isSuccess, error } = usePurchaseGuesses();
 *
 * // Initiate purchase
 * purchaseGuesses({
 *   playerAddress: '0x...',
 *   quantity: 3, // 1 pack = 3 guesses
 *   totalPriceEth: '0.0003',
 * });
 * ```
 */
export function usePurchaseGuesses(): UsePurchaseGuessesReturn {
  const {
    writeContract,
    data: txHash,
    isPending,
    isError: isWriteError,
    error: writeError,
    reset,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  const purchaseGuesses = (params: PurchaseGuessesParams) => {
    if (!JACKPOT_MANAGER_ADDRESS) {
      console.error('[usePurchaseGuesses] NEXT_PUBLIC_JACKPOT_MANAGER_ADDRESS not configured');
      return;
    }

    writeContract({
      address: JACKPOT_MANAGER_ADDRESS,
      abi: JACKPOT_MANAGER_ABI,
      functionName: 'purchaseGuesses',
      args: [params.playerAddress, BigInt(params.quantity)],
      value: parseEther(params.totalPriceEth),
      chainId: base.id,
    });
  };

  return {
    purchaseGuesses,
    isPending,
    isConfirming,
    isSuccess,
    isError: isWriteError || isReceiptError,
    error: writeError || receiptError || null,
    txHash,
    reset,
  };
}
