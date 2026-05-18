/**
 * Re-announce Round API Endpoint
 *
 * Re-fires the "round started" Farcaster cast and/or push notification for a
 * round whose original announcement failed (e.g. Neynar was unavailable when
 * the round was created).
 *
 * POST /api/admin/operational/reannounce-round
 * Body / query params (all optional):
 *   - roundId            number  Round to announce. Defaults to the latest active round.
 *   - force              boolean Re-post the cast even if a cast hash is already recorded.
 *   - skipCast           boolean Send only the push notification.
 *   - skipNotification   boolean Send only the Farcaster cast.
 *
 * Notes:
 *   - Does NOT post to Twitter/X — only the original createRound() flow cross-posts
 *     there. Use this when the tweet already went out but the cast/notification didn't.
 *   - The push notification has no idempotency: calling this twice double-sends it.
 *
 * Requires admin authentication (FID in LHAW_ADMIN_USER_IDS).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { eq, and, isNull, desc } from 'drizzle-orm';
import { isAdminFid } from '../me';
import { db } from '../../../../src/db';
import { rounds, announcerEvents } from '../../../../src/db/schema';
import { buildRoundStartedAnnouncement, castFromAnnouncer } from '../../../../src/lib/announcer';
import { notifyRoundStarted } from '../../../../src/lib/notifications';

const GAME_EMBED = [{ url: 'https://letshaveaword.fun' }];

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: `Method ${req.method} not allowed. Use POST.` });
  }

  // Auth (mirrors start-round.ts)
  let fid: number | null = null;
  if (req.query.devFid) {
    fid = parseInt(req.query.devFid as string, 10);
  } else if (req.cookies.siwn_fid) {
    fid = parseInt(req.cookies.siwn_fid, 10);
  } else if (req.body?.fid) {
    fid = parseInt(req.body.fid, 10);
  }

  if (!fid || isNaN(fid)) {
    return res.status(401).json({ success: false, error: 'Not authenticated - FID required' });
  }
  if (!isAdminFid(fid)) {
    return res.status(403).json({ success: false, error: `FID ${fid} is not authorized as admin` });
  }

  const truthy = (v: unknown) => v === true || v === 'true' || v === '1';
  const force = truthy(req.query.force) || truthy(req.body?.force);
  const skipCast = truthy(req.query.skipCast) || truthy(req.body?.skipCast);
  const skipNotification = truthy(req.query.skipNotification) || truthy(req.body?.skipNotification);

  try {
    // Resolve target round: explicit roundId, else the latest active round
    const roundIdParam = req.body?.roundId ?? req.query.roundId;
    let round;
    if (roundIdParam !== undefined && roundIdParam !== '') {
      const id = parseInt(String(roundIdParam), 10);
      if (isNaN(id)) {
        return res.status(400).json({ success: false, error: 'roundId must be a number' });
      }
      [round] = await db.select().from(rounds).where(eq(rounds.id, id)).limit(1);
    } else {
      [round] = await db
        .select()
        .from(rounds)
        .where(and(isNull(rounds.resolvedAt), eq(rounds.status, 'active')))
        .orderBy(desc(rounds.startedAt))
        .limit(1);
    }

    if (!round) {
      return res.status(404).json({ success: false, error: 'Round not found' });
    }

    // Existing announcer event (the idempotency record written at round creation)
    const [existing] = await db
      .select()
      .from(announcerEvents)
      .where(
        and(
          eq(announcerEvents.eventType, 'round_started'),
          eq(announcerEvents.roundId, round.id),
          eq(announcerEvents.milestoneKey, 'default')
        )
      )
      .limit(1);

    // Guard against an accidental double-cast
    if (existing?.castHash && !skipCast && !force) {
      return res.status(409).json({
        success: false,
        error:
          `Round ${round.id} cast was already posted (${existing.castHash}). ` +
          `Pass force=true to re-post it, or skipCast=true to send only the notification.`,
        castHash: existing.castHash,
      });
    }

    const { roundNumber, jackpotEth, text } = await buildRoundStartedAnnouncement(round);

    // Push notification (no idempotency — calling this twice double-sends it)
    let notification = null;
    if (!skipNotification) {
      notification = await notifyRoundStarted(roundNumber, jackpotEth);
    }

    // Farcaster cast
    let cast: { hash: string } | null = null;
    if (!skipCast) {
      cast = await castFromAnnouncer(text, { embeds: GAME_EMBED });

      // Keep the announcer_events record in sync so future round-start logic
      // stays idempotent and /verify-style tooling sees the cast hash.
      if (existing) {
        await db
          .update(announcerEvents)
          .set({
            castHash: cast?.hash ?? existing.castHash,
            postedAt: cast?.hash ? new Date() : existing.postedAt,
            payload: { text },
          })
          .where(eq(announcerEvents.id, existing.id));
      } else {
        await db.insert(announcerEvents).values({
          eventType: 'round_started',
          roundId: round.id,
          milestoneKey: 'default',
          payload: { text },
          castHash: cast?.hash ?? null,
          postedAt: cast?.hash ? new Date() : null,
        });
      }
    }

    const castSent = skipCast ? null : !!cast?.hash;
    const notificationSent = skipNotification ? null : !!notification?.success;

    const castSummary = skipCast
      ? 'cast skipped'
      : castSent
        ? `cast posted (${cast!.hash})`
        : 'cast FAILED — announcer disabled or Neynar error, check server logs';
    const notifSummary = skipNotification
      ? 'notification skipped'
      : notificationSent
        ? `notification sent to ${notification!.recipientCount ?? '?'} users`
        : `notification FAILED — ${notification?.error ?? 'check server logs'}`;

    // 200 only when every channel that was attempted actually succeeded
    const allOk =
      (skipCast || castSent === true) && (skipNotification || notificationSent === true);

    return res.status(allOk ? 200 : 502).json({
      success: allOk,
      roundId: round.id,
      roundNumber,
      jackpotEth,
      castHash: skipCast ? null : (cast?.hash ?? null),
      castSent,
      notification: skipNotification ? null : notification,
      notificationSent,
      message: `Round ${roundNumber}: ${castSummary}; ${notifSummary}.`,
    });
  } catch (error) {
    console.error('[reannounce-round] Error:', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
