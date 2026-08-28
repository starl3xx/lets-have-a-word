import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { willSponsor } from '../../src/lib/paymaster-policy';
import { redis } from '../../src/lib/redis';
import { mintAuthKey } from './wordmarks/voucher';

/**
 * POST /api/paymaster — ERC-7677 paymaster proxy
 *
 * The wallet calls this URL directly during a sponsored transaction, so it is
 * public by necessity. Two things follow, and both are the reason this exists
 * rather than handing the real paymaster URL to the client:
 *
 * 1. The upstream URL usually carries an API key. Shipping it to the browser
 *    would let anyone drain the sponsorship balance.
 * 2. A paymaster with no policy sponsors anything. Every request is checked
 *    against `willSponsor` before a single call is forwarded, so this endpoint
 *    can only ever pay for guess-pack purchases.
 *
 * Methods are the ERC-7677 pair: pm_getPaymasterStubData for gas estimation
 * and pm_getPaymasterData for the real signature. Both carry the user
 * operation as the first parameter, so both get the same check.
 *
 * Dormant until PAYMASTER_SERVICE_URL is set: without it the endpoint reports
 * that sponsorship is unavailable and the client falls back to the user paying
 * their own gas, which is exactly today's behaviour.
 */

const SPONSORED_METHODS = new Set(['pm_getPaymasterStubData', 'pm_getPaymasterData']);

function rpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const upstream = process.env.PAYMASTER_SERVICE_URL;
  const salesAddress =
    process.env.NEXT_PUBLIC_WORD_PACK_SALES_ADDRESS || process.env.WORD_PACK_SALES_ADDRESS || null;
  const wordmarksAddress = process.env.NEXT_PUBLIC_WORDMARKS_ADDRESS || null;

  const { id, method, params } = (req.body ?? {}) as {
    id?: unknown;
    method?: string;
    params?: unknown[];
  };

  if (!upstream) {
    // Not an error: the client treats an unavailable paymaster as "user pays
    // their own gas" and carries on.
    return res.status(200).json(rpcError(id, -32000, 'Sponsorship unavailable'));
  }

  if (!method || !SPONSORED_METHODS.has(method)) {
    return res.status(200).json(rpcError(id, -32601, `Method ${method ?? '(none)'} not supported`));
  }

  // params[0] is the user operation for both ERC-7677 methods.
  const userOp = (params?.[0] ?? {}) as { callData?: string };
  const decision = willSponsor(userOp.callData ?? '', salesAddress, wordmarksAddress);

  if (!decision.allowed) {
    console.warn(`[paymaster] Refused to sponsor: ${decision.reason}`);
    return res.status(200).json(rpcError(id, -32000, `Not sponsored: ${decision.reason}`));
  }

  // A Wordmark mint is only sponsored if this server issued its voucher, and
  // ONE VOUCHER BUYS ONE SPONSORSHIP. The contract reverts on a replayed mint
  // and a revert still consumes gas, so merely reading the voucher and leaving
  // it in place would let a single issued voucher fund an unbounded number of
  // failing mints for its whole ten-minute life — the exact drain this check
  // exists to stop (Bugbot, PR #300).
  //
  // ERC-7677 is a two-call handshake and only the second one leads to a real
  // transaction, so the stub call may look but must not consume. Consuming on
  // the stub would break every honest mint, since the wallet would find the
  // voucher gone when it came back for the real signature.
  if (decision.requiresVouchers?.length) {
    if (!redis) {
      console.warn('[paymaster] Refusing a mint: no Redis to check the voucher against');
      return res.status(200).json(rpcError(id, -32000, 'Not sponsored: cannot verify voucher'));
    }

    const consume = method === 'pm_getPaymasterData';
    const spent: string[] = [];

    for (const signature of decision.requiresVouchers) {
      const key = mintAuthKey(signature);
      const authorised = consume ? await redis.getdel(key) : await redis.get(key);

      if (authorised === null || authorised === undefined) {
        // Put back anything already taken in this batch. Otherwise one bad call
        // at the end silently burns the vouchers in front of it and the player
        // has to walk back to the app for new ones.
        for (const s of spent) {
          await redis.set(mintAuthKey(s), authorised ?? 1, { ex: 600 });
        }
        console.warn('[paymaster] Refusing a mint with no matching voucher');
        return res
          .status(200)
          .json(rpcError(id, -32000, 'Not sponsored: no voucher for this mint'));
      }
      if (consume) spent.push(signature);
    }
  }

  try {
    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id ?? 1, method, params }),
      // A wallet is blocked on this call, so it cannot hang indefinitely.
      signal: AbortSignal.timeout(10_000),
    });

    const json = await upstreamRes.json();
    return res.status(200).json(json);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[paymaster] Upstream call failed:', message);
    Sentry.captureException(error, { tags: { component: 'paymaster' } });
    // Reported as an RPC error rather than a 500 so the wallet falls back to
    // the user paying rather than failing the purchase outright.
    return res.status(200).json(rpcError(id, -32000, 'Paymaster upstream unavailable'));
  }
}
