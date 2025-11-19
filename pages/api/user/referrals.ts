import type { NextApiRequest, NextApiResponse } from 'next';
import { db } from '../../../src/db';
import { users, roundPayouts } from '../../../src/db/schema';
import { eq, and, sql, count } from 'drizzle-orm';

export interface UserReferralsResponse {
  referralLink: string;
  referralsCount: number;
  referralEthEarned: string;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<UserReferralsResponse | { error: string }>
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    let fid: number;

    if (req.query.devFid) {
      fid = parseInt(req.query.devFid as string, 10);
    } else if (req.query.fid) {
      fid = parseInt(req.query.fid as string, 10);
    } else {
      return res.status(400).json({ error: 'FID required' });
    }

    // Get referrals count - users who have this FID as their referrer
    const referralsResult = await db
      .select({ count: count() })
      .from(users)
      .where(eq(users.referrerFid, fid));

    const referralsCount = Number(referralsResult[0]?.count || 0);

    // Get ETH earned from referrals - payouts with role='referrer'
    const payoutsResult = await db
      .select({
        total: sql<string>`coalesce(sum(${roundPayouts.amountEth}), '0')`,
      })
      .from(roundPayouts)
      .where(
        and(
          eq(roundPayouts.fid, fid),
          eq(roundPayouts.role, 'referrer')
        )
      );

    const referralEthEarned = payoutsResult[0]?.total || '0';

    // Generate referral link
    // Use NEXT_PUBLIC_APP_URL if available, otherwise construct from request headers
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL ||
      `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;

    const referralLink = `${baseUrl}?ref=${fid}`;

    return res.status(200).json({
      referralLink,
      referralsCount,
      referralEthEarned,
    });
  } catch (error) {
    console.error('[user/referrals] Error fetching referral data:', error);
    return res.status(500).json({ error: 'Failed to fetch referral data' });
  }
}
