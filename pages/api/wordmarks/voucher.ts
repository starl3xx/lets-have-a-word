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
import { redis } from '../../../src/lib/redis';

/** Ten minutes. Long enough to approve a wallet prompt, short enough that a
 *  voucher found in a log later is worthless. */
const VOUCHER_TTL_SECONDS = 600;

export const MINT_AUTH_PREFIX = 'lhaw:mintauth:';

/** The key /api/paymaster looks up. Exported so the two cannot drift apart. */
export function mintAuthKey(signature: string): string {
  return `${MINT_AUTH_PREFIX}${ethers.keccak256(signature)}`;
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

    // Authorise the gas for THIS voucher and nothing else. Expires with it, so
    // an unused authorisation cannot be banked.
    await redis.set(mintAuthKey(signature), fid, { ex: VOUCHER_TTL_SECONDS });

    console.log(`[wordmarks/voucher] Issued ${type} (id ${id}) for FID ${fid} to ${to}`);

    return res.status(200).json({ fid, to, id, deadline, signature, contract });
  } catch (error) {
    console.error('[wordmarks/voucher] Failed to sign:', error);
    return res.status(500).json({ error: 'Could not create a voucher' });
  }
}
