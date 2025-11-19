import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { roundSeedWords } from '../../../src/db/schema';
import { eq } from 'drizzle-orm';
import { ensureActiveRound } from '../../../src/lib/rounds';
import { populateRoundSeedWords } from '../../../src/lib/wheel';

/**
 * Admin endpoint to refresh seed words for the active round
 * This deletes existing seed words and repopulates with new ones
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // Get active round
    const activeRound = await ensureActiveRound();

    console.log(`[refresh-seed-words] Deleting existing seed words for round ${activeRound.id}`);

    // Delete existing seed words
    await db
      .delete(roundSeedWords)
      .where(eq(roundSeedWords.roundId, activeRound.id));

    console.log(`[refresh-seed-words] Populating new seed words...`);

    // Populate new seed words (default 30)
    await populateRoundSeedWords(activeRound.id, 30);

    return res.status(200).json({
      success: true,
      roundId: activeRound.id,
      message: 'Seed words refreshed successfully'
    });
  } catch (error) {
    console.error('[refresh-seed-words] Error:', error);
    return res.status(500).json({
      error: 'Failed to refresh seed words',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
}
