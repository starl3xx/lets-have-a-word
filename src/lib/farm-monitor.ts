/**
 * Farm Monitor — pure signature logic + funding-source lookup
 *
 * The reward gate ($3 hold-or-stake to play) prices out the mass swarm class
 * (rounds 28/29/33: buying $4.4K–$8.8K of a ~$25K-mcap token is not
 * realistic). The residual class is the SMALL FUNDED FARM (round 32: 59
 * accounts, ~$177 of capital). This module detects both classes from data,
 * so the four guess-path gates can stay OFF at launch and only turn on if
 * real evidence returns.
 *
 * Definitions are calibrated against production (verified 2026-08-15):
 *  - "new guesser" = MIN(guesses.round_id) = N, the same basis as the
 *    grandfather backfill. NOT users.created_at — round 33's 1,591 accounts
 *    had months-old user rows and only first GUESSED in 33.
 *  - "drive-by" (guessed in no other round) is reported as data but never
 *    drives the verdict: round 28's wave continued into 29 (drive-by = 4 of
 *    2,949), and for the latest round the flag is trivially true.
 *
 * The verdict rests on two legs:
 *  1. NAME LEG — suspicious username share among new guessers (`.base.eth`,
 *     `!`-prefixed or `user-<fid>` placeholders, or none). Waves 28/29/33
 *     measure 91–99% suspicious; round 13's organic cohort measures 19%.
 *  2. FUNDING LEG — one sender seeding $WORD into many reward-gate claim
 *     wallets. This is the only leg that sees the round-32 class: real-shaped
 *     usernames, Neynar scores 0.62–0.99, rows created in batches months
 *     ahead and activated together. The ETH era had no funding surface; the
 *     gate creates one, because every gated account must claim a funded
 *     wallet. Prize payouts, pools, and (once live) the staking contract
 *     also fan out — the report names senders, a human decides.
 */

import * as Sentry from '@sentry/nextjs';
import { WORD_TOKEN_ADDRESS } from './word-token';

export const FARM_MONITOR_THRESHOLDS = {
  /** Name leg needs at least this many new guessers to confirm. */
  nameLegMinNew: 40,
  /** Suspicious-name share among new guessers that confirms (waves: 0.91+). */
  suspiciousNameShare: 0.5,
  /** A shaped cohort this small is still worth a look. */
  smallShapedMinNew: 10,
  /** New-guesser volume that puts any round on watch. */
  watchNewGuessers: 100,
  /** One sender funding this many claim wallets puts the round on watch. */
  funderFanoutWatch: 3,
  /** One sender funding this many claim wallets confirms the signature. */
  funderFanoutFarm: 5,
} as const;

export type FarmVerdict = 'quiet' | 'watch' | 'farm-signature';

export interface FarmSignals {
  /** Accounts whose first-ever guess is in this round. */
  newGuessers: number;
  /** Of those, how many carry a suspicious username shape. */
  newGuessersSuspicious: number;
  /** Max claim wallets funded by a single $WORD sender; 0 = not enriched. */
  topFunderFanout: number;
  /** True when funding was not traced but claim wallets exist to trace. */
  fundingUntraced?: boolean;
}

export type UsernameShape = 'base_eth' | 'placeholder' | 'none' | 'real';

/**
 * The known farm shapes plus the no-username case. Neynar returns "!<fid>"
 * for users who never set a username (src/lib/farcaster.ts). "user-<fid>"
 * and "user<fid>" are auto-generated farm shapes (verified 2026-08-15): all
 * 500 dashed ones have suffix = own FID and 445 sit in the wave rounds
 * 28/29/33 (the round-31/32 winners carry it); all 5,303 dashless ones are
 * the 2025-09-14 registration cohort — suffix = own FID, ZERO guesses ever —
 * dormant capacity that this classifier must see if it activates. Round 13's
 * organic cohort has zero of either shape.
 * NOTE: a 'real' shape is NOT evidence of a real player — the round-32 farm
 * had real-shaped names throughout. Only the funding leg sees that class.
 */
export function classifyUsername(username: string | null | undefined): UsernameShape {
  if (!username) return 'none';
  if (username.startsWith('!')) return 'placeholder';
  if (/^user-?\d+$/.test(username)) return 'placeholder';
  if (username.toLowerCase().endsWith('.base.eth')) return 'base_eth';
  return 'real';
}

export function isSuspiciousUsername(username: string | null | undefined): boolean {
  return classifyUsername(username) !== 'real';
}

export function computeAssessment(signals: FarmSignals): {
  verdict: FarmVerdict;
  reasons: string[];
} {
  const { newGuessers, newGuessersSuspicious, topFunderFanout, fundingUntraced } = signals;
  const T = FARM_MONITOR_THRESHOLDS;
  const nameShare = newGuessers > 0 ? newGuessersSuspicious / newGuessers : 0;
  const reasons: string[] = [];

  const farmByNames = newGuessers >= T.nameLegMinNew && nameShare >= T.suspiciousNameShare;
  const farmByFunding = topFunderFanout >= T.funderFanoutFarm;
  if (farmByNames) {
    reasons.push(
      `${newGuessers} new guessers and ${Math.round(nameShare * 100)}% of them carry a suspicious username shape`
    );
  }
  if (farmByFunding) {
    reasons.push(`one sender funded ${topFunderFanout} claim wallets with $WORD`);
  }
  if (farmByNames || farmByFunding) {
    return { verdict: 'farm-signature', reasons };
  }

  if (newGuessers >= T.smallShapedMinNew && nameShare >= T.suspiciousNameShare) {
    reasons.push(
      `small cohort, but ${Math.round(nameShare * 100)}% of ${newGuessers} new guessers carry a suspicious username shape`
    );
  }
  if (newGuessers >= T.watchNewGuessers) {
    reasons.push(
      `${newGuessers} new guessers (threshold ${T.watchNewGuessers}); username shapes look organic`
    );
  }
  if (topFunderFanout >= T.funderFanoutWatch) {
    reasons.push(
      `one sender funded ${topFunderFanout} claim wallets (threshold ${T.funderFanoutWatch})`
    );
  }
  if (fundingUntraced) {
    // The round-32 class is invisible to the name leg — say so instead of
    // reading "quiet" while the only leg that can see it never ran.
    reasons.push('funding not traced — run with enrichment to check the funded-farm class');
  }
  if (reasons.length > 0) {
    const onlyUntraced = reasons.length === 1 && fundingUntraced;
    return { verdict: onlyUntraced ? 'quiet' : 'watch', reasons };
  }

  return { verdict: 'quiet', reasons: ['no farm signature in this round'] };
}

// ---------------------------------------------------------------------------
// Funding-source lookup (Blockscout v2, read-only)
// ---------------------------------------------------------------------------

const BLOCKSCOUT_TIMEOUT_MS = 10_000;

function getBlockscoutBase(): string {
  return (process.env.BASE_BLOCKSCOUT_URL || 'https://base.blockscout.com').replace(/\/$/, '');
}

export interface WordFundersResult {
  /** Unique lowercase sender addresses of inbound $WORD transfers. */
  senders: string[];
  /** false when the fetch failed or timed out — do not treat as "no funders". */
  verified: boolean;
}

/**
 * Who sent $WORD into this wallet? One page (newest ~50 token transfers) is
 * enough: a farm funds its claim wallets right before playing. The token
 * filter is applied both as a query param and client-side, so a Blockscout
 * param quirk degrades to extra rows, never to wrong senders.
 */
export async function fetchWordFunders(wallet: string): Promise<WordFundersResult> {
  const url =
    `${getBlockscoutBase()}/api/v2/addresses/${wallet}/token-transfers` +
    `?type=ERC-20&filter=to&token=${WORD_TOKEN_ADDRESS}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BLOCKSCOUT_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      Sentry.captureMessage('[FarmMonitor] Blockscout non-200 on token-transfers', {
        level: 'warning',
        tags: { component: 'farm-monitor', failure: 'http_error' },
        extra: { wallet, status: response.status },
      });
      return { senders: [], verified: false };
    }
    const body = await response.json();
    const items: any[] = Array.isArray(body?.items) ? body.items : [];
    const walletLower = wallet.toLowerCase();
    const tokenLower = WORD_TOKEN_ADDRESS.toLowerCase();
    const senders = new Set<string>();
    for (const item of items) {
      const token = (item?.token?.address ?? '').toLowerCase();
      const to = (item?.to?.hash ?? '').toLowerCase();
      const from = (item?.from?.hash ?? '').toLowerCase();
      if (token !== tokenLower) continue;
      if (to !== walletLower) continue;
      if (!from || from === '0x0000000000000000000000000000000000000000') continue;
      senders.add(from);
    }
    return { senders: [...senders], verified: true };
  } catch (error: any) {
    Sentry.captureMessage('[FarmMonitor] Blockscout token-transfers fetch failed', {
      level: 'warning',
      tags: {
        component: 'farm-monitor',
        failure: error?.name === 'AbortError' ? 'timeout' : 'exception',
      },
      extra: { wallet, message: error?.message ?? String(error) },
    });
    return { senders: [], verified: false };
  } finally {
    clearTimeout(timeoutId);
  }
}
