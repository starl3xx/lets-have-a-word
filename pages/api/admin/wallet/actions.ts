/**
 * Admin Wallet Actions API
 * GET: Fetch recent wallet actions
 * POST: Log a new wallet action
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { adminWalletActions } from '../../../../src/db/schema';
import { desc, eq } from 'drizzle-orm';
import type { AdminWalletActionType, AdminWalletActionInsert } from '../../../../src/db/schema';

export interface WalletAction {
  id: number;
  actionType: AdminWalletActionType;
  amountEth: string;
  fromAddress: string;
  toAddress: string;
  txHash: string | null;
  status: 'pending' | 'confirmed' | 'failed';
  initiatedByFid: number;
  initiatedByAddress: string;
  note: string | null;
  createdAt: string;
  confirmedAt: string | null;
}

export interface WalletActionsResponse {
  actions: WalletAction[];
  total: number;
}

export interface LogActionRequest {
  actionType: AdminWalletActionType;
  amountEth: string;
  amountWei: string;
  fromAddress: string;
  toAddress: string;
  txHash?: string;
  initiatedByFid: number;
  initiatedByAddress: string;
  note?: string;
  metadata?: Record<string, unknown>;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WalletActionsResponse | WalletAction | { error: string }>
) {
  // Auth check
  let fid: number | null = null;
  if (req.query.devFid || req.body?.devFid) {
    fid = parseInt((req.query.devFid || req.body?.devFid) as string, 10);
  } else if (req.cookies.siwn_fid) {
    fid = parseInt(req.cookies.siwn_fid, 10);
  }

  if (!fid || !isAdminFid(fid)) {
    return res.status(403).json({ error: 'Forbidden: Admin access required' });
  }

  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res, fid);
  } else {
    return res.status(405).json({ error: 'Method not allowed' });
  }
}

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse<WalletActionsResponse | { error: string }>
) {
  try {
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);

    const actions = await db
      .select()
      .from(adminWalletActions)
      .orderBy(desc(adminWalletActions.createdAt))
      .limit(limit);

    const response: WalletActionsResponse = {
      actions: actions.map(a => ({
        id: a.id,
        actionType: a.actionType,
        amountEth: a.amountEth,
        fromAddress: a.fromAddress,
        toAddress: a.toAddress,
        txHash: a.txHash,
        status: a.status,
        initiatedByFid: a.initiatedByFid,
        initiatedByAddress: a.initiatedByAddress,
        note: a.note,
        createdAt: a.createdAt.toISOString(),
        confirmedAt: a.confirmedAt?.toISOString() || null,
      })),
      total: actions.length,
    };

    return res.status(200).json(response);
  } catch (error) {
    console.error('[admin/wallet/actions] GET error:', error);
    return res.status(500).json({ error: 'Failed to fetch actions' });
  }
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse<WalletAction | { error: string }>,
  adminFid: number
) {
  try {
    const body = req.body as LogActionRequest;

    // Validate required fields
    if (!body.actionType || !body.amountEth || !body.amountWei ||
        !body.fromAddress || !body.toAddress || !body.initiatedByAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate action type
    const validTypes: AdminWalletActionType[] = ['prize_pool_injection', 'creator_pool_withdrawal', 'refund_batch'];
    if (!validTypes.includes(body.actionType)) {
      return res.status(400).json({ error: 'Invalid action type' });
    }

    const insert: AdminWalletActionInsert = {
      actionType: body.actionType,
      amountEth: body.amountEth,
      amountWei: body.amountWei,
      fromAddress: body.fromAddress.toLowerCase(),
      toAddress: body.toAddress.toLowerCase(),
      txHash: body.txHash || null,
      status: body.txHash ? 'pending' : 'pending',
      initiatedByFid: body.initiatedByFid || adminFid,
      initiatedByAddress: body.initiatedByAddress.toLowerCase(),
      note: body.note || null,
      metadata: body.metadata || null,
    };

    const [action] = await db
      .insert(adminWalletActions)
      .values(insert)
      .returning();

    console.log(`[admin/wallet/actions] Logged ${body.actionType}: ${body.amountEth} ETH by FID ${adminFid}`);

    return res.status(201).json({
      id: action.id,
      actionType: action.actionType,
      amountEth: action.amountEth,
      fromAddress: action.fromAddress,
      toAddress: action.toAddress,
      txHash: action.txHash,
      status: action.status,
      initiatedByFid: action.initiatedByFid,
      initiatedByAddress: action.initiatedByAddress,
      note: action.note,
      createdAt: action.createdAt.toISOString(),
      confirmedAt: action.confirmedAt?.toISOString() || null,
    });
  } catch (error) {
    console.error('[admin/wallet/actions] POST error:', error);
    return res.status(500).json({ error: 'Failed to log action' });
  }
}

/**
 * Update action status (called after tx confirmation)
 */
export async function updateActionStatus(
  actionId: number,
  status: 'confirmed' | 'failed',
  txHash?: string
): Promise<void> {
  await db
    .update(adminWalletActions)
    .set({
      status,
      txHash: txHash || undefined,
      confirmedAt: status === 'confirmed' ? new Date() : undefined,
    })
    .where(eq(adminWalletActions.id, actionId));
}
