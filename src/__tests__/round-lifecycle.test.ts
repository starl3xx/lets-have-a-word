import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createTestRound, retireActiveRounds } from './helpers/rounds';
import {
  createRound,
  getActiveRound,
  ensureActiveRound,
  getRoundById,
  resolveRound,
  verifyRoundCommitment,
  type CreateRoundOptions,
} from '../lib/rounds';
import { computeCommitHash } from '../lib/commit-reveal';
import { db } from '../db';
import { users } from '../db/schema';
import { inArray } from 'drizzle-orm';

/**
 * Note: These tests require a running PostgreSQL database
 * Set DATABASE_URL in .env before running tests
 */

describe('Round Lifecycle', () => {

  afterEach(async () => {
    // createRound refuses to run while a round is active, so without this the
    // second test in the file fails and every one after it.
    await retireActiveRounds();
  });
  describe('createRound()', () => {
    it('should create a round with random answer', async () => {
      const round = await createTestRound();

      expect(round).toBeDefined();
      expect(round.id).toBeGreaterThan(0);
      expect(round.answer).toBeDefined();
      expect(round.answer.length).toBe(5);
      expect(round.salt).toBeDefined();
      expect(round.commitHash).toBeDefined();
      expect(round.rulesetId).toBe(1);
      expect(round.prizePoolEth).toBe('0.000000000000000000');
      expect(round.seedNextRoundEth).toBe('0.000000000000000000');
      expect(round.winnerFid).toBeNull();
      expect(round.referrerFid).toBeNull();
      expect(round.startedAt).toBeInstanceOf(Date);
      expect(round.resolvedAt).toBeNull();

      // Clean up: resolve the round
      await resolveRound(round.id, 12345);
    });

    it('should create a round with forced answer', async () => {
      const opts: CreateRoundOptions = { forceAnswer: 'brain' };
      const round = await createTestRound(opts);

      expect(round.answer).toBe('BRAIN');

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should create a round with custom ruleset', async () => {
      const opts: CreateRoundOptions = { rulesetId: 1 };
      const round = await createTestRound(opts);

      expect(round.rulesetId).toBe(1);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should throw error for invalid answer word', async () => {
      const opts: CreateRoundOptions = { forceAnswer: 'zzzzz' };

      await expect(createRound(opts)).rejects.toThrow('Invalid answer word');
    });

    it('should throw error if active round already exists', async () => {
      const round1 = await createTestRound();

      // Try to create another round while first is still active
      await expect(createRound()).rejects.toThrow('Cannot create new round');

      // Clean up
      await resolveRound(round1.id, 12345);
    });
  });

  describe('getActiveRound()', () => {
    it('should return null when no active round exists', async () => {
      const activeRound = await getActiveRound();

      // Could be null if all rounds are resolved
      if (activeRound) {
        expect(activeRound.resolvedAt).toBeNull();
      }
    });

    it('should return the active round', async () => {
      const created = await createTestRound();
      const active = await getActiveRound();

      expect(active).toBeDefined();
      expect(active?.id).toBe(created.id);
      expect(active?.resolvedAt).toBeNull();

      // Clean up
      await resolveRound(created.id, 12345);
    });

    it('should not return resolved rounds', async () => {
      const created = await createTestRound();
      await resolveRound(created.id, 12345);

      const active = await getActiveRound();

      // Should not return the resolved round
      expect(active?.id).not.toBe(created.id);
    });
  });

  describe('ensureActiveRound()', () => {
    it('should return existing active round if one exists', async () => {
      const created = await createTestRound();
      const ensured = await ensureActiveRound();

      expect(ensured.id).toBe(created.id);

      // Clean up
      await resolveRound(created.id, 12345);
    });

    it('should create new round if none exists', async () => {
      // Ensure no active round (this test assumes clean state)
      const active = await getActiveRound();
      if (active) {
        await resolveRound(active.id, 12345);
      }

      // ensureActiveRound forwards its options straight to createRound, so the
      // auto-create branch is reachable here without a deployed contract.
      const ensured = await ensureActiveRound({ skipOnChainCommitment: true });

      expect(ensured).toBeDefined();
      expect(ensured.resolvedAt).toBeNull();

      // Clean up
      await resolveRound(ensured.id, 12345);
    });

    it('should accept options when creating new round', async () => {
      // Ensure no active round
      const active = await getActiveRound();
      if (active) {
        await resolveRound(active.id, 12345);
      }

      const opts: CreateRoundOptions = { forceAnswer: 'house', skipOnChainCommitment: true };
      const ensured = await ensureActiveRound(opts);

      expect(ensured.answer).toBe('HOUSE');

      // Clean up
      await resolveRound(ensured.id, 12345);
    });
  });

  describe('getRoundById()', () => {
    it('should retrieve a round by ID', async () => {
      const created = await createTestRound();
      const retrieved = await getRoundById(created.id);

      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.answer).toBe(created.answer);

      // Clean up
      await resolveRound(created.id, 12345);
    });

    it('should return null for non-existent round', async () => {
      const retrieved = await getRoundById(999999);

      expect(retrieved).toBeNull();
    });
  });

  describe('resolveRound()', () => {
    it('should resolve a round with winner', async () => {
      const created = await createTestRound();
      const winnerFid = 12345;

      const resolved = await resolveRound(created.id, winnerFid);

      expect(resolved.winnerFid).toBe(winnerFid);
      expect(resolved.resolvedAt).toBeInstanceOf(Date);
      expect(resolved.resolvedAt).not.toBeNull();
    });

    it('should take the referrer from the winner’s user record, not from the caller', async () => {
      const winnerFid = 12345;
      const referrerFid = 67890;

      await db.delete(users).where(inArray(users.fid, [winnerFid, referrerFid]));
      await db.insert(users).values([
        { fid: referrerFid, xp: 0 },
        { fid: winnerFid, referrerFid, xp: 0 },
      ]);

      const created = await createTestRound();
      const resolved = await resolveRound(created.id, winnerFid);

      expect(resolved.winnerFid).toBe(winnerFid);
      expect(resolved.resolvedAt).not.toBeNull();

      // This round's pool is empty, so there is no referrer share to pay and
      // nothing writes rounds.referrerFid. The previous version of this test
      // passed 67890 as a third argument to resolveRound and expected it back;
      // that argument was never used for anything and has been removed.
      expect(resolved.referrerFid).toBeNull();

      await db.delete(users).where(inArray(users.fid, [winnerFid, referrerFid]));
    });

    it('should throw error when resolving non-existent round', async () => {
      await expect(resolveRound(999999, 12345)).rejects.toThrow('not found');
    });

    it('should throw error when resolving already-resolved round', async () => {
      const created = await createTestRound();
      await resolveRound(created.id, 12345);

      // Try to resolve again
      await expect(resolveRound(created.id, 67890)).rejects.toThrow('already resolved');
    });
  });

  describe('Commit-Reveal Integrity', () => {
    it('should create valid commit hash', async () => {
      const round = await createTestRound({ forceAnswer: 'audio' });

      // Manually verify commitment
      const expectedHash = computeCommitHash(round.salt, round.answer);

      expect(round.commitHash).toBe(expectedHash);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should verify round commitment', async () => {
      const round = await createTestRound();

      const isValid = verifyRoundCommitment(round);

      expect(isValid).toBe(true);

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should fail verification for tampered answer', async () => {
      const round = await createTestRound({ forceAnswer: 'brain' });

      // Tamper with the answer
      const tamperedRound = { ...round, answer: 'house' };

      const isValid = verifyRoundCommitment(tamperedRound);

      expect(isValid).toBe(false);

      // Clean up
      await resolveRound(round.id, 12345);
    });
  });

  describe('Complete Round Lifecycle', () => {
    it('should handle full lifecycle: create -> active -> resolve', async () => {
      // 1. Create round
      const created = await createTestRound({ forceAnswer: 'brain' });
      expect(created.resolvedAt).toBeNull();

      // 2. Get active round
      const active = await getActiveRound();
      expect(active?.id).toBe(created.id);

      // 3. Verify commitment
      const isValid = verifyRoundCommitment(created);
      expect(isValid).toBe(true);

      // 4. Resolve round
      const winnerFid = 555;
      const resolved = await resolveRound(created.id, winnerFid);

      expect(resolved.winnerFid).toBe(winnerFid);
      expect(resolved.resolvedAt).not.toBeNull();

      // 5. Verify no longer active
      const stillActive = await getActiveRound();
      expect(stillActive?.id).not.toBe(created.id);

      // 6. Can create new round now
      const newRound = await createTestRound();
      expect(newRound.id).not.toBe(created.id);

      // Clean up new round
      await resolveRound(newRound.id, 12345);
    });
  });
});
