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
  useConnect,
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
  /** Quick Auth token. The voucher endpoint authenticates, and a Farcaster
   *  player's ONLY credential is this token — playerSessionHeaders() below
   *  carries the wallet session, which a Farcaster player does not have.
   *  Without it, every mint from a Farcaster host died on "Authentication
   *  required" (found on the first real mainnet mint, 2026-09-08). Same
   *  threading #295 gave the share bonus. */
  authToken?: string | null;
}

export default function WordmarkMintButton({ wordmark, fid, authToken }: Props) {
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors } = useConnect();
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

  const {
    data: txHash,
    writeContract,
    reset: resetWrite,
    error: writeError,
  } = useWriteContract();
  // useSendCalls resolves to a bundle id, not a receipt. The receipt arrives
  // separately, which is why the sponsored branch cannot simply await it.
  const {
    data: sendCallsResult,
    sendCalls,
    reset: resetSendCalls,
    error: sendCallsError,
  } = useSendCalls();
  const { data: callsStatus, error: callsStatusError } = useWaitForCallsStatus({
    id: sendCallsResult?.id,
  });
  const { data: capabilities } = useCapabilities();
  const { data: receipt, error: receiptError } = useWaitForTransactionReceipt({ hash: txHash });

  // A RECEIPT IS NOT A SUCCESS. A reverted transaction has one too, so an
  // expired voucher or a replayed mint would otherwise flip the button to
  // "Minted" having minted nothing (Bugbot, PR #300).
  const mined = receipt?.status === 'success';

  const canSponsor = Boolean(
    paymasterUrl() &&
      (capabilities?.[base.id] as { paymasterService?: { supported?: boolean } } | undefined)
        ?.paymasterService?.supported === true
  );

  // Both rails converge here so the button does not have to know which one ran.
  const done = mined || sponsoredDone || alreadyMinted === true;

  useEffect(() => {
    // Same bar the pack purchase uses: the bundle has to have CONFIRMED, not
    // merely produced a receipt. A reverted userOp still has one.
    if (callsStatus?.status === 'success' && callsStatus.receipts?.[0]?.transactionHash) {
      setSponsoredDone(true);
    }
  }, [callsStatus]);

  useEffect(() => {
    if (mined || sponsoredDone) {
      setBusy(false);
      void haptics.shareCompleted();
      void refetchMinted();
    }
  }, [mined, sponsoredDone, refetchMinted]);

  // NEITHER writeContract NOR sendCalls IS AWAITED, so a rejected prompt or a
  // failed bundle never reaches the try/catch around them. It lands in these
  // flags instead, and without reading them the button stayed disabled on
  // "Check your wallet..." until the modal was closed (Bugbot, PR #300).
  const walletError = writeError || sendCallsError || callsStatusError || receiptError;
  useEffect(() => {
    if (!walletError) return;
    setBusy(false);
    const message = walletError.message ?? '';
    // A rejection is a decision, not a fault. Saying "something went wrong"
    // to somebody who just pressed cancel reads as a bug in the app.
    setError(
      /reject|denied|cancel/i.test(message)
        ? 'You cancelled the signature.'
        : 'That mint did not go through. Try again.'
    );
  }, [walletError]);

  // A reverted transaction is not an error the hooks report: the receipt
  // arrives normally and simply says "reverted".
  useEffect(() => {
    if (receipt && receipt.status !== 'success') {
      setBusy(false);
      setError('That mint did not go through. Try again.');
    }
  }, [receipt]);

  const mint = useCallback(async () => {
    if (!WORDMARKS_ADDRESS || id === undefined) return;
    // Busy from the FIRST tap: the connect prompt below can sit open for a
    // while, and a second tap during it would start a parallel
    // connect-and-mint — two vouchers, two wallet prompts (Bugbot, #322).
    if (busy) return;
    setBusy(true);
    setError(null);

    // Base App ALWAYS has a wallet, so "connect a wallet first" was a dead
    // end there: the webview sheds wagmi's stored connection state while the
    // session cookie survives, and a signed-in player has no other surface
    // that offers to reconnect (reported from a Base App device,
    // 2026-09-08). Connect in place instead, with the sign-in flow's own
    // preference order: injected only when a provider actually exists (it
    // carries Base App's wallet), Base Account for plain web. Never the
    // Farcaster connector — in a host it is already auto-connected before
    // this button can render.
    let mintTo = address;
    let sponsorNow = canSponsor;
    if (!isConnected || !mintTo) {
      const hasInjectedProvider =
        typeof window !== 'undefined' &&
        (window as unknown as { ethereum?: unknown }).ethereum != null;
      const injectedConnector = connectors.find((c) => c.id === 'injected');
      const baseConnector = connectors.find((c) => c.id.toLowerCase().includes('base'));
      const candidates = [
        ...(hasInjectedProvider && injectedConnector ? [injectedConnector] : []),
        ...(baseConnector ? [baseConnector] : []),
      ];
      let connectedVia: (typeof candidates)[number] | null = null;
      for (const connector of candidates) {
        try {
          const result = await connectAsync({ connector });
          mintTo = result.accounts[0];
          connectedVia = connector;
          break;
        } catch (err) {
          // A rejection is a decision, and shopping it to the next connector
          // would answer a dismissed popup with another popup (Bugbot, #322,
          // matching useWalletSignIn's stop-on-rejection). Any other failure
          // falls through to the next candidate.
          if (/reject|denied|cancel/i.test(String((err as Error)?.message ?? ''))) {
            setBusy(false);
            setError('You cancelled the connection.');
            return;
          }
        }
      }
      if (!mintTo || !connectedVia) {
        setBusy(false);
        setError('Connect a wallet first');
        return;
      }
      // The render's `canSponsor` was computed with NO account, so it is
      // false here even where the wallet advertises paymasterService — the
      // same stale closure mintTo exists for, on the sponsorship axis
      // (Bugbot, #322). Ask the freshly connected wallet directly; any
      // failure just means self-paid, which every wallet can do.
      sponsorNow = false;
      if (paymasterUrl()) {
        try {
          const provider = (await connectedVia.getProvider()) as {
            request: (args: { method: string; params: unknown[] }) => Promise<unknown>;
          };
          const caps = (await provider.request({
            method: 'wallet_getCapabilities',
            params: [mintTo],
          })) as Record<string | number, { paymasterService?: { supported?: boolean } }> | null;
          const chainCaps = caps?.[`0x${base.id.toString(16)}`] ?? caps?.[base.id];
          sponsorNow = chainCaps?.paymasterService?.supported === true;
        } catch {
          // Self-paid it is.
        }
      }
    }

    void haptics.buttonTapMinor();
    resetWrite();
    resetSendCalls();

    try {
      // Both credentials travel: authToken is the Farcaster carrier, the
      // session header is the wallet carrier. resolveRequestFid tries every
      // presented credential, so whichever kind of player this is, one works.
      const res = await fetch('/api/wordmarks/voucher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...playerSessionHeaders() },
        // mintTo, not the hook's address: a connection made two lines up is
        // not in this render's closure yet.
        body: JSON.stringify({ address: mintTo, wordmark: wordmark.id, authToken }),
      });
      const v = await res.json().catch(() => null);
      if (!res.ok || !v?.signature) {
        throw new Error(v?.error || 'Could not get permission to mint');
      }

      const args = [BigInt(v.fid), v.to as `0x${string}`, BigInt(v.id), BigInt(v.deadline), v.signature as `0x${string}`] as const;

      const url = paymasterUrl();
      if (sponsorNow && url) {
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
    // authToken belongs in the deps: Quick Auth resolves AFTER first render,
    // and a stale closure here would send the null from before it arrived —
    // the same "Authentication required" this prop exists to fix (Bugbot).
  }, [address, isConnected, busy, wordmark.id, id, authToken, canSponsor, sendCalls, writeContract, resetWrite, resetSendCalls, connectAsync, connectors]);

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
