/**
 * Hook for purchasing guesses onchain
 * Milestone 6.4 - Onchain pack purchases
 *
 * Uses wagmi to call purchaseGuesses() on the JackpotManager contract
 */

import { useState, useCallback, useMemo } from 'react';
import {
  useWriteContract,
  useWaitForTransactionReceipt,
  useCapabilities,
  useSendCalls,
  useWaitForCallsStatus,
} from 'wagmi';
import { parseEther, encodeFunctionData } from 'viem';
import { base } from 'wagmi/chains';
import { ERC_8021_SUFFIX } from '../config/wagmi';

/**
 * Where the wallet fetches sponsorship from. Our own proxy, never the upstream
 * paymaster: the real URL carries an API key, and the proxy is where the policy
 * lives that stops this sponsoring anything other than a pack purchase.
 *
 * Absolute because the wallet — which may be a different origin, or an app —
 * is the one making the request, not the page.
 *
 * The ERC-4337 bundling hazard this used to warn about is fixed: a purchase is
 * keyed on (tx_hash, log_index) rather than tx_hash, so two players batched
 * into one transaction are each credited for their own event rather than the
 * second being refused as a duplicate after paying. Needs migration 0025.
 */
function paymasterUrl(): string | null {
  if (process.env.NEXT_PUBLIC_PAYMASTER_ENABLED !== 'true') return null;
  if (typeof window === 'undefined') return null;
  return `${window.location.origin}/api/paymaster`;
}

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

/**
 * WordPackSales — the rail from round 34 on.
 *
 * Two differences from purchaseGuesses that matter here. The payer is
 * msg.sender rather than an argument, so the backend can trust who paid; and
 * there is no roundActive modifier, so selling a pack no longer requires
 * JackpotManagerV3 to have a live round (which required meeting its 0.02 ETH
 * minimum seed — the trap that stopped the game).
 */
const WORD_PACK_SALES_ABI = [
  {
    name: 'buyPacks',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'packCount', type: 'uint32' },
      { name: 'roundId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'PacksPurchased',
    type: 'event',
    inputs: [
      { name: 'payer', type: 'address', indexed: true },
      { name: 'roundId', type: 'uint256', indexed: true },
      { name: 'packCount', type: 'uint32', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const;

// Contract addresses from environment
const JACKPOT_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_JACKPOT_MANAGER_ADDRESS as `0x${string}`;
const WORD_PACK_SALES_ADDRESS = process.env
  .NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS as `0x${string}` | undefined;

export interface PurchaseGuessesParams {
  playerAddress: `0x${string}`;
  quantity: number;
  totalPriceEth: string;
  /**
   * Number of packs. Required by WordPackSales, which counts packs rather than
   * guesses; derived from quantity when not supplied.
   */
  packCount?: number;
  /**
   * Round id, recorded in the event for reconciliation. The server prices and
   * credits the purchase itself and does not require this to match, so it is a
   * label rather than a control — 0 when the client has no round in context.
   */
  roundId?: number;
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
  /** True if the contract address is not configured */
  isConfigError: boolean;
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
 *   totalPriceEth: '0.0004',
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
    reset: resetWrite,
  } = useWriteContract();

  const {
    isLoading: isConfirming,
    isSuccess,
    isError: isReceiptError,
    error: receiptError,
  } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // ---------------------------------------------------------------------
  // Sponsored path (EIP-5792 + ERC-7677)
  //
  // Farcaster users arrive on ERC-4337 smart accounts, and today they need
  // Base ETH for gas *on top of* the pack price. Where the wallet advertises
  // paymasterService support we route the same call through wallet_sendCalls
  // with the paymaster attached, so the pack costs exactly its price.
  //
  // Strictly additive: every branch below falls back to writeContract, so a
  // wallet without the capability, a disabled flag, or a paymaster that
  // refuses all behave exactly as they do now — the user pays their own gas
  // and the purchase still goes through. Sponsorship is never load-bearing.
  // ---------------------------------------------------------------------
  const { data: capabilities } = useCapabilities();
  const {
    sendCalls,
    data: sendCallsResult,
    isPending: isSendCallsPending,
    isError: isSendCallsError,
    error: sendCallsError,
    reset: resetSendCalls,
  } = useSendCalls();

  const {
    data: callsStatus,
    isLoading: isCallsConfirming,
    isError: isCallsStatusError,
    error: callsStatusError,
  } = useWaitForCallsStatus({ id: sendCallsResult?.id });

  const canSponsor = useMemo(() => {
    if (!paymasterUrl()) return false;
    const forChain = capabilities?.[base.id] as
      | { paymasterService?: { supported?: boolean } }
      | undefined;
    return forChain?.paymasterService?.supported === true;
  }, [capabilities]);

  // The bundle resolves to one or more receipts; the pack purchase is the only
  // call in ours, so its transaction hash is the one the server verifies.
  const sponsoredTxHash = callsStatus?.receipts?.[0]?.transactionHash;

  // Track configuration errors separately
  const [configError, setConfigError] = useState<Error | null>(null);
  // Either rail makes purchases possible, so this is only an error when neither
  // address is set.
  const isConfigError = !JACKPOT_MANAGER_ADDRESS && !WORD_PACK_SALES_ADDRESS;

  const purchaseGuesses = useCallback((params: PurchaseGuessesParams) => {
    // Clear any previous config error
    setConfigError(null);

    const value = parseEther(params.totalPriceEth);

    // WordPackSales takes precedence once deployed. The server accepts both
    // rails, so a client and server that disagree about the cutover still
    // transact correctly.
    if (WORD_PACK_SALES_ADDRESS) {
      const packCount = params.packCount ?? Math.max(1, Math.round(params.quantity / 3));

      const url = paymasterUrl();
      if (canSponsor && url) {
        sendCalls({
          calls: [
            {
              to: WORD_PACK_SALES_ADDRESS,
              value,
              data: (encodeFunctionData({
                abi: WORD_PACK_SALES_ABI,
                functionName: 'buyPacks',
                args: [packCount, BigInt(params.roundId ?? 0)],
              }) + ERC_8021_SUFFIX.slice(2)) as `0x${string}`,
            },
          ],
          capabilities: { paymasterService: { url } },
        });
        return;
      }

      writeContract({
        address: WORD_PACK_SALES_ADDRESS,
        abi: WORD_PACK_SALES_ABI,
        functionName: 'buyPacks',
        args: [packCount, BigInt(params.roundId ?? 0)],
        value,
        chainId: base.id,
        dataSuffix: ERC_8021_SUFFIX,
      });
      return;
    }

    if (!JACKPOT_MANAGER_ADDRESS) {
      const error = new Error('Pack purchases are not available. Contract address not configured.');
      console.error(
        '[usePurchaseGuesses] Neither NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS nor NEXT_PUBLIC_JACKPOT_MANAGER_ADDRESS is configured'
      );
      setConfigError(error);
      return;
    }

    writeContract({
      address: JACKPOT_MANAGER_ADDRESS,
      abi: JACKPOT_MANAGER_ABI,
      functionName: 'purchaseGuesses',
      args: [params.playerAddress, BigInt(params.quantity)],
      value,
      chainId: base.id,
      // Append Base Builder Code for attribution tracking
      dataSuffix: ERC_8021_SUFFIX,
    });
  }, [writeContract, sendCalls, canSponsor]);

  const reset = useCallback(() => {
    setConfigError(null);
    resetWrite();
    resetSendCalls();
  }, [resetWrite, resetSendCalls]);

  // The two paths are merged here so callers see one interface and do not have
  // to know whether a purchase was sponsored. Success on the sponsored path
  // means the bundle confirmed AND produced a receipt — the server needs a
  // transaction hash to verify against, so a confirmed bundle without one is
  // not yet success.
  const sponsoredSuccess = callsStatus?.status === 'success' && !!sponsoredTxHash;

  return {
    purchaseGuesses,
    isPending: isPending || isSendCallsPending,
    isConfirming: isConfirming || isCallsConfirming,
    isSuccess: isSuccess || sponsoredSuccess,
    isError:
      isWriteError || isReceiptError || isSendCallsError || isCallsStatusError || !!configError,
    error:
      configError || writeError || receiptError || sendCallsError || callsStatusError || null,
    txHash: txHash ?? sponsoredTxHash,
    reset,
    isConfigError,
  };
}
