import { describe, it, expect, afterAll } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../db';
import { rounds } from '../db/schema';
import { eq } from 'drizzle-orm';
import { activeRoundConditions } from '../lib/rounds';
import { and, isNull } from 'drizzle-orm';
import handler from '../../pages/api/admin/operational/round-health';

/**
 * Which round does Admin → Round Health actually inspect?
 *
 * Bugbot caught this one. The endpoint documented its blank case as "the active
 * round" but selected `isNull(resolvedAt)` with no ORDER BY, which is NOT the
 * same query the game uses. A kill-switched round keeps resolvedAt NULL by
 * design — enableKillSwitch writes status 'cancelled' and nothing else — so
 * from the moment the cron starts a successor there are two rows matching that
 * predicate and the card reported on whichever the planner happened to return.
 *
 * That is the worst possible moment for the diagnostic to read the wrong round:
 * an operator looking at Round Health right after a kill switch is looking at
 * it BECAUSE of the kill switch.
 */

const created: number[] = [];

async function makeRound(status: 'active' | 'cancelled', suffix: number) {
  const salt = `健${suffix}`.padEnd(64, '0').slice(0, 64);
  const [round] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'TESTS',
      salt,
      commitHash: salt,
      prizePoolEth: '0',
      seedNextRoundEth: '0',
      // Currency columns on every rounds write, same rule as every read.
      prizeCurrency: 'word',
      prizePoolWord: '116686114000000000000000000',
      seedPriceE18: '342714301034',
      status,
      // Both rows leave resolvedAt NULL. That is the whole point: cancelled
      // does not mean resolved, and the old predicate could not tell them apart.
      resolvedAt: null,
      ...(status === 'cancelled' ? { cancelledAt: new Date(), cancelledReason: 'kill switch' } : {}),
    })
    .returning();
  created.push(round.id);
  return round;
}

function mockRes() {
  const res: any = {
    statusCode: 0,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: any) {
      res.body = body;
      return res;
    },
  };
  return res as NextApiResponse & typeof res;
}

afterAll(async () => {
  for (const id of created) await db.delete(rounds).where(eq(rounds.id, id));
});

describe('round health picks the live round, not the cancelled one', () => {
  it('ignores a kill-switched round that still has a null resolvedAt', async () => {
    // The exact post-kill-switch shape: the dead round has the LOWER id, so a
    // predicate with no ORDER BY is free to return it first.
    const cancelled = await makeRound('cancelled', 1);
    const live = await makeRound('active', 2);

    const matched = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(and(...activeRoundConditions()));
    const matchedIds = matched.map((r) => r.id);

    expect(matchedIds).toContain(live.id);
    expect(matchedIds).not.toContain(cancelled.id);

    // Anti-vacuous-pass guard: prove the OLD predicate really was different.
    // If this ever stops matching the cancelled round, the fixture has drifted
    // and the assertion above is no longer testing anything.
    const oldPredicate = await db
      .select({ id: rounds.id })
      .from(rounds)
      .where(isNull(rounds.resolvedAt));
    const oldIds = oldPredicate.map((r) => r.id);
    expect(oldIds).toContain(cancelled.id);
    expect(oldIds).toContain(live.id);

    const res = mockRes();
    await handler({ method: 'GET', query: { devFid: '6500' }, cookies: {} } as unknown as NextApiRequest, res);

    expect(res.statusCode).toBe(200);
    // The endpoint may legitimately pick any active round in a shared test
    // database, but it must never pick the cancelled one.
    expect(res.body.roundId).not.toBe(cancelled.id);
  });
});
