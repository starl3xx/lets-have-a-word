import type { NextApiRequest, NextApiResponse } from 'next';
import { submitGuess } from '../../src/lib/guesses';
import { ensureActiveRound } from '../../src/lib/rounds';
import type { SubmitGuessResult } from '../../src/types';

/**
 * POST /api/guess
 *
 * Submit a guess for the current active round
 *
 * Request body:
 * {
 *   "word": "CRANE"
 * }
 *
 * Response: SubmitGuessResult
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<SubmitGuessResult | { error: string }>
) {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { word } = req.body;

    // Validate request
    if (typeof word !== 'string' || !word) {
      return res.status(400).json({ error: 'Invalid request: word is required' });
    }

    // Ensure there's an active round (create one if needed)
    await ensureActiveRound();

    // For Milestone 1.4, use a hardcoded test FID
    // In later milestones, this will come from Farcaster auth
    const TEST_FID = 12345;

    // Submit the guess
    const result = await submitGuess({
      fid: TEST_FID,
      word,
      isPaidGuess: false, // All guesses are free for Milestone 1.4
    });

    // Return the result
    return res.status(200).json(result);

  } catch (error: any) {
    console.error('Error in /api/guess:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
