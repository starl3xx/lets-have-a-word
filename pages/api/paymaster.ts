import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { ethers } from 'ethers';
import { willSponsor, type MintClaim } from '../../src/lib/paymaster-policy';
import { redis, RateLimiters, checkRateLimit } from '../../src/lib/redis';
import { mintBudgetKey } from './wordmarks/voucher';
import {
  hasBudget,
  spendBudget,
  refundBudget,
  type BudgetStore,
} from '../../src/lib/mint-sponsorship';

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
 *    only ever pays for guess-pack purchases and Wordmark mints whose voucher
 *    the attestor really signed and whose (fid, id) budget still has spend
 *    left. Requests are rate limited per sender+IP on top, because the
 *    buyPacks leg has no voucher to meter it.
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

/**
 * The attestor's ADDRESS, derived from the signing key the voucher endpoint
 * uses, memoised per key string so a rotation is picked up without a restart.
 * Null when unconfigured — and then no mint is sponsored, because a voucher
 * nobody can have signed is not one worth paying for.
 */
let attestorCache: { key: string; address: string } | null = null;
function attestorAddress(): string | null {
  const key = process.env.WORDMARK_ATTESTOR_PRIVATE_KEY;
  if (!key) return null;
  if (attestorCache?.key === key) return attestorCache.address;
  try {
    const address = new ethers.Wallet(key).address;
    attestorCache = { key, address };
    return address;
  } catch {
    return null;
  }
}

/**
 * Would the CONTRACT accept this voucher? Same domain the voucher endpoint
 * signs (chainId 8453 — mainnet-only, deliberately, like voucher.ts) and the
 * contract verifies. Without this check, any calldata naming a (fid, id)
 * that holds a live budget could spend it on guaranteed reverts: the budget
 * key proves a voucher was issued, the recovery proves THIS one is it.
 */
function voucherIsGenuine(claim: MintClaim, wordmarksAddress: string, attestor: string): boolean {
  try {
    const recovered = ethers.verifyTypedData(
      { name: 'LetsHaveAWordWordmarks', version: '1', chainId: 8453, verifyingContract: wordmarksAddress },
      {
        Claim: [
          { name: 'fid', type: 'uint256' },
          { name: 'to', type: 'address' },
          { name: 'id', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
      { fid: claim.fid, to: claim.to, id: claim.id, deadline: claim.deadline },
      claim.signature
    );
    return recovered.toLowerCase() === attestor.toLowerCase();
  } catch {
    return false;
  }
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
  const userOp = (params?.[0] ?? {}) as { callData?: string; sender?: string };

  // Metered twice. The IP bucket is the bound that actually holds: `sender`
  // is a body claim on an unauthenticated URL, so rotating it mints a fresh
  // bucket per request and any limiter keyed on it alone is decorative
  // (Bugbot, #321). The per-sender bucket exists only so one honest wallet
  // behind a shared NAT does not starve its neighbours' allowance. The
  // voucher budget bounds mint spend; this bounds how hard the voucher-less
  // buyPacks leg and the upstream's quota can be hammered. Fails open like
  // every limiter here.
  const sender = typeof userOp.sender === 'string' ? userOp.sender.toLowerCase() : 'unknown';
  const ip = (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim()
    || req.socket?.remoteAddress || 'unknown';
  const ipLimit = await checkRateLimit(RateLimiters.general, `paymaster-ip:${ip}`);
  if (!ipLimit.success) {
    return res.status(200).json(rpcError(id, -32000, 'Not sponsored: too many requests'));
  }
  const senderLimit = await checkRateLimit(RateLimiters.packPurchase, `paymaster:${sender}:${ip}`);
  if (!senderLimit.success) {
    return res.status(200).json(rpcError(id, -32000, 'Not sponsored: too many requests'));
  }

  const decision = willSponsor(userOp.callData ?? '', salesAddress, wordmarksAddress);

  if (!decision.allowed) {
    console.warn(`[paymaster] Refused to sponsor: ${decision.reason}`);
    return res.status(200).json(rpcError(id, -32000, `Not sponsored: ${decision.reason}`));
  }

  // A Wordmark mint is only sponsored if this server issued its voucher, and a
  // voucher pays for a BOUNDED number of sponsorships rather than an unlimited
  // one. The contract reverts on a replayed mint and a revert still consumes
  // gas, so a voucher that merely had to exist would let one issue fund an
  // unbounded run of failing mints for its whole ten-minute life.
  //
  // A budget rather than a single use, because three ordinary things ask for
  // the same voucher twice: an upstream timeout, a forwarded JSON-RPC error,
  // and a wallet re-requesting pm_getPaymasterData after gas changes. A strict
  // one-shot turns all three into a dead mint the player cannot retry. The
  // budget is small, so the drain stays bounded at MINT_SPONSOR_BUDGET
  // failures per voucher, and the voucher endpoint will not issue a second one
  // for a Wordmark that is already minted. (Bugbot, PR #300.)
  //
  // ERC-7677 is a two-call handshake and only the second leads to a real
  // transaction, so the stub call looks without spending.
  const mints = decision.requiresMints ?? [];
  const keys = mints.map((m) => mintBudgetKey(m.fid, m.id));

  if (mints.length) {
    if (!redis) {
      console.warn('[paymaster] Refusing a mint: no Redis to check the voucher against');
      return res.status(200).json(rpcError(id, -32000, 'Not sponsored: cannot verify voucher'));
    }

    // The voucher must be one the attestor actually signed. The budget key
    // only proves A voucher was issued for this (fid, id); calldata carrying
    // a junk signature against that key would spend an honest player's
    // budget on guaranteed reverts.
    const attestor = attestorAddress();
    if (!attestor) {
      console.warn('[paymaster] Refusing a mint: no attestor key to verify vouchers against');
      return res.status(200).json(rpcError(id, -32000, 'Not sponsored: cannot verify voucher'));
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    for (const claim of mints) {
      if (!voucherIsGenuine(claim, wordmarksAddress!, attestor)) {
        console.warn('[paymaster] Refusing a mint whose voucher the attestor never signed');
        return res.status(200).json(rpcError(id, -32000, 'Not sponsored: invalid voucher'));
      }
      // The contract reverts a lapsed voucher, so sponsoring one buys a
      // guaranteed revert. A genuine-but-expired signature outlives its own
      // budget key: after a re-issue recreates the (fid, id) budget, the OLD
      // signature would otherwise spend the NEW budget on nothing (Bugbot,
      // #321). <= now, because a mint signed for this exact second cannot
      // reach a block before it lapses either.
      if (Number(claim.deadline) <= nowSeconds) {
        console.warn('[paymaster] Refusing a mint whose voucher deadline has passed');
        return res.status(200).json(rpcError(id, -32000, 'Not sponsored: expired voucher'));
      }
    }

    // Advisory pre-filter only — the DECR below is the arbiter. Guarded,
    // because the real Upstash client throws where the old test fake never
    // did, and an unguarded throw here handed the blocked wallet a raw 500
    // instead of the graceful fall-back-to-own-gas every other path returns.
    try {
      if (!(await hasBudget(redis as unknown as BudgetStore, keys))) {
        console.warn('[paymaster] Refusing a mint with no remaining voucher budget');
        return res.status(200).json(rpcError(id, -32000, 'Not sponsored: no voucher for this mint'));
      }
    } catch (error) {
      console.error('[paymaster] Could not read the voucher budget:', error);
      Sentry.captureException(error, { tags: { component: 'paymaster' } });
      return res.status(200).json(rpcError(id, -32000, 'Not sponsored: cannot verify voucher'));
    }
  }

  const spendKeys = method === 'pm_getPaymasterData' ? keys : [];
  // Refund exactly what was spent — never keys a failed spend already
  // compensated, never keys whose DECR never landed.
  let spentKeys: string[] = [];
  const refund = () =>
    redis && spentKeys.length
      ? refundBudget(redis as unknown as BudgetStore, spentKeys)
      : Promise.resolve();

  try {
    // Spent BEFORE the upstream call, because that call is what costs money.
    // The spend's own DECR results arbitrate concurrency: however many
    // requests raced past the advisory check above, only budget-many come
    // back ok. Refunded on any path where no sponsorship was actually issued.
    if (redis && spendKeys.length) {
      const spend = await spendBudget(redis as unknown as BudgetStore, spendKeys);
      spentKeys = spend.spent;
      if (!spend.ok) {
        await refund();
        console.warn('[paymaster] Refusing a mint that lost the budget race');
        return res.status(200).json(rpcError(id, -32000, 'Not sponsored: no voucher for this mint'));
      }
    }

    const upstreamRes = await fetch(upstream, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id ?? 1, method, params }),
      // A wallet is blocked on this call, so it cannot hang indefinitely.
      signal: AbortSignal.timeout(10_000),
    });

    const json = await upstreamRes.json();

    // A forwarded error is not a sponsorship. Charging the voucher for one
    // would spend the player's only retry on the upstream's bad day.
    if (!upstreamRes.ok || json?.error) {
      await refund();
    }
    return res.status(200).json(json);
  } catch (error) {
    // A timeout is the loudest case: the wallet is blocked, the upstream never
    // signed anything, and without this the voucher would be gone and an honest
    // mint dead with no way to retry it.
    await refund();
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[paymaster] Upstream call failed:', message);
    Sentry.captureException(error, { tags: { component: 'paymaster' } });
    // Reported as an RPC error rather than a 500 so the wallet falls back to
    // the user paying rather than failing the purchase outright.
    return res.status(200).json(rpcError(id, -32000, 'Paymaster upstream unavailable'));
  }
}
