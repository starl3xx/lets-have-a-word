import type { NextApiRequest, NextApiResponse } from 'next';
import { submitGuess } from '../../src/lib/guesses';
import { ensureActiveRound } from '../../src/lib/rounds';
import { verifyFrameMessage, verifySigner } from '../../src/lib/farcaster';
import { upsertUserFromFarcaster } from '../../src/lib/users';
import type { SubmitGuessResult } from '../../src/types';

/**
 * POST /api/guess
 *
 * Submit a guess for the current active round
 *
 * Milestone 2.1: Now uses Farcaster authentication
 *
 * Request body:
 * {
 *   "word": "CRANE",
 *   "frameMessage"?: "0x..." (for frame requests),
 *   "signerUuid"?: "uuid-..." (for mini app SDK),
 *   "ref"?: 12345 (optional referrer FID)
 * }
 *
 * For development (when NEYNAR_API_KEY not set):
 * {
 *   "word": "CRANE",
 *   "devFid": 12345 (bypasses Farcaster auth)
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
    const { word, frameMessage, signerUuid, ref, devFid } = req.body;

    // Validate request
    if (typeof word !== 'string' || !word) {
      return res.status(400).json({ error: 'Invalid request: word is required' });
    }

    // Ensure there's an active round (create one if needed)
    await ensureActiveRound();

    let fid: number;
    let signerWallet: string | null = null;
    let spamScore: number | null = null;

    // Check if we're in development mode (no Neynar API key)
    const isDevelopment = !process.env.NEYNAR_API_KEY;

    if (isDevelopment && devFid) {
      // Development mode: allow explicit FID for testing
      fid = typeof devFid === 'number' ? devFid : parseInt(devFid, 10);
      console.log(`⚠️  Development mode: using devFid ${fid}`);
    } else {
      // Production mode: require Farcaster authentication

      // Verify Farcaster request and extract user context
      let farcasterContext;

      if (frameMessage) {
        // Frame request (from Warpcast or other frame clients)
        try {
          farcasterContext = await verifyFrameMessage(frameMessage);
        } catch (error: any) {
          console.error('Frame verification failed:', error);
          return res.status(401).json({ error: 'Invalid Farcaster frame signature' });
        }
      } else if (signerUuid) {
        // Mini app SDK request (using Farcaster SDK signer)
        try {
          farcasterContext = await verifySigner(signerUuid);
        } catch (error: any) {
          console.error('Signer verification failed:', error);
          return res.status(401).json({ error: 'Invalid Farcaster signer' });
        }
      } else {
        return res.status(400).json({
          error: 'Authentication required: provide frameMessage or signerUuid (or devFid in development)',
        });
      }

      fid = farcasterContext.fid;
      signerWallet = farcasterContext.signerWallet;
      spamScore = farcasterContext.spamScore;

      // Parse referral parameter
      const referrerFid = ref ? (typeof ref === 'number' ? ref : parseInt(ref, 10)) : null;

      // Upsert user with Farcaster data
      await upsertUserFromFarcaster({
        fid,
        signerWallet,
        spamScore,
        referrerFid,
      });
    }

    // Submit the guess with the authenticated FID
    const result = await submitGuess({
      fid,
      word,
      isPaidGuess: false, // All guesses are free for Milestone 2.1
    });

    // Return the result
    return res.status(200).json(result);

  } catch (error: any) {
    console.error('Error in /api/guess:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
