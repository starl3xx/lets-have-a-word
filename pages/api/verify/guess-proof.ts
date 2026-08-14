import type { NextApiRequest, NextApiResponse } from 'next';
import { buildInclusionProof } from '../../../src/lib/guess-log';
import { getGuessLogAddress } from '../../../src/lib/guess-log-contract';

/**
 * GET /api/verify/guess-proof?roundId=34&guessId=12345
 *
 * Returns the Merkle proof that a guess was committed to the GuessLog contract
 * at a specific position, along with everything needed to check that proof
 * without trusting this API: the leaf pre-image, the checkpoint id, the root,
 * and the transaction that posted it.
 *
 * The point is that the answer here is checkable against Base rather than
 * believed. A caller can hash the leaf themselves, run the proof against the
 * root read from the contract, and confirm the root came from the operator —
 * all without this endpoint being honest. If we ever served a wrong proof, it
 * would fail verification against the chain, which is the property that makes
 * publishing it worth anything.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const roundId = parseInt(String(req.query.roundId ?? ''), 10);
  const guessId = parseInt(String(req.query.guessId ?? ''), 10);

  if (!Number.isFinite(roundId) || !Number.isFinite(guessId)) {
    return res.status(400).json({ error: 'roundId and guessId are required integers' });
  }

  try {
    const result = await buildInclusionProof(roundId, guessId);

    if (!result) {
      // Distinguishing "not committed yet" from "no such guess" matters to a
      // player checking their own guess mid-round: the first is expected and
      // temporary, the second is a real problem.
      return res.status(404).json({
        error: 'No committed checkpoint covers that guess',
        hint:
          'Guesses are committed on an interval, so the most recent ones are not yet ' +
          'in a checkpoint. If this persists after the round resolves, the guess was ' +
          'never committed.',
      });
    }

    return res.status(200).json({
      roundId,
      guessId,
      contract: getGuessLogAddress(),
      chainId: 8453,
      checkpointId: result.checkpointId,
      root: result.root,
      txHash: result.txHash,
      // The leaf pre-image, in the order GuessLog.hashLeaf encodes it.
      leaf: {
        roundId: result.leaf.roundId,
        index: result.leaf.index,
        fid: result.leaf.fid,
        word: result.leaf.word,
        guessedAt: result.leaf.guessedAt,
      },
      leafEncoding: ['uint256', 'uint64', 'uint256', 'string', 'uint64'],
      proof: result.proof,
      howToVerify:
        'Call GuessLog.hashLeaf(roundId, index, fid, word, guessedAt) then ' +
        'GuessLog.verifyInclusion(roundId, checkpointId, leaf, proof) on Base. ' +
        'Leaves are double-hashed (OpenZeppelin StandardMerkleTree).',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[verify/guess-proof] Failed:', error);
    return res.status(500).json({ error: message });
  }
}
