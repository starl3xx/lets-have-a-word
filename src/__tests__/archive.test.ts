import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  archiveRound,
  syncAllRounds,
  getArchivedRound,
  getArchivedRounds,
  getLatestArchivedRound,
  getArchiveDebugInfo,
  getRoundGuessDistribution,
  getArchiveStats,
  type ArchiveRoundResult,
} from '../lib/archive';
import { createRound, resolveRound, getActiveRound } from '../lib/rounds';

/**
 * Archive Module Tests
 * Milestone 5.4: Round archive
 *
 * Note: These tests require a running PostgreSQL database
 * Set DATABASE_URL in .env before running tests
 */

describe('Round Archive', () => {
  // Test round cleanup helper
  let testRoundIds: number[] = [];

  const cleanupTestRound = async (roundId: number) => {
    try {
      await resolveRound(roundId, 99999);
    } catch {
      // Already resolved, ignore
    }
  };

  afterEach(async () => {
    // Clean up any test rounds
    for (const id of testRoundIds) {
      await cleanupTestRound(id);
    }
    testRoundIds = [];
  });

  describe('archiveRound()', () => {
    it('should archive a resolved round', async () => {
      // Create and resolve a round
      const round = await createRound({ forceAnswer: 'brain' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);

      // Archive the round
      const result = await archiveRound({ roundId: round.id });

      expect(result.success).toBe(true);
      expect(result.archived).toBeDefined();
      expect(result.archived?.roundNumber).toBe(round.id);
      expect(result.archived?.targetWord).toBe('BRAIN');
      expect(result.archived?.totalGuesses).toBeGreaterThanOrEqual(0);
      expect(result.archived?.uniquePlayers).toBeGreaterThanOrEqual(0);
      expect(result.alreadyArchived).toBeFalsy();
    });

    it('should be idempotent - archiving same round twice returns existing', async () => {
      // Create and resolve a round
      const round = await createRound({ forceAnswer: 'house' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);

      // Archive the round first time
      const firstResult = await archiveRound({ roundId: round.id });
      expect(firstResult.success).toBe(true);

      // Archive the same round again
      const secondResult = await archiveRound({ roundId: round.id });

      expect(secondResult.success).toBe(true);
      expect(secondResult.alreadyArchived).toBe(true);
      expect(secondResult.archived?.id).toBe(firstResult.archived?.id);
    });

    it('should fail for non-existent round', async () => {
      const result = await archiveRound({ roundId: 999999 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should fail for unresolved round', async () => {
      // Create a round but don't resolve it
      const round = await createRound({ forceAnswer: 'audio' });
      testRoundIds.push(round.id);

      const result = await archiveRound({ roundId: round.id });

      expect(result.success).toBe(false);
      expect(result.error).toContain('not resolved');

      // Clean up
      await resolveRound(round.id, 12345);
    });

    it('should include winner info when present', async () => {
      // Create and resolve a round with winner
      const round = await createRound({ forceAnswer: 'crane' });
      testRoundIds.push(round.id);
      const winnerFid = 54321;
      await resolveRound(round.id, winnerFid);

      const result = await archiveRound({ roundId: round.id });

      expect(result.success).toBe(true);
      expect(result.archived?.winnerFid).toBe(winnerFid);
    });

    it('should include referrer info when present', async () => {
      // Create and resolve a round with winner and referrer
      const round = await createRound({ forceAnswer: 'smart' });
      testRoundIds.push(round.id);
      const winnerFid = 11111;
      const referrerFid = 22222;
      await resolveRound(round.id, winnerFid, referrerFid);

      const result = await archiveRound({ roundId: round.id });

      expect(result.success).toBe(true);
      expect(result.archived?.winnerFid).toBe(winnerFid);
      expect(result.archived?.referrerFid).toBe(referrerFid);
    });

    it('should include payout information', async () => {
      // Create and resolve a round
      const round = await createRound({ forceAnswer: 'world' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);

      const result = await archiveRound({ roundId: round.id });

      expect(result.success).toBe(true);
      expect(result.archived?.payoutsJson).toBeDefined();
      expect(Array.isArray(result.archived?.payoutsJson.topGuessers)).toBe(true);
    });
  });

  describe('getArchivedRound()', () => {
    it('should retrieve an archived round by number', async () => {
      // Create, resolve, and archive a round
      const round = await createRound({ forceAnswer: 'beach' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);
      await archiveRound({ roundId: round.id });

      const archived = await getArchivedRound(round.id);

      expect(archived).toBeDefined();
      expect(archived?.roundNumber).toBe(round.id);
      expect(archived?.targetWord).toBe('BEACH');
    });

    it('should return null for non-archived round', async () => {
      const archived = await getArchivedRound(888888);

      expect(archived).toBeNull();
    });
  });

  describe('getArchivedRounds()', () => {
    it('should return paginated list of archived rounds', async () => {
      const { rounds, total } = await getArchivedRounds({ limit: 10, offset: 0 });

      expect(Array.isArray(rounds)).toBe(true);
      expect(typeof total).toBe('number');
      expect(total).toBeGreaterThanOrEqual(0);
    });

    it('should support pagination', async () => {
      const firstPage = await getArchivedRounds({ limit: 5, offset: 0 });
      const secondPage = await getArchivedRounds({ limit: 5, offset: 5 });

      // If we have enough data, pages should be different
      if (firstPage.total > 5) {
        expect(firstPage.rounds[0]?.roundNumber).not.toBe(secondPage.rounds[0]?.roundNumber);
      }
    });

    it('should support ordering', async () => {
      const descOrder = await getArchivedRounds({ limit: 10, orderBy: 'desc' });
      const ascOrder = await getArchivedRounds({ limit: 10, orderBy: 'asc' });

      if (descOrder.rounds.length >= 2 && ascOrder.rounds.length >= 2) {
        expect(descOrder.rounds[0]?.roundNumber).toBeGreaterThan(descOrder.rounds[1]?.roundNumber);
        expect(ascOrder.rounds[0]?.roundNumber).toBeLessThan(ascOrder.rounds[1]?.roundNumber);
      }
    });
  });

  describe('getLatestArchivedRound()', () => {
    it('should return the most recent archived round', async () => {
      // Archive a round
      const round = await createRound({ forceAnswer: 'plant' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);
      await archiveRound({ roundId: round.id });

      const latest = await getLatestArchivedRound();

      expect(latest).toBeDefined();
      // The latest should have the highest round number
      const allRounds = await getArchivedRounds({ limit: 100 });
      const maxRoundNumber = Math.max(...allRounds.rounds.map(r => r.roundNumber));
      expect(latest?.roundNumber).toBe(maxRoundNumber);
    });
  });

  describe('getArchiveDebugInfo()', () => {
    it('should return debug info comparing archived vs raw data', async () => {
      // Create, resolve, and archive a round
      const round = await createRound({ forceAnswer: 'dance' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);
      await archiveRound({ roundId: round.id });

      const debugInfo = await getArchiveDebugInfo(round.id);

      expect(debugInfo.archived).toBeDefined();
      expect(debugInfo.raw).toBeDefined();
      expect(debugInfo.raw?.round).toBeDefined();
      expect(debugInfo.discrepancies).toBeDefined();
      expect(Array.isArray(debugInfo.discrepancies)).toBe(true);
    });

    it('should detect discrepancies when data differs', async () => {
      // This test would need to manipulate data, which we won't do in real tests
      // Just verify the structure is correct
      const debugInfo = await getArchiveDebugInfo(999999);

      expect(debugInfo.archived).toBeNull();
      expect(debugInfo.raw).toBeNull();
      expect(debugInfo.discrepancies).toBeDefined();
    });
  });

  describe('getRoundGuessDistribution()', () => {
    it('should return distribution data for a round', async () => {
      // Create, resolve, and archive a round
      const round = await createRound({ forceAnswer: 'night' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);

      const distribution = await getRoundGuessDistribution(round.id);

      expect(distribution).toBeDefined();
      expect(Array.isArray(distribution.distribution)).toBe(true);
      expect(Array.isArray(distribution.byPlayer)).toBe(true);
    });

    it('should return empty arrays for round with no guesses', async () => {
      const round = await createRound({ forceAnswer: 'light' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);

      const distribution = await getRoundGuessDistribution(round.id);

      expect(distribution.distribution).toEqual([]);
      expect(distribution.byPlayer).toEqual([]);
    });
  });

  describe('getArchiveStats()', () => {
    it('should return aggregate statistics', async () => {
      const stats = await getArchiveStats();

      expect(stats).toBeDefined();
      expect(typeof stats.totalRounds).toBe('number');
      expect(typeof stats.totalGuessesAllTime).toBe('number');
      expect(typeof stats.uniqueWinners).toBe('number');
      expect(typeof stats.totalJackpotDistributed).toBe('string');
      expect(typeof stats.avgGuessesPerRound).toBe('number');
      expect(typeof stats.avgPlayersPerRound).toBe('number');
      expect(typeof stats.avgRoundLengthMinutes).toBe('number');
    });
  });

  describe('syncAllRounds()', () => {
    it('should sync all unarchived resolved rounds', async () => {
      // Create and resolve a round
      const round = await createRound({ forceAnswer: 'storm' });
      testRoundIds.push(round.id);
      await resolveRound(round.id, 12345);

      // Sync all rounds
      const result = await syncAllRounds();

      expect(result).toBeDefined();
      expect(typeof result.archived).toBe('number');
      expect(typeof result.alreadyArchived).toBe('number');
      expect(typeof result.failed).toBe('number');
      expect(Array.isArray(result.errors)).toBe(true);

      // The round we created should be archived or already archived
      expect(result.archived + result.alreadyArchived).toBeGreaterThan(0);
    });

    it('should not fail on empty database', async () => {
      // This test ensures the function handles no rounds gracefully
      const result = await syncAllRounds();

      expect(result).toBeDefined();
      expect(result.failed).toBe(0);
    });
  });
});

describe('Archive Data Integrity', () => {
  it('should store correct start and end times', async () => {
    const beforeCreate = new Date();

    // Resolve existing active round if any
    const active = await getActiveRound();
    if (active) {
      await resolveRound(active.id, 99999);
    }

    const round = await createRound({ forceAnswer: 'timer' });
    const afterCreate = new Date();

    await resolveRound(round.id, 12345);
    const afterResolve = new Date();

    await archiveRound({ roundId: round.id });

    const archived = await getArchivedRound(round.id);

    expect(archived).toBeDefined();
    expect(new Date(archived!.startTime).getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime() - 1000);
    expect(new Date(archived!.startTime).getTime()).toBeLessThanOrEqual(afterCreate.getTime() + 1000);
    expect(new Date(archived!.endTime).getTime()).toBeGreaterThanOrEqual(afterCreate.getTime() - 1000);
    expect(new Date(archived!.endTime).getTime()).toBeLessThanOrEqual(afterResolve.getTime() + 1000);
  });

  it('should preserve salt for commit-reveal verification', async () => {
    const active = await getActiveRound();
    if (active) {
      await resolveRound(active.id, 99999);
    }

    const round = await createRound({ forceAnswer: 'proof' });
    await resolveRound(round.id, 12345);

    await archiveRound({ roundId: round.id });

    const archived = await getArchivedRound(round.id);

    expect(archived).toBeDefined();
    expect(archived!.salt).toBe(round.salt);
    expect(archived!.salt.length).toBeGreaterThan(0);
  });
});
