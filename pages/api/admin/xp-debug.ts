/**
 * XP Debug API (Dev Mode Only)
 * Milestone 6.7: Dev mode XP debugging tools
 *
 * Provides detailed XP event information for debugging.
 * Only available when LHAW_DEV_MODE=true.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import {
  getTotalXpForFid,
  getRecentXpEventsForFid,
  getXpBreakdownForFid,
} from '../../../src/lib/xp';
import { isDevModeEnabled } from '../../../src/lib/devGameState';
import { db } from '../../../src/db';
import { xpEvents } from '../../../src/db/schema';
import { desc, sql } from 'drizzle-orm';

interface XpDebugResponse {
  devMode: boolean;
  userXp?: {
    fid: number;
    totalXp: number;
    breakdown: Record<string, number>;
    recentEvents: Array<{
      id: number;
      eventType: string;
      xpAmount: number;
      roundId: number | null;
      metadata: Record<string, unknown> | null;
      createdAt: Date;
    }>;
  };
  globalStats?: {
    totalXpAwarded: number;
    totalEvents: number;
    eventsByType: Record<string, { count: number; totalXp: number }>;
    topEarners: Array<{ fid: number; totalXp: number }>;
    recentGlobalEvents: Array<{
      id: number;
      fid: number;
      eventType: string;
      xpAmount: number;
      createdAt: Date;
    }>;
  };
}

interface ErrorResponse {
  error: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<XpDebugResponse | ErrorResponse>
) {
  // Only available in dev mode
  if (!isDevModeEnabled()) {
    return res.status(403).json({ error: 'Dev mode not enabled' });
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const response: XpDebugResponse = {
      devMode: true,
    };

    // If FID provided, get user-specific XP data
    const fidParam = req.query.fid;
    if (fidParam) {
      const fid = parseInt(fidParam as string, 10);
      if (!isNaN(fid)) {
        const [totalXp, breakdown, recentEvents] = await Promise.all([
          getTotalXpForFid(fid),
          getXpBreakdownForFid(fid),
          getRecentXpEventsForFid(fid, 50),
        ]);

        response.userXp = {
          fid,
          totalXp,
          breakdown,
          recentEvents: recentEvents.map((e) => ({
            id: e.id,
            eventType: e.eventType,
            xpAmount: e.xpAmount,
            roundId: e.roundId ?? null,
            metadata: e.metadata ?? null,
            createdAt: e.createdAt,
          })),
        };
      }
    }

    // Always include global stats
    // Total XP awarded
    const totalXpResult = await db
      .select({
        totalXp: sql<number>`COALESCE(SUM(${xpEvents.xpAmount}), 0)`.as('total_xp'),
        totalEvents: sql<number>`COUNT(*)`.as('total_events'),
      })
      .from(xpEvents);

    // Events by type
    const eventsByTypeResult = await db
      .select({
        eventType: xpEvents.eventType,
        count: sql<number>`COUNT(*)`.as('count'),
        totalXp: sql<number>`SUM(${xpEvents.xpAmount})`.as('total_xp'),
      })
      .from(xpEvents)
      .groupBy(xpEvents.eventType);

    // Top earners
    const topEarnersResult = await db
      .select({
        fid: xpEvents.fid,
        totalXp: sql<number>`SUM(${xpEvents.xpAmount})`.as('total_xp'),
      })
      .from(xpEvents)
      .groupBy(xpEvents.fid)
      .orderBy(desc(sql`total_xp`))
      .limit(10);

    // Recent global events
    const recentGlobalResult = await db
      .select({
        id: xpEvents.id,
        fid: xpEvents.fid,
        eventType: xpEvents.eventType,
        xpAmount: xpEvents.xpAmount,
        createdAt: xpEvents.createdAt,
      })
      .from(xpEvents)
      .orderBy(desc(xpEvents.createdAt))
      .limit(20);

    response.globalStats = {
      totalXpAwarded: Number(totalXpResult[0]?.totalXp ?? 0),
      totalEvents: Number(totalXpResult[0]?.totalEvents ?? 0),
      eventsByType: eventsByTypeResult.reduce(
        (acc, row) => {
          acc[row.eventType] = {
            count: Number(row.count),
            totalXp: Number(row.totalXp),
          };
          return acc;
        },
        {} as Record<string, { count: number; totalXp: number }>
      ),
      topEarners: topEarnersResult.map((row) => ({
        fid: row.fid,
        totalXp: Number(row.totalXp),
      })),
      recentGlobalEvents: recentGlobalResult.map((row) => ({
        id: row.id,
        fid: row.fid,
        eventType: row.eventType,
        xpAmount: row.xpAmount,
        createdAt: row.createdAt,
      })),
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[xp-debug] Error:', error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Failed to fetch XP debug data',
    });
  }
}
