/**
 * GET /api/wordmarks/metadata/<id>.json — ERC-1155 metadata for one Wordmark.
 *
 * Built from WORDMARK_DEFINITIONS so the name and description a wallet shows
 * are the same strings the game shows, from one source. Nothing here is
 * per-player: an ERC-1155 id describes the achievement, not the holder.
 *
 * WHY THIS IS NOT THE baseUri THE CONTRACT SHIPS WITH. A generated image is
 * only as permanent as the domain, and a soulbound token nobody can re-mint is
 * a bad thing to point at a URL that might lapse. Before deploy the twelve
 * renders are pinned to IPFS and baseUri is set to the pinned directory. This
 * route stays as the app's own convenience and as the thing the pinning step
 * reads from.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { WORDMARK_DEFINITIONS } from '../../../../src/lib/wordmarks';
import { wordmarkTypeForTokenId } from '../../../../src/lib/wordmark-tokens';

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // The path is `<id>.json`, because ERC-1155 consumers append the id to a
  // base and expect a file, so the suffix has to be tolerated here.
  const raw = String(req.query.id ?? '').replace(/\.json$/i, '');
  const id = Number(raw);
  const type = wordmarkTypeForTokenId(id);

  if (!type) {
    return res.status(404).json({ error: 'No such Wordmark' });
  }

  const def = WORDMARK_DEFINITIONS[type];
  const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://www.letshaveaword.fun';

  // Immutable by construction: an id's meaning never changes, so this can be
  // cached hard. Wallets and indexers fetch it often and rarely re-check.
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, immutable');

  return res.status(200).json({
    name: def.name,
    description: `${def.description}. A Wordmark from Let’s Have A Word, earned by playing.`,
    image: `${origin}/api/wordmarks/image/${id}.png`,
    external_url: `${origin}/`,
    attributes: [
      { trait_type: 'Wordmark', value: def.name },
      { trait_type: 'Colour', value: def.color },
      // Soulbound is a property of the token a marketplace should surface,
      // since it changes what the holder can do with it.
      { trait_type: 'Transferable', value: 'No' },
    ],
  });
}
