import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { willSponsor } from '../../src/lib/paymaster-policy';
import { redis } from '../../src/lib/redis';
import { mintAuthKey } from './wordmarks/voucher';
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
  const spend = method === 'pm_getPaymasterData' ? decision.requiresVouchers ?? [] : [];
  const keys = (decision.requiresVouchers ?? []).map(mintAuthKey);

  if (decision.requiresVouchers?.length) {
    if (!redis) {
      console.warn('[paymaster] Refusing a mint: no Redis to check the voucher against');
      return res.status(200).json(rpcError(id, -32000, 'Not sponsored: cannot verify voucher'));
    }

    if (!(await hasBudget(redis as unknown as BudgetStore, keys))) {
      console.warn('[paymaster] Refusing a mint with no remaining voucher budget');
      return res.status(200).json(rpcError(id, -32000, 'Not sponsored: no voucher for this mint'));
    }
  }

  const spendKeys = spend.map(mintAuthKey);
  const refund = () =>
    redis ? refundBudget(redis as unknown as BudgetStore, spendKeys) : Promise.resolve();

  try {
    // Spent BEFORE the upstream call, because that call is what costs money and
    // two concurrent requests must not both find the budget intact. Refunded on
    // any path where no sponsorship was actually issued.
    if (redis) await spendBudget(redis as unknown as BudgetStore, spendKeys);

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
