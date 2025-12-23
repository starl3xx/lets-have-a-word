/**
 * Gameplay Insights Analytics API
 * Analytics v2: Word difficulty, solve rates, guess distribution
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { sql } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { cacheAside, CacheKeys, CacheTTL, trackSlowQuery } from '../../../../src/lib/redis';

export interface GameplayInsights {
  // Core metrics
  medianGuessesToSolve: number;
  solveRate: number;
  totalRounds: number;
  totalGuesses: number;

  // Guess distribution
  guessDistribution: Array<{
    guessCount: number;
    rounds: number;
    percentage: number;
  }>;

  // Drop-off analysis
  guessDropOff: Array<{
    guessNumber: number;
    playersRemaining: number;
    dropOffRate: number;
  }>;

  // Word difficulty
  hardestWords: Array<{
    word: string;
    roundId: number;
    solveRate: number;
    medianGuesses: number;
  }>;

  easiestWords: Array<{
    word: string;
    roundId: number;
    solveRate: number;
    medianGuesses: number;
  }>;

  // Session metrics
  avgTimeToFirstGuess: number;
  avgSessionLength: number;

  timeRange: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<GameplayInsights | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (process.env.ANALYTICS_ENABLED !== 'true') {
    return res.status(503).json({ error: 'Analytics not enabled.' });
  }

  try {
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || !isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    const timeRange = req.query.range as string || '30d';
    const daysBack = timeRange === '7d' ? 7 : timeRange === '30d' ? 30 : 9999;

    // Query 1: Solve rate and median guesses
    const solveMetrics = await db.execute<{
      solve_rate: number;
      median_guesses: number;
      total_rounds: number;
      total_guesses: number;
    }>(sql`
      WITH round_stats AS (
        SELECT
          r.id as round_id,
          r.answer,
          COUNT(g.id) as guess_count,
          MAX(CASE WHEN g.is_correct = true THEN 1 ELSE 0 END) as was_solved
        FROM rounds r
        LEFT JOIN guesses g ON g.round_id = r.id
        WHERE r.started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND r.is_dev_test_round = false
          AND r.resolved_at IS NOT NULL
        GROUP BY r.id, r.answer
      )
      SELECT
        ROUND(AVG(was_solved) * 100, 2) as solve_rate,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY guess_count) as median_guesses,
        COUNT(*) as total_rounds,
        SUM(guess_count) as total_guesses
      FROM round_stats
    `);

    // Query 2: Guess distribution histogram
    const guessDistQuery = await db.execute<{
      guess_count: number;
      rounds: number;
    }>(sql`
      SELECT
        guess_count,
        COUNT(*) as rounds
      FROM (
        SELECT r.id, COUNT(g.id) as guess_count
        FROM rounds r
        LEFT JOIN guesses g ON g.round_id = r.id
        WHERE r.started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND r.is_dev_test_round = false
          AND r.resolved_at IS NOT NULL
        GROUP BY r.id
      ) round_guesses
      GROUP BY guess_count
      ORDER BY guess_count
      LIMIT 20
    `);

    // Query 3: Hardest and easiest words
    const wordDiffQuery = await db.execute<{
      word: string;
      round_id: number;
      solve_rate: number;
      median_guesses: number;
    }>(sql`
      WITH round_stats AS (
        SELECT
          r.id as round_id,
          r.answer as word,
          COUNT(g.id) as guess_count,
          MAX(CASE WHEN g.is_correct = true THEN 1 ELSE 0 END) as was_solved
        FROM rounds r
        LEFT JOIN guesses g ON g.round_id = r.id
        WHERE r.started_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND r.is_dev_test_round = false
          AND r.resolved_at IS NOT NULL
        GROUP BY r.id, r.answer
        HAVING COUNT(g.id) >= 5
      )
      SELECT
        word,
        round_id,
        ROUND(was_solved * 100, 2) as solve_rate,
        guess_count as median_guesses
      FROM round_stats
      ORDER BY solve_rate ASC, median_guesses DESC
    `);

    // Query 4: Session metrics
    const sessionMetrics = await db.execute<{
      avg_time_to_first: number;
      avg_session_length: number;
    }>(sql`
      SELECT
        AVG(EXTRACT(EPOCH FROM (first_guess - session_start)) / 60) as avg_time_to_first,
        AVG(EXTRACT(EPOCH FROM (last_guess - session_start)) / 60) as avg_session_length
      FROM (
        SELECT
          user_id,
          DATE_TRUNC('day', created_at) as session_day,
          MIN(created_at) as session_start,
          MIN(created_at) FILTER (WHERE event_type = 'first_guess_submitted') as first_guess,
          MAX(created_at) as last_guess
        FROM analytics_events
        WHERE created_at >= NOW() - INTERVAL '${sql.raw(daysBack.toString())} days'
          AND event_type IN ('game_session_start', 'first_guess_submitted', 'guess_submitted')
        GROUP BY user_id, DATE_TRUNC('day', created_at)
      ) sessions
      WHERE first_guess IS NOT NULL
    `);

    const solveData = Array.isArray(solveMetrics) ? solveMetrics[0] : solveMetrics;
    const guessDistArray = Array.isArray(guessDistQuery) ? guessDistQuery : [];
    const wordDiffArray = Array.isArray(wordDiffQuery) ? wordDiffQuery : [];
    const sessionData = Array.isArray(sessionMetrics) ? sessionMetrics[0] : sessionMetrics;

    const totalRoundsInDist = guessDistArray.reduce((sum, item) => sum + Number(item.rounds), 0);
    const guessDistribution = guessDistArray.map(item => ({
      guessCount: Number(item.guess_count),
      rounds: Number(item.rounds),
      percentage: totalRoundsInDist > 0 ? Number(((Number(item.rounds) / totalRoundsInDist) * 100).toFixed(2)) : 0
    }));

    // Calculate drop-off
    const guessDropOff: Array<{ guessNumber: number; playersRemaining: number; dropOffRate: number }> = [];
    let cumulativeRounds = totalRoundsInDist;
    guessDistribution.forEach((dist, idx) => {
      if (idx > 0) {
        cumulativeRounds -= guessDistribution[idx - 1].rounds;
      }
      guessDropOff.push({
        guessNumber: dist.guessCount,
        playersRemaining: cumulativeRounds,
        dropOffRate: idx > 0 ? Number(((1 - cumulativeRounds / totalRoundsInDist) * 100).toFixed(2)) : 0
      });
    });

    const hardestWords = wordDiffArray.slice(0, 5).map(w => ({
      word: w.word,
      roundId: Number(w.round_id),
      solveRate: Number(w.solve_rate),
      medianGuesses: Number(w.median_guesses)
    }));

    const easiestWords = wordDiffArray.slice(-5).reverse().map(w => ({
      word: w.word,
      roundId: Number(w.round_id),
      solveRate: Number(w.solve_rate),
      medianGuesses: Number(w.median_guesses)
    }));

    const insights: GameplayInsights = {
      medianGuessesToSolve: Number(solveData?.median_guesses) || 0,
      solveRate: Number(solveData?.solve_rate) || 0,
      totalRounds: Number(solveData?.total_rounds) || 0,
      totalGuesses: Number(solveData?.total_guesses) || 0,
      guessDistribution,
      guessDropOff,
      hardestWords,
      easiestWords,
      avgTimeToFirstGuess: Number(sessionData?.avg_time_to_first) || 0,
      avgSessionLength: Number(sessionData?.avg_session_length) || 0,
      timeRange
    };

    console.log('[analytics/gameplay] Returning insights:', JSON.stringify(insights).substring(0, 300));
    return res.status(200).json(insights);
  } catch (error) {
    console.error('[analytics/gameplay] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
