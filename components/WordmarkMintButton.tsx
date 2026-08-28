/**
 * Mint an earned Wordmark to the player's own wallet.
 *
 * THE PLAYER SENDS THIS TRANSACTION. The house could airdrop the whole set from
 * the operator wallet for less effort, and it would attribute one transacting
 * address instead of thousands. A Wordmark is the player's, so the player mints
 * it, and the ERC-8021 suffix on their call is what credits the app.
 *
 * Dormant until NEXT_PUBLIC_WORDMARKS_ADDRESS is set, like every other
 * era-gated surface here: before deploy this renders nothing at all rather than
 * a button that cannot work.
 *
 * The "already minted" state is read from the contract rather than stored in
 * the database. mintedByFid is the only authority that matters — it is what the
 * mint will actually be checked against — and a mirrored column could disagree
 * with it after a failed write, which is the sort of disagreement that ends
 * with a player being told they already hold something they do not.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
  useReadContract,
  useSendCalls,
  useWaitForCallsStatus,
  useCapabilities,
} from 'wagmi';
import { base } from 'wagmi/chains';
import { encodeFunctionData } from 'viem';
import { ERC_8021_SUFFIX } from '../src/config/wagmi';
import { WORDMARK_MINT_ABI, WORDMARK_MINTED_ABI, tokenIdFor } from '../src/lib/wordmark-tokens';
import { playerSessionHeaders } from '../src/lib/playerSessionClient';
import { haptics } from '../src/lib/haptics';
import type { UserWordmark } from '../src/lib/wordmarks';

const WORDMARKS_ADDRESS = process.env.NEXT_PUBLIC_WORDMARKS_ADDRESS as `0x${string}` | undefined;

/** Same proxy the pack purchase uses: never the upstream URL, which carries a key. */
function paymasterUrl(): string | null {
  if (process.env.NEXT_PUBLIC_PAYMASTER_ENABLED !== 'true') return null;
  if (typeof window === 'undefined') return null;
  return `${window.location.origin}/api/paymaster`;
}

interface Props {
  wordmark: UserWordmark;
  fid: number;
}

export default function WordmarkMintButton({ wordmark, fid }: Props) {
  const { address, isConnected } = useAccount();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sponsoredDone, setSponsoredDone] = useState(false);

  const id = tokenIdFor(wordmark.id);

  const { data: alreadyMinted, refetch: refetchMinted } = useReadContract({
    address: WORDMARKS_ADDRESS,
    abi: WORDMARK_MINTED_ABI,
    functionName: 'mintedByFid',
    args: [BigInt(fid), BigInt(id ?? 0)],
    chainId: base.id,
    query: { enabled: Boolean(WORDMARKS_ADDRESS) && id !== undefined && fid > 0 },
  });

  const { data: txHash, writeContract, reset: resetWrite } = useWriteContract();
  // useSendCalls resolves to a bundle id, not a receipt. The receipt arrives
  // separately, which is why the sponsored branch cannot simply await it.
  const { data: sendCallsResult, sendCalls, reset: resetSendCalls } = useSendCalls();
  const { data: callsStatus } = useWaitForCallsStatus({ id: sendCallsResult?.id });
  const { data: capabilities } = useCapabilities();
  const { isSuccess: mined } = useWaitForTransactionReceipt({ hash: txHash });

  const canSponsor = Boolean(
    paymasterUrl() &&
      (capabilities?.[base.id] as { paymasterService?: { supported?: boolean } } | undefined)
        ?.paymasterService?.supported === true
  );

  // Both rails converge here so the button does not have to know which one ran.
  const done = mined || sponsoredDone || alreadyMinted === true;

  useEffect(() => {
    if (callsStatus?.receipts?.[0]?.transactionHash) setSponsoredDone(true);
  }, [callsStatus]);

  useEffect(() => {
    if (mined || sponsoredDone) {
      setBusy(false);
      void haptics.shareCompleted();
      void refetchMinted();
    }
  }, [mined, sponsoredDone, refetchMinted]);

  const mint = useCallback(async () => {
    if (!WORDMARKS_ADDRESS || id === undefined) return;
    if (!isConnected || !address) {
      setError('Connect a wallet first');
      return;
    }

    void haptics.buttonTapMinor();
    setBusy(true);
    setError(null);
    resetWrite();
    resetSendCalls();

    try {
      const res = await fetch('/api/wordmarks/voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...playerSessionHeaders() },
        body: JSON.stringify({ address, wordmark: wordmark.id }),
      });
      const v = await res.json().catch(() => null);
      if (!res.ok || !v?.signature) {
        throw new Error(v?.error || 'Could not get permission to mint');
      }

      const args = [BigInt(v.fid), v.to as `0x${string}`, BigInt(v.id), BigInt(v.deadline), v.signature as `0x${string}`] as const;

      const url = paymasterUrl();
      if (canSponsor && url) {
        sendCalls({
          calls: [
            {
              to: WORDMARKS_ADDRESS,
              // Concatenated rather than passed as a capability: the suffix has
              // to survive whatever the wallet does with the call, and this is
              // the form the pack purchase already proved out.
              data: (encodeFunctionData({
                abi: WORDMARK_MINT_ABI,
                functionName: 'mint',
                args,
              }) + ERC_8021_SUFFIX.slice(2)) as `0x${string}`,
            },
          ],
          capabilities: { paymasterService: { url } },
        });
        return;
      }

      writeContract({
        address: WORDMARKS_ADDRESS,
        abi: WORDMARK_MINT_ABI,
        functionName: 'mint',
        args,
        chainId: base.id,
        dataSuffix: ERC_8021_SUFFIX,
      });
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error ? err.message : 'Could not mint');
    }
  }, [address, isConnected, wordmark.id, id, canSponsor, sendCalls, writeContract, resetWrite, resetSendCalls]);

  // Not deployed, not an onchain Wordmark, or not actually earned: say nothing.
  if (!WORDMARKS_ADDRESS || id === undefined || !wordmark.earned) return null;

  if (done) {
    return (
      <p className="text-xs text-emerald-700 font-semibold">
        Minted to your wallet ✓
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <button
        onClick={() => void mint()}
        disabled={busy}
        className="btn-secondary w-full text-sm"
      >
        {busy ? 'Check your wallet...' : 'Mint this Wordmark'}
      </button>
      <p className="text-xs text-gray-500">
        Puts it in your wallet, onchain. {canSponsor ? 'Gas is on us.' : 'Costs a fraction of a cent.'}
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
