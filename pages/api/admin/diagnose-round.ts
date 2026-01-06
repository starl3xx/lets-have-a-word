/**
 * Diagnose Round Field Types API Endpoint
 *
 * GET /api/admin/diagnose-round?roundId=2
 *
 * Shows the actual types and values of all fields in a round to identify corruption.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { db } from '../../../src/db';
import { rounds, roundPayouts } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated. Add ?devFid=YOUR_FID to the URL.' });
    }

    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const roundId = parseInt(req.query.roundId as string, 10);
    if (!roundId || isNaN(roundId)) {
      return res.status(400).json({ error: 'roundId query parameter is required' });
    }

    // Get the round
    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    // Analyze each field
    const fieldDiagnostics: Record<string, {
      type: string;
      isDate: boolean;
      isNull: boolean;
      value: any;
      problem?: string;
    }> = {};

    // Required string fields (must be strings)
    const requiredStringFields = ['answer', 'salt', 'commitHash', 'prizePoolEth', 'seedNextRoundEth'];
    // Optional string fields (can be null)
    const optionalStringFields = ['txHash'];

    for (const field of [...requiredStringFields, ...optionalStringFields]) {
      const value = (round as any)[field];
      const isDate = value instanceof Date;
      const type = typeof value;
      const isNull = value === null;
      const isUndefined = value === undefined;
      const isOptional = optionalStringFields.includes(field);

      const diagnostic: typeof fieldDiagnostics[string] = {
        type,
        isDate,
        isNull,
        value: isDate ? value.toISOString() : (isNull || isUndefined ? null : String(value).substring(0, 100)),
      };

      // Check for problems
      if (isOptional) {
        // Optional: only flag if present but not a string (Date objects, etc.)
        if (!isNull && !isUndefined && type !== 'string') {
          diagnostic.problem = `Expected string or null but got ${type}${isDate ? ' (Date object)' : ''}. Fix with /api/admin/fix-round-field`;
        }
      } else {
        // Required: must be a string
        if (type !== 'string') {
          diagnostic.problem = `Expected string but got ${type}${isDate ? ' (Date object)' : ''}. Fix with /api/admin/fix-round-field`;
        }
      }

      fieldDiagnostics[field] = diagnostic;
    }

    // Check for any problems
    const problems = Object.entries(fieldDiagnostics)
      .filter(([_, diag]) => diag.problem)
      .map(([field, diag]) => ({ field, ...diag }));

    // Also check round_payouts for this round
    const payouts = await db.select().from(roundPayouts).where(eq(roundPayouts.roundId, roundId));
    const payoutIssues: Array<{ id: number; field: string; type: string; isDate: boolean; value: any }> = [];
    for (const payout of payouts) {
      // Check amountEth field
      if (typeof payout.amountEth !== 'string') {
        payoutIssues.push({
          id: payout.id,
          field: 'amountEth',
          type: typeof payout.amountEth,
          isDate: payout.amountEth instanceof Date,
          value: payout.amountEth instanceof Date ? (payout.amountEth as Date).toISOString() : String(payout.amountEth),
        });
      }
    }

    // Check previous round if this is Round 2+
    let previousRoundIssues: any = null;
    if (roundId > 1) {
      const [prevRound] = await db.select().from(rounds).where(eq(rounds.id, roundId - 1));
      if (prevRound) {
        const prevFieldsToCheck = ['seedNextRoundEth', 'prizePoolEth', 'answer', 'salt', 'commitHash'];
        const prevProblems: any[] = [];
        for (const field of prevFieldsToCheck) {
          const value = (prevRound as any)[field];
          if (value !== null && typeof value !== 'string') {
            prevProblems.push({
              field,
              type: typeof value,
              isDate: value instanceof Date,
              value: value instanceof Date ? value.toISOString() : String(value).substring(0, 50),
            });
          }
        }
        if (prevProblems.length > 0) {
          previousRoundIssues = {
            roundId: roundId - 1,
            problems: prevProblems,
          };
        }
      }
    }

    return res.status(200).json({
      roundId,
      status: problems.length > 0 || payoutIssues.length > 0 || previousRoundIssues ? 'CORRUPTED' : 'OK',
      problemCount: problems.length + payoutIssues.length + (previousRoundIssues?.problems?.length || 0),
      problems,
      payoutIssues: payoutIssues.length > 0 ? payoutIssues : undefined,
      previousRoundIssues,
      allFields: fieldDiagnostics,
      fixInstructions: problems.length > 0
        ? `Visit /api/admin/fix-round-field and fix these fields: ${problems.map(p => p.field).join(', ')}`
        : null,
    });

  } catch (error) {
    console.error('[diagnose-round] Error:', error);
    return res.status(500).json({
      error: 'Failed to diagnose round',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
