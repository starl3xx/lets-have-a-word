/**
 * POST /api/wordmarks/voucher  { address }  ->  { fid, id, deadline, signature }
 *
 * Attests that the authenticated player earned a Wordmark, so they can mint it
 * themselves. The player sends the transaction, which is the entire point: an
 * airdrop from the operator wallet would put the tokens in the same wallets and
 * attribute one transacting address instead of thousands.
 *
 * THE FID COMES FROM THE SESSION, NEVER THE BODY. This endpoint's signature is
 * the only thing standing between a stranger and any Wordmark they fancy, so a
 * client-supplied fid would make it a free-badge faucet. That is exactly the
 * shape share-callback had before PR #295, and the same rule applies here with
 * more at stake, because a Wordmark cannot be revoked once it is onchain.
 *
 * `to` is bound into the signed payload rather than left to the caller, so a
 * voucher lifted out of somebody else's network response can only ever mint to
 * its rightful owner. See contracts/test/Wordmarks.test.ts.
 *
 * IT ALSO AUTHORISES THE GAS. A reverting transaction still consumes gas the
 * paymaster pays for, and the contract reverts on a replayed mint, so anybody
 * could loop failed mints and drain sponsorship without ever receiving a token.
 * Every voucher therefore records its own signature hash in Redis, and
 * /api/paymaster sponsors only mints carrying a signature it finds there.
 * No voucher, no sponsorship.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { ethers } from 'ethers';
import { db } from '../../../src/db';
import { userBadges } from '../../../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { resolveRequestFid } from '../../../src/lib/requestAuth';
import { tokenIdFor } from '../../../src/lib/wordmark-tokens';
import type { WordmarkType } from '../../../src/db/schema';
import { redis, RateLimiters, checkRateLimit } from '../../../src/lib/redis';

/** Ten minutes. Long enough to approve a wallet prompt, short enough that a
 *  voucher found in a log later is worthless. */
const VOUCHER_TTL_SECONDS = 600;

export const MINT_BUDGET_PREFIX = 'lhaw:mintbudget:';

/**
 * How many sponsorships one entitlement pays for.
 *
 * Not one. Three ordinary things ask for the same voucher twice: an upstream
 * paymaster timeout, a forwarded JSON-RPC error, and a wallet re-requesting
 * pm_getPaymasterData when gas estimates move. A strict one-shot turns each of
 * those into a mint the player cannot retry.
 *
 * Small, because every unit is a sponsored transaction that may revert. With
 * the mintedByFid check below refusing a second voucher for an already-minted
 * Wordmark, the worst case is this many sponsored failures per Wordmark a
 * player has genuinely earned and not yet claimed.
 */
export const MINT_SPONSOR_BUDGET = 3;

/**
 * The key /api/paymaster spends against. Exported so the two cannot drift.
 *
 * Keyed by (fid, id) — THE ENTITLEMENT — not by the voucher signature. The
 * deadline moves every second, so every re-request signs a fresh voucher, and
 * a signature-keyed budget minted a fresh budget with it: ~600 bankable
 * vouchers per TTL window from one earned Wordmark, each worth
 * MINT_SPONSOR_BUDGET sponsored reverts. A player only ever has one
 * entitlement per (fid, id), so that is what the budget is bound to; the NX
 * write below is what stops a re-issued voucher topping it back up.
 */
export function mintBudgetKey(fid: number | bigint, id: number | bigint): string {
  return `${MINT_BUDGET_PREFIX}${fid}:${id}`;
}

interface VoucherResponse {
  fid: number;
  to: string;
  id: number;
  deadline: number;
  signature: string;
  contract: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VoucherResponse | { error: string }>
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const attestorKey = process.env.WORDMARK_ATTESTOR_PRIVATE_KEY;
  const contract = process.env.NEXT_PUBLIC_WORDMARKS_ADDRESS;
  if (!attestorKey || !contract || !ethers.isAddress(contract)) {
    // Dormant until deployed, exactly like the paymaster. Not an error the
    // player can act on, so it does not pretend to be one.
    return res.status(503).json({ error: 'Minting is not available yet' });
  }

  const auth = await resolveRequestFid(req, { rejectUnverifiedMiniAppFid: true });
  if (!auth.ok) {
    return res.status(auth.status).json({ error: auth.error });
  }
  const fid = auth.fid;

  // Issuance is metered per fid. Twelve Wordmarks plus honest retries fit in
  // minutes; only a banking loop needs more. Fails open like every limiter
  // here — the NX budget write below is the hard bound, this just keeps the
  // signer from being a free computation service.
  const limit = await checkRateLimit(RateLimiters.packPurchase, `wordmark-voucher:${fid}`);
  if (!limit.success) {
    return res.status(429).json({ error: 'Too many voucher requests. Try again in a minute.' });
  }

  const { address, wordmark } = (req.body ?? {}) as {
    address?: string;
    wordmark?: string;
  };

  if (!address || !ethers.isAddress(address)) {
    return res.status(400).json({ error: 'Connect a wallet first' });
  }
  if (!wordmark || typeof wordmark !== 'string') {
    return res.status(400).json({ error: 'Which Wordmark?' });
  }

  const type = wordmark as WordmarkType;
  const id = tokenIdFor(type);
  if (id === undefined) {
    return res.status(400).json({ error: 'No such Wordmark' });
  }

  // The award itself. Read from user_badges rather than trusted from the
  // client, because this row IS the entitlement.
  const [earned] = await db
    .select({ id: userBadges.id })
    .from(userBadges)
    .where(and(eq(userBadges.fid, fid), eq(userBadges.badgeType, type)))
    .limit(1);

  if (!earned) {
    return res.status(403).json({ error: 'You have not earned that Wordmark' });
  }

  if (!redis) {
    // Fails CLOSED, like the SIWE nonce and the link code. Without Redis the
    // paymaster cannot check the authorisation, and issuing a voucher that
    // silently cannot be sponsored is worse than saying so.
    return res.status(503).json({ error: 'Minting is temporarily unavailable' });
  }

  // ALREADY MINTED IS A REFUSAL, NOT A NO-OP. Without this the endpoint keeps
  // issuing fresh, individually valid vouchers for a Wordmark that can only
  // ever revert onchain, and each one buys a sponsored failure. The database
  // cannot answer this — mintedByFid is the only authority — so it costs one
  // RPC read (Bugbot, PR #300).
  try {
    const provider = new ethers.JsonRpcProvider(
      process.env.BASE_RPC_URL || 'https://mainnet.base.org'
    );
    const wordmarks = new ethers.Contract(
      contract,
      ['function mintedByFid(uint256,uint256) view returns (bool)'],
      provider
    );
    if (await wordmarks.mintedByFid(fid, id)) {
      return res.status(409).json({ error: 'You have already minted that Wordmark' });
    }
  } catch (error) {
    // FAILS CLOSED. An RPC hiccup must not become a way to mint vouchers for
    // already-claimed Wordmarks by making the check unavailable.
    console.error('[wordmarks/voucher] Could not read mintedByFid:', error);
    return res.status(503).json({ error: 'Could not check your Wordmark. Try again.' });
  }

  const deadline = Math.floor(Date.now() / 1000) + VOUCHER_TTL_SECONDS;
  const to = ethers.getAddress(address);

  try {
    const signer = new ethers.Wallet(attestorKey);
    const signature = await signer.signTypedData(
      {
        name: 'LetsHaveAWordWordmarks',
        version: '1',
        chainId: 8453,
        verifyingContract: contract,
      },
      {
        Claim: [
          { name: 'fid', type: 'uint256' },
          { name: 'to', type: 'address' },
          { name: 'id', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { fid, to, id, deadline }
    );

    // Authorise the gas for THIS entitlement, for a bounded number of
    // attempts. NX is the bound: a re-requested voucher (new deadline, new
    // signature) must NOT refill a budget that spending or reverts already
    // drained — without NX, issuance was a banking loop. The corollary is
    // accepted and cheap: a player who burns the whole budget inside one TTL
    // window mints unsponsored until the key expires, at their own ~$0.0015.
    await redis.set(mintBudgetKey(fid, id), MINT_SPONSOR_BUDGET, {
      nx: true,
      ex: VOUCHER_TTL_SECONDS,
    });

    console.log(`[wordmarks/voucher] Issued ${type} (id ${id}) for FID ${fid} to ${to}`);

    return res.status(200).json({ fid, to, id, deadline, signature, contract });
  } catch (error) {
    console.error('[wordmarks/voucher] Failed to sign:', error);
    return res.status(500).json({ error: 'Could not create a voucher' });
  }
}
