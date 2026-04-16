/**
 * Crumbs API
 *
 * GET  /api/crumbs?roundId=X&fid=Y (or devFid / frameMessage for auth)
 *   → Returns all crumbs the user has found on a given round.
 *
 * POST /api/crumbs  { roundId, word, devFid / frameMessage / authToken }
 *   → Saves a newly discovered crumb. Idempotent — duplicates return { status: 'duplicate' }.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { saveCrumb, getCrumbs } from '../../src/lib/crumbs';
import { verifyFrameMessage } from '../../src/lib/farcaster';
import { isDevModeEnabled } from '../../src/lib/devGameState';
import type { CrumbsResponse, SaveCrumbResult } from '../../src/types';
import { createClient as createQuickAuthClient } from '@farcaster/quick-auth';

const quickAuthClient = createQuickAuthClient();

/**
 * Resolve the authenticated FID from the request.
 * Supports dev mode (devFid), Quick Auth (authToken), and frame messages.
 */
async function resolveFid(
  req: NextApiRequest,
  source: 'query' | 'body',
): Promise<number | null> {
  const params = source === 'query' ? req.query : req.body;
  const isDev = !process.env.NEYNAR_API_KEY || isDevModeEnabled();

  // Dev mode: accept devFid directly
  if (isDev && params.devFid) {
    const fid = typeof params.devFid === 'number'
      ? params.devFid
      : parseInt(params.devFid as string, 10);
    return isNaN(fid) ? null : fid;
  }

  // Quick Auth JWT
  if (params.authToken) {
    try {
      const result = await quickAuthClient.verifyJwt({ token: params.authToken } as any);
      return result?.sub ? (typeof result.sub === 'number' ? result.sub : parseInt(result.sub, 10)) : null;
    } catch {
      return null;
    }
  }

  // Farcaster frame message
  if (params.frameMessage) {
    try {
      const ctx = await verifyFrameMessage(params.frameMessage as string);
      return ctx?.fid ?? null;
    } catch {
      return null;
    }
  }

  // Dev mode fallback
  if (isDev) return 6500;

  return null;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CrumbsResponse | SaveCrumbResult | { error: string }>
) {
  // ──────────────────────────────
  // GET: Fetch crumbs for a round
  // ──────────────────────────────
  if (req.method === 'GET') {
    try {
      const roundId = parseInt(req.query.roundId as string, 10);
      if (isNaN(roundId) || roundId <= 0) {
        return res.status(400).json({ error: 'roundId is required' });
      }

      const fid = await resolveFid(req, 'query');
      if (!fid) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const crumbs = await getCrumbs(roundId, fid);
      return res.status(200).json(crumbs);
    } catch (error) {
      console.error('[crumbs] GET error:', error);
      Sentry.captureException(error, { tags: { endpoint: 'crumbs', method: 'GET' } });
      return res.status(500).json({ error: 'Failed to fetch crumbs' });
    }
  }

  // ──────────────────────────────
  // POST: Save a crumb
  // ──────────────────────────────
  if (req.method === 'POST') {
    try {
      const { roundId, word } = req.body;

      if (!roundId || typeof roundId !== 'number' || roundId <= 0) {
        return res.status(400).json({ error: 'roundId is required (positive integer)' });
      }
      if (!word || typeof word !== 'string') {
        return res.status(400).json({ error: 'word is required' });
      }

      const fid = await resolveFid(req, 'body');
      if (!fid) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const result = await saveCrumb(roundId, fid, word);

      if (result.status === 'invalid_word') {
        return res.status(400).json(result);
      }

      return res.status(200).json(result);
    } catch (error) {
      console.error('[crumbs] POST error:', error);
      Sentry.captureException(error, { tags: { endpoint: 'crumbs', method: 'POST' } });
      return res.status(500).json({ error: 'Failed to save crumb' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
