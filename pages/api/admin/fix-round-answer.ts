/**
 * Fix Round Answer API Endpoint
 *
 * POST /api/admin/fix-round-answer
 *
 * Fixes a round's corrupted answer field by encrypting and storing the correct answer.
 *
 * Body: { roundId: number, answer: string }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from './me';
import { encryptAndPack, getPlaintextAnswer } from '../../../src/lib/encryption';
import { db } from '../../../src/db';
import { rounds } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Auth check
    let fid: number | null = null;
    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.cookies.siwn_fid) {
      fid = parseInt(req.cookies.siwn_fid, 10);
    } else if (req.body?.fid) {
      fid = parseInt(req.body.fid, 10);
    }

    if (!fid || isNaN(fid)) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!isAdminFid(fid)) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    const { roundId, answer } = req.body;

    if (!roundId || typeof roundId !== 'number') {
      return res.status(400).json({ error: 'roundId (number) is required' });
    }

    if (!answer || typeof answer !== 'string' || answer.length !== 5) {
      return res.status(400).json({ error: 'answer must be a 5-letter string' });
    }

    const normalizedAnswer = answer.toUpperCase();

    // Check round exists
    const [round] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    if (!round) {
      return res.status(404).json({ error: `Round ${roundId} not found` });
    }

    // Log current state
    console.log(`[fix-round-answer] Round ${roundId} current answer type: ${typeof round.answer}`);
    console.log(`[fix-round-answer] Round ${roundId} current answer: ${round.answer}`);

    // Encrypt the correct answer
    const encryptedAnswer = encryptAndPack(normalizedAnswer);
    console.log(`[fix-round-answer] Encrypted answer: ${encryptedAnswer.substring(0, 40)}...`);

    // Update the database
    await db.update(rounds)
      .set({ answer: encryptedAnswer })
      .where(eq(rounds.id, roundId));

    // Verify
    const [updatedRound] = await db.select().from(rounds).where(eq(rounds.id, roundId));
    const decryptedAnswer = getPlaintextAnswer(updatedRound.answer);

    if (decryptedAnswer !== normalizedAnswer) {
      return res.status(500).json({
        error: 'Verification failed',
        expected: normalizedAnswer,
        got: decryptedAnswer,
      });
    }

    console.log(`[fix-round-answer] ✅ Round ${roundId} answer fixed to ${normalizedAnswer}`);

    return res.status(200).json({
      success: true,
      roundId,
      answer: normalizedAnswer,
      message: `Round ${roundId} answer fixed. You can now re-run archive sync.`,
    });

  } catch (error) {
    console.error('[fix-round-answer] Error:', error);
    return res.status(500).json({
      error: 'Failed to fix round answer',
      details: error instanceof Error ? error.message : String(error),
    });
  }
}
