/**
 * Data Export API
 * Milestone 5.3: Advanced analytics & fairness systems
 *
 * Provides CSV and JSON export for:
 * - Rounds data
 * - Guesses data
 * - Users data
 * - Payouts data
 * - Analytics events
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../../src/db';
import { rounds, guesses, users, roundPayouts, analyticsEvents } from '../../../../src/db/schema';
import { desc, gte, lte, sql } from 'drizzle-orm';
import { isAdminFid } from '../me';

type ExportDataType = 'rounds' | 'guesses' | 'users' | 'payouts' | 'analytics_events';
type ExportFormat = 'csv' | 'json';

interface ExportRequest {
  dataType: ExportDataType;
  format?: ExportFormat;
  startDate?: string; // ISO date string
  endDate?: string;   // ISO date string
  limit?: number;
}

function toCSV(data: any[], columns?: string[]): string {
  if (data.length === 0) return '';

  const headers = columns || Object.keys(data[0]);
  const rows = data.map(row =>
    headers.map(header => {
      const value = row[header];
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') return JSON.stringify(value).replace(/"/g, '""');
      const stringValue = String(value);
      // Escape quotes and wrap in quotes if contains comma, newline, or quote
      if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
        return `"${stringValue.replace(/"/g, '""')}"`;
      }
      return stringValue;
    }).join(',')
  );

  return [headers.join(','), ...rows].join('\n');
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Admin authentication
  let fid: number | null = null;
  if (req.query.devFid) {
    fid = parseInt(req.query.devFid as string, 10);
  } else if (req.cookies.siwn_fid) {
    fid = parseInt(req.cookies.siwn_fid, 10);
  }

  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  try {
    // Parse parameters from query (GET) or body (POST)
    const params: ExportRequest = req.method === 'GET'
      ? {
          dataType: req.query.dataType as ExportDataType,
          format: (req.query.format as ExportFormat) || 'json',
          startDate: req.query.startDate as string,
          endDate: req.query.endDate as string,
          limit: req.query.limit ? parseInt(req.query.limit as string, 10) : undefined,
        }
      : req.body;

    const { dataType, format = 'json', startDate, endDate, limit = 1000 } = params;

    if (!dataType) {
      return res.status(400).json({
        error: 'Missing dataType. Use: rounds, guesses, users, payouts, or analytics_events',
      });
    }

    // Parse date filters
    const startDateObj = startDate ? new Date(startDate) : undefined;
    const endDateObj = endDate ? new Date(endDate) : undefined;

    let data: any[] = [];

    switch (dataType) {
      case 'rounds':
        const roundsQuery = db
          .select({
            id: rounds.id,
            rulesetId: rounds.rulesetId,
            answer: rounds.answer,
            commitHash: rounds.commitHash,
            prizePoolEth: rounds.prizePoolEth,
            seedNextRoundEth: rounds.seedNextRoundEth,
            winnerFid: rounds.winnerFid,
            referrerFid: rounds.referrerFid,
            isDevTestRound: rounds.isDevTestRound,
            startedAt: rounds.startedAt,
            resolvedAt: rounds.resolvedAt,
          })
          .from(rounds)
          .orderBy(desc(rounds.startedAt))
          .limit(limit);

        data = await roundsQuery;
        break;

      case 'guesses':
        const guessesQuery = db
          .select({
            id: guesses.id,
            roundId: guesses.roundId,
            fid: guesses.fid,
            word: guesses.word,
            isPaid: guesses.isPaid,
            isCorrect: guesses.isCorrect,
            createdAt: guesses.createdAt,
          })
          .from(guesses)
          .orderBy(desc(guesses.createdAt))
          .limit(limit);

        data = await guessesQuery;
        break;

      case 'users':
        const usersQuery = db
          .select({
            id: users.id,
            fid: users.fid,
            username: users.username,
            referrerFid: users.referrerFid,
            userScore: users.userScore,
            xp: users.xp,
            hasSeenIntro: users.hasSeenIntro,
            createdAt: users.createdAt,
            updatedAt: users.updatedAt,
          })
          .from(users)
          .orderBy(desc(users.createdAt))
          .limit(limit);

        data = await usersQuery;
        break;

      case 'payouts':
        const payoutsQuery = db
          .select({
            id: roundPayouts.id,
            roundId: roundPayouts.roundId,
            fid: roundPayouts.fid,
            amountEth: roundPayouts.amountEth,
            role: roundPayouts.role,
            createdAt: roundPayouts.createdAt,
          })
          .from(roundPayouts)
          .orderBy(desc(roundPayouts.createdAt))
          .limit(limit);

        data = await payoutsQuery;
        break;

      case 'analytics_events':
        const eventsQuery = db
          .select({
            id: analyticsEvents.id,
            eventType: analyticsEvents.eventType,
            userId: analyticsEvents.userId,
            roundId: analyticsEvents.roundId,
            data: analyticsEvents.data,
            createdAt: analyticsEvents.createdAt,
          })
          .from(analyticsEvents)
          .orderBy(desc(analyticsEvents.createdAt))
          .limit(limit);

        data = await eventsQuery;
        break;

      default:
        return res.status(400).json({
          error: `Unknown data type: ${dataType}. Use: rounds, guesses, users, payouts, or analytics_events`,
        });
    }

    // Filter by date if provided
    if (startDateObj || endDateObj) {
      data = data.filter(row => {
        const rowDate = row.createdAt || row.startedAt;
        if (!rowDate) return true;
        const date = new Date(rowDate);
        if (startDateObj && date < startDateObj) return false;
        if (endDateObj && date > endDateObj) return false;
        return true;
      });
    }

    // Return based on format
    if (format === 'csv') {
      const csvContent = toCSV(data);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${dataType}_export_${Date.now()}.csv"`);
      return res.status(200).send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${dataType}_export_${Date.now()}.json"`);
      return res.status(200).json({
        dataType,
        exportedAt: new Date().toISOString(),
        recordCount: data.length,
        data,
      });
    }

  } catch (error) {
    console.error('[analytics/export] Error:', error);
    return res.status(500).json({
      error: 'Export failed',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
