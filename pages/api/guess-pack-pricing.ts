import type { NextApiRequest, NextApiResponse } from 'next';
import { getPackPricingInfo } from '../../config/economy';

/**
 * GET /api/guess-pack-pricing
 * Milestone 6.3
 *
 * Returns guess pack pricing information.
 */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const pricingInfo = getPackPricingInfo();
    return res.status(200).json(pricingInfo);
  } catch (error) {
    console.error('[guess-pack-pricing] Error:', error);
    return res.status(500).json({ error: 'Failed to fetch pricing info' });
  }
}
