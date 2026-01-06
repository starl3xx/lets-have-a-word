/**
 * Diagnose Guess Flow Issues
 *
 * GET /api/admin/operational/diagnose-guess
 *
 * Checks each component of the guess submission flow to identify hangs.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { rounds, roundBonusWords } from '../../../../src/db/schema';
import { isNull, eq } from 'drizzle-orm';
import { redis } from '../../../../src/lib/redis';

interface DiagnosticResult {
  check: string;
  status: 'ok' | 'error' | 'slow' | 'missing';
  durationMs: number;
  details?: any;
}

async function timeCheck<T>(
  name: string,
  fn: () => Promise<T>,
  slowThresholdMs: number = 1000
): Promise<DiagnosticResult & { result?: T }> {
  const start = Date.now();
  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timeout after 5s')), 5000)
      )
    ]);
    const duration = Date.now() - start;
    return {
      check: name,
      status: duration > slowThresholdMs ? 'slow' : 'ok',
      durationMs: duration,
      result,
    };
  } catch (error: any) {
    return {
      check: name,
      status: 'error',
      durationMs: Date.now() - start,
      details: error.message,
    };
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const results: DiagnosticResult[] = [];

  // 1. Check basic DB connectivity
  const dbCheck = await timeCheck('db_connection', async () => {
    const result = await db.execute<{ now: Date }>({ sql: 'SELECT NOW() as now', args: [] });
    return result.rows[0];
  });
  results.push(dbCheck);

  // 2. Check active round query
  const roundCheck = await timeCheck('get_active_round', async () => {
    const result = await db
      .select({ id: rounds.id, status: rounds.status })
      .from(rounds)
      .where(isNull(rounds.resolvedAt))
      .limit(1);
    return result[0] || null;
  });
  results.push(roundCheck);

  // 3. Check bonus words table exists and query speed
  const bonusWordsCheck = await timeCheck('bonus_words_query', async () => {
    const roundId = (roundCheck as any).result?.id;
    if (!roundId) return { skipped: 'no_active_round' };

    const result = await db
      .select({ id: roundBonusWords.id, roundId: roundBonusWords.roundId })
      .from(roundBonusWords)
      .where(eq(roundBonusWords.roundId, roundId))
      .limit(1);
    return { count: result.length, roundId };
  });
  results.push(bonusWordsCheck);

  // 4. Check Redis connectivity
  const redisCheck = await timeCheck('redis_connection', async () => {
    if (!redis) {
      return { status: 'redis_disabled' };
    }
    await redis.set('diagnose:test', 'ok', { ex: 10 });
    const value = await redis.get('diagnose:test');
    return { connected: true, testValue: value };
  });
  results.push(redisCheck);

  // 5. Check rate limit key operations
  const rateLimitCheck = await timeCheck('rate_limit_check', async () => {
    if (!redis) {
      return { status: 'redis_disabled' };
    }
    const testKey = 'lhaw:rl:diagnose:test';
    const pipeline = redis.pipeline();
    pipeline.zadd(testKey, { score: Date.now(), member: 'test' });
    pipeline.zcard(testKey);
    pipeline.expire(testKey, 10);
    const results = await pipeline.exec();
    return { pipeline_ok: true, results };
  });
  results.push(rateLimitCheck);

  // Summary
  const hasErrors = results.some(r => r.status === 'error');
  const hasSlow = results.some(r => r.status === 'slow');

  return res.status(200).json({
    timestamp: new Date().toISOString(),
    overall: hasErrors ? 'ERRORS_DETECTED' : hasSlow ? 'SLOW_OPERATIONS' : 'ALL_OK',
    checks: results,
    recommendation: hasErrors
      ? 'Check database/redis connectivity and migrations'
      : hasSlow
        ? 'Some operations are slow - check database indexes and connection pool'
        : 'All checks passed - issue may be elsewhere',
  });
}
