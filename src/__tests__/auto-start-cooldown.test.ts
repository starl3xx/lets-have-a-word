import { describe, it, expect, afterEach } from 'vitest';
import { checkAutoStartEligibility } from '../lib/rounds';
import { db, rounds } from '../db';
import { inArray } from 'drizzle-orm';

/**
 * Between-rounds cooldown (round 34+)
 *
 * checkAutoStartEligibility anchors the cooldown on the most recently
 * resolved round and requires it to be a $WORD round — which era-gates
 * auto-start (the paused ETH tail can never fire it) and keeps the Round 34
 * launch manual.
 *
 * The shared test DB carries resolved rounds from other suites, so anchor
 * fixtures use slightly-future resolved_at values: they are always the
 * newest resolution while this file runs.
 */

const createdIds: number[] = [];

async function insertRound(opts: {
  resolvedAt: Date | null;
  prizeCurrency: 'eth' | 'word';
  status?: 'active' | 'resolved';
}): Promise<number> {
  const [row] = await db
    .insert(rounds)
    .values({
      rulesetId: 1,
      answer: 'BRAIN',
      salt: 'a'.repeat(64),
      commitHash: 'c'.repeat(64),
      status: opts.status ?? 'resolved',
      resolvedAt: opts.resolvedAt,
      prizeCurrency: opts.prizeCurrency,
    })
    .returning({ id: rounds.id });
  createdIds.push(row.id);
  return row.id;
}

afterEach(async () => {
  if (createdIds.length > 0) {
    await db.delete(rounds).where(inArray(rounds.id, createdIds));
    createdIds.length = 0;
  }
  delete process.env.ROUND_COOLDOWN_HOURS;
});

describe('checkAutoStartEligibility', () => {
  it('reports active_round while a round is live', async () => {
    await insertRound({ resolvedAt: null, prizeCurrency: 'word', status: 'active' });

    const check = await checkAutoStartEligibility();
    expect(check.eligible).toBe(false);
    if (!check.eligible) expect(check.reason).toBe('active_round');
  });

  it('never fires while the newest resolution is an ETH round (era gate)', async () => {
    await insertRound({ resolvedAt: new Date(Date.now() + 60_000), prizeCurrency: 'eth' });

    const check = await checkAutoStartEligibility();
    expect(check.eligible).toBe(false);
    if (!check.eligible) expect(check.reason).toBe('no_word_round');
  });

  it('waits out the cooldown after a $WORD resolution, reporting when it ends', async () => {
    const resolvedAt = new Date(Date.now() + 60_000);
    await insertRound({ resolvedAt, prizeCurrency: 'word' });

    const check = await checkAutoStartEligibility();
    expect(check.eligible).toBe(false);
    if (!check.eligible) {
      expect(check.reason).toBe('cooldown');
      // Default cooldown: 6 hours after the resolution
      expect(check.eligibleAt?.getTime()).toBe(resolvedAt.getTime() + 6 * 60 * 60 * 1000);
    }
  });

  it('is eligible once the cooldown has elapsed', async () => {
    process.env.ROUND_COOLDOWN_HOURS = '0';
    const roundId = await insertRound({ resolvedAt: new Date(), prizeCurrency: 'word' });

    const check = await checkAutoStartEligibility();
    expect(check.eligible).toBe(true);
    if (check.eligible) expect(check.sinceRoundId).toBe(roundId);
  });

  it('honors a fractional ROUND_COOLDOWN_HOURS override', async () => {
    process.env.ROUND_COOLDOWN_HOURS = '0.5';
    const resolvedAt = new Date(Date.now() + 60_000);
    await insertRound({ resolvedAt, prizeCurrency: 'word' });

    const check = await checkAutoStartEligibility();
    expect(check.eligible).toBe(false);
    if (!check.eligible) {
      expect(check.reason).toBe('cooldown');
      expect(check.eligibleAt?.getTime()).toBe(resolvedAt.getTime() + 30 * 60 * 1000);
    }
  });
});
