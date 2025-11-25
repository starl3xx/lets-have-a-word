/**
 * Archive Debug API (Admin Only)
 * Milestone 5.4: Round archive
 *
 * Returns debug info comparing archived data with raw data
 *
 * GET /api/admin/archive/debug/:roundNumber
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../../me';
import { getArchiveDebugInfo, getArchiveErrors } from '../../../../../src/lib/archive';

export interface ArchiveDebugResponse {
  roundNumber: number;
  archived: any | null;
  raw: {
    round: any;
    guessCount: number;
    uniquePlayers: number;
    payouts: any[];
    announcerEvent: any;
  } | null;
  discrepancies: string[];
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ArchiveDebugResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get FID from dev mode or session
    let fid: number | null = null;

    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check admin status
    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { roundNumber } = req.query;

    if (!roundNumber || typeof roundNumber !== 'string') {
      return res.status(400).json({ error: 'Round number is required' });
    }

    const roundNum = parseInt(roundNumber, 10);
    if (isNaN(roundNum) || roundNum < 1) {
      return res.status(400).json({ error: 'Invalid round number' });
    }

    const debugInfo = await getArchiveDebugInfo(roundNum);

    // Serialize the data for JSON response
    const response: ArchiveDebugResponse = {
      roundNumber: roundNum,
      archived: debugInfo.archived ? serializeArchiveRow(debugInfo.archived) : null,
      raw: debugInfo.raw ? {
        round: serializeRoundRow(debugInfo.raw.round),
        guessCount: debugInfo.raw.guessCount,
        uniquePlayers: debugInfo.raw.uniquePlayers,
        payouts: debugInfo.raw.payouts.map(serializePayoutRow),
        announcerEvent: debugInfo.raw.announcerEvent,
      } : null,
      discrepancies: debugInfo.discrepancies,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[api/admin/archive/debug] Error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Serialize archive row for JSON response
 */
function serializeArchiveRow(row: any): any {
  return {
    ...row,
    seedEth: row.seedEth?.toString(),
    finalJackpotEth: row.finalJackpotEth?.toString(),
    startTime: row.startTime?.toISOString(),
    endTime: row.endTime?.toISOString(),
    createdAt: row.createdAt?.toISOString(),
  };
}

/**
 * Serialize round row for JSON response
 */
function serializeRoundRow(row: any): any {
  return {
    ...row,
    prizePoolEth: row.prizePoolEth?.toString(),
    seedNextRoundEth: row.seedNextRoundEth?.toString(),
    startedAt: row.startedAt?.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString(),
  };
}

/**
 * Serialize payout row for JSON response
 */
function serializePayoutRow(row: any): any {
  return {
    ...row,
    amountEth: row.amountEth?.toString(),
    createdAt: row.createdAt?.toISOString(),
  };
}
