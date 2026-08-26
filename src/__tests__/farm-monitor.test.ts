/**
 * Farm Monitor signature tests
 *
 * Fixtures use the real production numbers (verified 2026-08-15) on the
 * MIN(guesses.round_id) basis: waves 28/29/33 must read farm-signature on
 * the name leg; round 32 (real-shaped names, high scores) must be invisible
 * to the name leg and caught by the funding leg; round 13's organic cohort
 * reads watch on volume, never farm-signature.
 */

import { describe, it, expect } from 'vitest';
import {
  classifyUsername,
  computeAssessment,
  isSuspiciousUsername,
} from '../lib/farm-monitor';

describe('classifyUsername', () => {
  it('recognizes the known farm shapes', () => {
    expect(classifyUsername('swarm042.base.eth')).toBe('base_eth');
    expect(classifyUsername('SWARM042.BASE.ETH')).toBe('base_eth');
    expect(classifyUsername('!891234')).toBe('placeholder');
    expect(classifyUsername('user-2924790')).toBe('placeholder'); // round-31/32 winners' shape
    expect(classifyUsername('user1251667')).toBe('placeholder'); // 2025-09-14 dormant cohort shape
    expect(classifyUsername('username42')).toBe('real'); // trailing letters — a human handle
    expect(classifyUsername(null)).toBe('none');
    expect(classifyUsername(undefined)).toBe('none');
    expect(classifyUsername('')).toBe('none');
    expect(classifyUsername('jake')).toBe('real');
  });

  it('flags every non-real shape as suspicious', () => {
    expect(isSuspiciousUsername('a.base.eth')).toBe(true);
    expect(isSuspiciousUsername('!42')).toBe(true);
    expect(isSuspiciousUsername(null)).toBe(true);
    expect(isSuspiciousUsername('jake')).toBe(false);
  });
});

describe('computeAssessment', () => {
  it('flags the round-28 wave (2,949 new, 91% suspicious names)', () => {
    const { verdict } = computeAssessment({
      newGuessers: 2949,
      newGuessersSuspicious: 2681,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('farm-signature');
  });

  it('flags the round-29 wave (913 new, 93% suspicious names)', () => {
    const { verdict } = computeAssessment({
      newGuessers: 913,
      newGuessersSuspicious: 847,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('farm-signature');
  });

  it('flags the round-33 wave (1,591 new, 91% suspicious names)', () => {
    const { verdict } = computeAssessment({
      newGuessers: 1591,
      newGuessersSuspicious: 1453,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('farm-signature');
  });

  it('cannot see the round-32 class on names alone — and says so', () => {
    // 59 new guessers, real-shaped usernames, Neynar scores 0.62–0.99.
    // Without funding data the round reads quiet; the reason string must
    // point at the untraced funding leg instead of implying all-clear.
    const { verdict, reasons } = computeAssessment({
      newGuessers: 59,
      newGuessersSuspicious: 1,
      topFunderFanout: 0,
      fundingUntraced: true,
    });
    expect(verdict).toBe('quiet');
    expect(reasons.join(' ')).toContain('funding not traced');
  });

  it('catches the round-32 class through the funding leg', () => {
    const { verdict, reasons } = computeAssessment({
      newGuessers: 59,
      newGuessersSuspicious: 1,
      topFunderFanout: 6,
    });
    expect(verdict).toBe('farm-signature');
    expect(reasons.join(' ')).toContain('funded 6 claim wallets');
  });

  it('reads the round-13 organic cohort as watch on volume, not farm', () => {
    // 111 new guessers, 19% suspicious — real Base-app users who stayed.
    const { verdict, reasons } = computeAssessment({
      newGuessers: 111,
      newGuessersSuspicious: 21,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('watch');
    expect(reasons.join(' ')).toContain('organic');
  });

  it('puts a small shaped cohort on watch', () => {
    const { verdict } = computeAssessment({
      newGuessers: 12,
      newGuessersSuspicious: 10,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('watch');
  });

  it('a failed trace is named, not read as all-clear', () => {
    const { verdict, reasons } = computeAssessment({
      newGuessers: 59,
      newGuessersSuspicious: 1,
      topFunderFanout: 0,
      fundingTraceFailed: true,
    });
    expect(verdict).toBe('quiet');
    expect(reasons.join(' ')).toContain('funding trace failed');
    expect(reasons.join(' ')).not.toContain('run with enrichment');
  });

  it('puts moderate funding fan-out on watch', () => {
    const { verdict } = computeAssessment({
      newGuessers: 3,
      newGuessersSuspicious: 0,
      topFunderFanout: 3,
    });
    expect(verdict).toBe('watch');
  });

  it('is quiet on an empty round', () => {
    const { verdict } = computeAssessment({
      newGuessers: 0,
      newGuessersSuspicious: 0,
      topFunderFanout: 0,
    });
    expect(verdict).toBe('quiet');
  });
});

/**
 * A per-round claim count must not be filtered on reward_gate_claims.round_id.
 *
 * The table is keyed (date, wallet) and written with onConflictDoNothing, so
 * round_id holds whatever the FIRST check of that wallet-day knew — and that
 * check is normally round-less, because /api/user-state and the daily
 * allocation both run checkPlayEligibility with no round in scope when the app
 * is opened, long before any guess. The row is stamped NULL, the guess path's
 * round-scoped insert conflicts and changes nothing, and the report read 0
 * claims for round 34 while the gate was live and passing players.
 *
 * This asserts the count against a row that is NULL exactly the way production
 * writes them. It fails on the round_id filter and passes on the window bound.
 */
describe('gate claims are counted by the round window, not round_id', () => {
  it('counts a claim whose round_id was never stamped', async () => {
    const { db } = await import('../db');
    const { rounds, rewardGateClaims } = await import('../db/schema');
    const { eq } = await import('drizzle-orm');
    const handler = (await import('../../pages/api/admin/operational/farm-monitor')).default;

    const [round] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'CLAIM',
        salt: `s-gate-${process.hrtime.bigint()}`,
        commitHash: 'c'.repeat(64),
        prizePoolEth: '0',
        seedNextRoundEth: '0',
        prizeCurrency: 'word',
        prizePoolWord: '0',
      })
      .returning();

    const wallet = '0x00000000000000000000000000000000deadbeef';
    try {
      await db.insert(rewardGateClaims).values({
        // Exactly how the round-less caller writes it: a real wallet-day
        // claim carrying no round.
        date: new Date().toISOString().slice(0, 10),
        wallet,
        fid: 999999001,
        roundId: null,
      });

      const body = await new Promise<any>((resolve) => {
        const res = {
          status() {
            return this;
          },
          json(payload: unknown) {
            resolve(payload);
            return this;
          },
          setHeader() {
            return this;
          },
          end() {
            return this;
          },
        };
        handler(
          { method: 'GET', query: { devFid: '6500', roundId: String(round.id) } } as any,
          res as any
        );
      });

      expect(body.gate.claims).toBe(1);
      expect(body.gate.distinctClaimWallets).toBe(1);
    } finally {
      await db.delete(rewardGateClaims).where(eq(rewardGateClaims.wallet, wallet));
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });

  /**
   * A cancelled round has no resolved_at — the kill switch (operational.ts) and
   * the seeding-failure path (rounds.ts) both set `cancelledAt` and leave
   * `resolvedAt` null. Ending the window at `resolvedAt ?? now` therefore ran a
   * cancelled round's window right up to the present, counting claims from every
   * round since and pointing the funding trace at other rounds' wallets. Caught
   * by Bugbot on PR #275.
   */
  it('does not sweep in later claims for a cancelled round', async () => {
    const { db } = await import('../db');
    const { rounds, rewardGateClaims } = await import('../db/schema');
    const { eq, sql } = await import('drizzle-orm');
    const handler = (await import('../../pages/api/admin/operational/farm-monitor')).default;

    const [round] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'KILLS',
        salt: `s-cancel-${process.hrtime.bigint()}`,
        commitHash: 'c'.repeat(64),
        prizePoolEth: '0',
        seedNextRoundEth: '0',
        prizeCurrency: 'word',
        prizePoolWord: '0',
        status: 'cancelled',
      })
      .returning();

    // Set the round's clock IN SQL, relative to localtimestamp. These are naive
    // `timestamp` columns holding the server's local wall-clock, so a JS Date
    // would arrive in a different frame and the whole comparison would be
    // meaningless — which is exactly the bug this test exists to pin.
    //
    // The window sits well in the past on purpose. reward_gate_claims
    // accumulates rows from reward-gate.test.ts, so a recent window would count
    // those too and the assertion would drift with whatever else has run. Ten
    // days back, nothing else is in range: with the fix the window closes at
    // day 9 and the claim below is excluded; with the bug it runs to now and
    // sweeps in the claim (and every leftover row besides).
    await db.execute(sql`
      UPDATE rounds
         SET started_at   = localtimestamp - interval '10 days',
             cancelled_at = localtimestamp - interval '9 days'
       WHERE id = ${round.id}
    `);

    const wallet = '0x0000000000000000000000000000000cance11ed';
    try {
      const report = () =>
        new Promise<any>((resolve) => {
          const res = {
            status() {
              return this;
            },
            json(payload: unknown) {
              resolve(payload);
              return this;
            },
            setHeader() {
              return this;
            },
            end() {
              return this;
            },
          };
          handler(
            { method: 'GET', query: { devFid: '6500', roundId: String(round.id) } } as any,
            res as any
          );
        });

      // Asserted as a DELTA, not an absolute count. reward_gate_claims is
      // written by reward-gate.test.ts and accumulates across runs, so there is
      // no window in a shared database that is reliably empty — an absolute
      // assertion would drift with whatever else had run that day. What must
      // hold is narrower and exact: adding a claim AFTER cancellation changes
      // this round's numbers by nothing at all.
      const before = (await report()).gate;

      await db.insert(rewardGateClaims).values({
        date: new Date().toISOString().slice(0, 10),
        wallet,
        fid: 999999002,
        roundId: null,
      });

      const body = await report();

      expect(body.round.status).toBe('cancelled');
      // With the bug (window ending at `now`) this claim lands inside the
      // cancelled round's window and both numbers go up by one.
      expect(body.gate.claims).toBe(before.claims);
      expect(body.gate.distinctClaimWallets).toBe(before.distinctClaimWallets);
    } finally {
      await db.delete(rewardGateClaims).where(eq(rewardGateClaims.wallet, wallet));
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });
});

/**
 * A successful Base App launch must not read as a farm.
 *
 * A wallet-native player signs in with SIWE and has no Farcaster account, so
 * `upsertUserFromWallet` leaves `username` NULL — and the name leg already
 * treats a NULL username as suspicious. With the thresholds as they stand
 * (nameLegMinNew 40, suspiciousNameShare 0.5), forty Base App players arriving
 * in one round would be a 100% suspicious share and an automatic
 * `farm-signature`. An alarm that fires on success stops being read.
 *
 * They are not unwatched: the funding leg still covers them, and that is the
 * leg that caught the round-32 class, which had real-shaped names and high
 * scores and was invisible to name checking.
 */
describe('wallet-native players are not a farm signal', () => {
  it('excludes them from the name leg but still counts them', async () => {
    const { db } = await import('../db');
    const { rounds, users, guesses } = await import('../db/schema');
    const { eq, inArray } = await import('drizzle-orm');
    const handler = (await import('../../pages/api/admin/operational/farm-monitor')).default;

    const [round] = await db
      .insert(rounds)
      .values({
        rulesetId: 1,
        answer: 'BASES',
        salt: `s-base-${process.hrtime.bigint()}`,
        commitHash: 'c'.repeat(64),
        prizePoolEth: '0',
        seedNextRoundEth: '0',
        prizeCurrency: 'word',
        prizePoolWord: '0',
      })
      .returning();

    // Enough to clear nameLegMinNew (40) on its own, so the verdict genuinely
    // turns on whether these count as suspicious.
    const base = 1_000_100_000 + Number(process.hrtime.bigint() % 100_000n) * 100;
    const fids = Array.from({ length: 45 }, (_, i) => base + i);

    try {
      await db.insert(users).values(
        fids.map((fid) => ({
          fid,
          username: null, // exactly what a SIWE sign-in leaves behind
          signerWalletAddress: `0x${fid.toString(16).padStart(40, '0')}`,
          identityOrigin: 'wallet' as const,
          xp: 0,
        }))
      );
      await db.insert(guesses).values(
        fids.map((fid, i) => ({
          roundId: round.id,
          fid,
          word: 'CRANE',
          isPaid: false,
          isCorrect: false,
          guessIndexInRound: i + 1,
        }))
      );

      const body = await new Promise<any>((resolve) => {
        const res = {
          status() {
            return this;
          },
          json(payload: unknown) {
            resolve(payload);
            return this;
          },
          setHeader() {
            return this;
          },
          end() {
            return this;
          },
        };
        handler(
          { method: 'GET', query: { devFid: '6500', roundId: String(round.id) } } as any,
          res as any
        );
      });

      expect(body.cohorts.newGuessers).toBe(45);
      // The whole point: 45 nameless players, zero of them a name signal.
      expect(body.cohorts.newGuessersSuspicious).toBe(0);
      expect(body.assessment.verdict).not.toBe('farm-signature');
      // Still visible — excluded from the verdict, not from the report.
      expect(body.cohorts.walletNative).toBe(45);
      expect(body.cohorts.newWalletNative).toBe(45);
    } finally {
      await db.delete(guesses).where(eq(guesses.roundId, round.id));
      await db.delete(users).where(inArray(users.fid, fids));
      await db.delete(rounds).where(eq(rounds.id, round.id));
    }
  });
});
