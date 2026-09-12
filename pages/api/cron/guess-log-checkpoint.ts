import type { NextApiRequest, NextApiResponse } from 'next';
import * as Sentry from '@sentry/nextjs';
import { getActiveRound } from '../../../src/lib/rounds';
import { postNextCheckpoint, isGuessLogConfigured } from '../../../src/lib/guess-log-contract';
import type { PostResult } from '../../../src/lib/guess-log-contract';
import {
  findResolvedRoundsWithUncommittedGuesses,
  getFirstLoggedRound,
  GuessLogGapError,
  type UncommittedRound,
} from '../../../src/lib/guess-log';

/**
 * A single string to grep for, in the Vercel log and in the JSON body alike.
 *
 * The failure this names is the one that hid for 26 days: the checkpointer
 * stops advancing, every response is still HTTP 200, and the schedule looks
 * healthy right up until a round resolves with 99% of its guesses uncommitted.
 *
 * Reserved for the round this tick was supposed to advance — the live one, or
 * one an operator named. A round that is merely in the backlog gets
 * GUESS_LOG_BACKLOG_ALERT instead, because the two need different reactions.
 */
const GUESS_LOG_ALERT = 'GUESS_LOG_NOT_ADVANCING';

/**
 * The backlog's own, quieter alert.
 *
 * A backlog round is already resolved and already broken; nothing is getting
 * worse while it waits, and the repair is a human reconciling an index
 * sequence, not an on-call response. Round 34 has been refused since its 19th
 * leaf and will be refused on every one of the 288 ticks a day until someone
 * fixes it — reporting that at the same severity as a live stall would bury the
 * live stall, which is the exact failure mode this whole workstream exists to
 * end.
 */
const GUESS_LOG_BACKLOG_ALERT = 'GUESS_LOG_BACKLOG_BLOCKED';

/**
 * Backlog refusals already sent to Sentry by THIS instance.
 *
 * Best-effort de-duplication, and deliberately not more than that: a warehouse
 * for cron state would be a table nobody maintains. Vercel reuses a warm
 * instance across many ticks, so this turns "one Sentry event every 5 minutes
 * forever" into roughly one per instance per distinct refusal, which is the
 * shape a human can read. The authoritative surface is the response body, which
 * lists every blocked round on every tick.
 */
const backlogRefusalsReported = new Set<string>();

interface BacklogRefusal {
  roundId: number;
  reason: string;
  /**
   * The refusal's SHAPE, for de-duplication.
   *
   * `reason` is prose, and an ethers/RPC message routinely embeds a varying
   * request payload, so a key built from it never repeats and the class the
   * dedupe most needs to suppress floods instead. Absent when the refusal was
   * thrown rather than returned; `gap` classifies those.
   */
  reasonCode?: PostResult['reasonCode'];
  /** A duplicate or a hole in the index sequence, as opposed to an RPC problem. */
  gap: boolean;
}

/**
 * Try the backlog, newest short round first, and stop at the first one that
 * actually commits.
 *
 * Iterates rather than parking on the first candidate. A round can be short and
 * still refuse — a duplicate or a hole above the committed mark makes
 * `collectPendingGuesses` throw — and stopping there means an older round with a
 * genuinely orphaned tail is never reached, which is how round 34 would have
 * shadowed everything behind it.
 */
async function sweepBacklog(
  alreadyHandledRoundId: number | null
): Promise<{ recovered: UncommittedRound | null; result: PostResult | null; blocked: BacklogRefusal[] }> {
  const candidates = await findResolvedRoundsWithUncommittedGuesses();
  const blocked: BacklogRefusal[] = [];

  for (const candidate of candidates) {
    if (candidate.roundId === alreadyHandledRoundId) continue;

    try {
      const result = await postNextCheckpoint(candidate.roundId);
      if (result.posted) return { recovered: candidate, result, blocked };
      blocked.push({
        roundId: candidate.roundId,
        reason: result.reason ?? result.reasonCode ?? 'refused',
        reasonCode: result.reasonCode,
        gap: false,
      });
    } catch (error) {
      blocked.push({
        roundId: candidate.roundId,
        reason: error instanceof Error ? error.message : 'Unknown error',
        gap: error instanceof GuessLogGapError,
      });
    }
  }

  return { recovered: null, result: null, blocked };
}

function reportBacklogRefusals(blocked: BacklogRefusal[]): void {
  for (const refusal of blocked) {
    console.warn(
      `[guess-log] ${GUESS_LOG_BACKLOG_ALERT} — round ${refusal.roundId}: ${refusal.reason}`
    );

    // Keyed on the shape, never on the message: see BacklogRefusal.reasonCode.
    const key = `${refusal.roundId}:${refusal.gap ? 'gap' : refusal.reasonCode ?? 'error'}`;
    if (backlogRefusalsReported.has(key)) continue;
    backlogRefusalsReported.add(key);

    Sentry.captureMessage(`GuessLog backlog round ${refusal.roundId} cannot be caught up`, {
      level: 'warning',
      tags: {
        component: 'guess-log',
        operation: 'backlog-sweep',
        guessLogBacklogBlocked: 'true',
        ...(refusal.gap ? { guessLogGap: 'true' } : {}),
      },
      extra: { roundId: refusal.roundId, reason: refusal.reason },
    });
  }
}

/**
 * A live-round failure, reported the one way.
 *
 * Two paths reach it now that the live post has its own try: the post itself,
 * and the outer catch that still covers the round lookup and the
 * nothing-to-do diagnosis. One function so the alert string, the Sentry tags
 * and the response shape cannot drift apart between them.
 *
 * 200 with ok:false — a failed checkpoint must not mark the cron job as broken
 * and stop the schedule; the next tick retries the same range. The `alert` is
 * what makes that survivable: the schedule keeps running AND the failure is
 * legible, rather than the schedule keeping running and the failure reading as
 * success.
 */
function respondLiveFailure(
  res: NextApiResponse,
  error: unknown,
  roundId: number | null,
  extra: Record<string, unknown>
) {
  const message = error instanceof Error ? error.message : 'Unknown error';
  // A gap is not a transient failure — the log is structurally broken and the
  // next tick will refuse in exactly the same way. Tagged apart from an RPC
  // blip so one Sentry search separates "look at this now" from "Base was
  // having a moment".
  const isGap = error instanceof GuessLogGapError;

  console.error(
    `[guess-log] 🚨 ${GUESS_LOG_ALERT} — round ${roundId ?? 'none'} checkpoint failed:`,
    error
  );
  Sentry.captureException(error, {
    tags: {
      component: 'guess-log',
      operation: 'checkpoint',
      guessLogStalled: 'true',
      ...(isGap ? { guessLogGap: 'true' } : {}),
    },
    extra: { roundId },
  });

  return res.status(200).json({
    ok: false,
    alert: GUESS_LOG_ALERT,
    attention: isGap
      ? 'The guess index sequence has a duplicate or a hole, so the log cannot be ' +
        'committed past it. Check /api/admin/operational/round-health for the round.'
      : 'The onchain guess log did not advance on this tick.',
    roundId,
    ...extra,
    gap: isGap,
    error: message,
  });
}

/**
 * POST /api/cron/guess-log-checkpoint
 *
 * Commits a Merkle root over the guesses made since the last checkpoint, so
 * the ordering that decides the winner and the top-10 becomes immutable while
 * the round is still running rather than only being asserted afterwards.
 *
 * Runs on an interval rather than per guess: one transaction every few minutes
 * costs almost nothing on Base and needs no wallet interaction from players,
 * whereas committing per guess would put a signature prompt in front of every
 * word typed. The tradeoff is a window — guesses made since the last checkpoint
 * are not yet committed — which is why the interval wants to be short.
 *
 * THIS IS THE ONLY THING THAT COMMITS A ROUND'S TAIL. The resolve path used to
 * post a final checkpoint itself; that call was removed (see "NO GUESS-LOG
 * CHECKPOINT ON THE RESOLVE PATH" in economics.ts) because it was an unguarded
 * mainnet write sitting inside the winning player's request. So every tick also
 * sweeps resolved rounds whose committed leaf count is short of the highest
 * index they handed out, and commits the newest one that can advance. Not only
 * on idle ticks: a new round usually starts within five minutes of the old one
 * resolving and is at its busiest right then, so "sweep only when the live
 * round has nothing pending" would leave the previous round's tail — the
 * winning guess among it — waiting on the weather. Two operator transactions in
 * one invocation is the worst case, sent sequentially, inside a 120s budget.
 *
 * THE TWO PHASES HAVE SEPARATE ERROR PATHS, and that is the whole point of the
 * ordering: a gap on the live round, or an hour of flaky Base RPC, must not
 * skip the sweep. They used to share one try, so a throw from the live post
 * starved the backlog on every tick for as long as the live round was
 * unhealthy — exactly when a resolved round's orphaned tail most needs
 * committing.
 *
 * A refusal is REPORTED, not swallowed. The response still carries HTTP 200 —
 * Vercel disables a schedule that keeps erroring, and stopping the schedule is
 * the worst outcome available — but it carries ok:false, an `alert`, and a
 * Sentry event tagged `guessLogStalled`, because a cron that reports success
 * while committing nothing is how the log silently stopped covering round 34.
 * A backlog round that refuses is reported separately and more quietly; see
 * GUESS_LOG_BACKLOG_ALERT.
 *
 * Security: same CRON_SECRET bearer check as the other cron endpoints.
 *
 * Schedule (vercel.json): every 5 minutes.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production') {
    if (!cronSecret) {
      console.error('[guess-log] CRON_SECRET not configured');
      return res.status(500).json({ error: 'Cron not configured' });
    }
    if (authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  if (!isGuessLogConfigured()) {
    return res.status(200).json({
      ok: true,
      skipped: 'GuessLog not configured — set GUESS_LOG_ADDRESS to enable',
    });
  }

  // Declared out here so the catch block can name the round it was working on;
  // a stack trace with no round number is most of the way to useless.
  let roundId: number | null = null;
  let recovering: UncommittedRound | null = null;
  let explicitlyRequested = false;

  try {
    // An explicit roundId lets the operator close out a round that resolved
    // between ticks; otherwise follow the active round.
    if (req.query.roundId !== undefined) {
      const explicit = parseInt(String(req.query.roundId), 10);
      // Validated rather than passed through: an unparseable value used to
      // reach the contract as NaN, which reverts in a way that reads like a
      // chain problem rather than a typo.
      if (!Number.isInteger(explicit) || explicit <= 0) {
        return res.status(400).json({ error: 'roundId must be a positive integer' });
      }
      roundId = explicit;
      explicitlyRequested = true;
    }

    if (roundId === null) {
      const active = await getActiveRound();
      roundId = active?.id ?? null;
    }

    // Live work first, always — but held in its own try, so a failure here is
    // reported AFTER the sweep has had its turn rather than instead of it.
    const liveRoundId = roundId;
    let liveResult: PostResult | null = null;
    let liveError: unknown = null;
    if (liveRoundId !== null) {
      try {
        liveResult = await postNextCheckpoint(liveRoundId);
      } catch (error) {
        liveError = error;
      }
    }

    // Then the backlog, whatever the live round just did. Never when a round
    // was named explicitly: an operator closing out one round must not have the
    // answer come back about a different one.
    let blocked: BacklogRefusal[] = [];
    let recoveredResult: PostResult | null = null;
    let sweepError: string | null = null;
    if (!explicitlyRequested) {
      try {
        const sweep = await sweepBacklog(liveRoundId);
        blocked = sweep.blocked;
        if (sweep.recovered && sweep.result) {
          recovering = sweep.recovered;
          recoveredResult = sweep.result;
          // The rarer event is the headline. A tick that caught a resolved round
          // up is worth reading; a tick that committed six live guesses is not.
          roundId = sweep.recovered.roundId;
        }
        if (blocked.length > 0) reportBacklogRefusals(blocked);
      } catch (error) {
        // The sweep could not even enumerate its candidates — a DB failure, not
        // a stalled log. It gets the backlog's own quieter alert: raising
        // GUESS_LOG_NOT_ADVANCING here would report a live stall against a live
        // round that just advanced.
        sweepError = error instanceof Error ? error.message : 'Unknown error';
        console.error(`[guess-log] ${GUESS_LOG_BACKLOG_ALERT} — backlog sweep failed:`, error);
        Sentry.captureException(error, {
          level: 'warning',
          tags: {
            component: 'guess-log',
            operation: 'backlog-sweep',
            guessLogBacklogBlocked: 'true',
          },
        });
      }
    }

    const backlog =
      blocked.length > 0 || sweepError !== null
        ? {
            backlogAlert: GUESS_LOG_BACKLOG_ALERT,
            ...(blocked.length > 0 ? { backlogBlocked: blocked } : {}),
            ...(sweepError !== null ? { backlogError: sweepError } : {}),
          }
        : {};

    // Now the live round's own failure, carrying what the sweep managed to do.
    if (liveError !== null) {
      // Carry what the sweep achieved, txHash and all. A tick where the live
      // round failed but the backlog advanced is the tick an operator most
      // wants to read in full: it says the log is moving again even though this
      // round is not.
      return respondLiveFailure(res, liveError, liveRoundId, {
        ...(recovering
          ? { selfHealed: true, recovering, ...(recoveredResult ?? {}) }
          : {}),
        ...backlog,
      });
    }

    // Kept separately so a tick that committed for BOTH rounds reports both
    // rather than letting one spread overwrite the other.
    const live =
      liveResult && recoveredResult ? { live: { roundId: liveRoundId, ...liveResult } } : {};
    const result = recoveredResult ?? liveResult;

    if (result === null) {
      // Nothing live, nothing in the backlog. Say which of the two quiet states
      // this is: a log that has never committed anything looks identical to a
      // log with nothing to do, and reporting the first as the second is how a
      // dead checkpointer would read as success.
      const firstLoggedRound = await getFirstLoggedRound();
      let skipped: string;
      let logNeverCommitted = false;
      if (firstLoggedRound === null) {
        logNeverCommitted = true;
        skipped =
          'No active round, and the guess log has never committed a checkpoint — ' +
          'there is no logged round to sweep from yet';
      } else if (blocked.length > 0) {
        // Not "fully committed". The sweep found short rounds and every one of
        // them refused, which is the state the old message used to paper over.
        skipped =
          `No active round, and the ${blocked.length} short round(s) in the backlog all ` +
          'refused — see backlogBlocked';
      } else {
        skipped = 'No active round, and every logged round is fully committed';
      }

      return res.status(200).json({
        ok: true,
        ...(logNeverCommitted ? { logNeverCommitted } : {}),
        skipped,
        ...backlog,
      });
    }

    // The live round's own refusal is the loud one, even on a tick where the
    // backlog sweep succeeded behind it.
    if (liveResult?.reasonCode === 'index-mismatch') {
      // The local table and the contract disagree. Nothing will advance until
      // someone reconciles them, so this has to be visible in both places an
      // operator looks: the response body and Sentry.
      console.error(`[guess-log] 🚨 ${GUESS_LOG_ALERT} — round ${liveRoundId}: ${liveResult.reason}`);
      Sentry.captureMessage(`GuessLog checkpoint refused for round ${liveRoundId}`, {
        level: 'error',
        tags: { component: 'guess-log', operation: 'checkpoint', guessLogStalled: 'true' },
        extra: {
          roundId: liveRoundId,
          reason: liveResult.reason,
          onchainLeaves: liveResult.onchainLeaves,
          localLeaves: liveResult.localLeaves,
        },
      });
      return res.status(200).json({
        ok: false,
        alert: GUESS_LOG_ALERT,
        attention:
          'The onchain guess log has stopped advancing. Until this is reconciled, ' +
          'nothing new is being committed and /verify cannot prove the ordering.',
        roundId: liveRoundId,
        ...(recovering ? { selfHealed: true, recovering } : {}),
        ...backlog,
        ...liveResult,
      });
    }

    return res.status(200).json({
      ok: true,
      roundId,
      ...(recovering ? { selfHealed: true, recovering } : {}),
      ...backlog,
      ...live,
      ...result,
    });
  } catch (error) {
    // What is left for this to catch, now that the live post and the sweep each
    // have their own: the active-round lookup, and the getFirstLoggedRound
    // diagnosis on a nothing-to-do tick.
    return respondLiveFailure(res, error, roundId, recovering ? { recovering } : {});
  }
}
