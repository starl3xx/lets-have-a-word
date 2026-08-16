# Post-Mortem: Round 13 Zombie State & 504 Storm

**Date**: 2026-02-06
**Severity**: Critical (wrong winner recorded, 11 players blocked, game down ~18 hours)
**Status**: Recovered via admin endpoint. Winner correction needed.

---

## Summary

Round 13 of Let's Have A Word entered a "zombie state" where the database recorded a winner but no onchain resolution or payouts occurred. This caused the game to become completely unplayable for ~18 hours. During that window, **11 players independently discovered the correct answer (NOTRE)** and submitted it a combined **121 times**, with **100 of those requests returning 504 Gateway Timeout errors**.

Vercel server logs show that **coolhat (FID 1017205) was the first player to submit NOTRE**, doing so at 23:24 UTC on Feb 5 — approximately 3.5 hours after the zombie was created. The DB-recorded "winner" rehankhn01 (FID 979652) was actually the **9th** person to submit NOTRE in the Vercel logs.

---

## Timeline (all times UTC)

| Time | Event |
|------|-------|
| Feb 5 19:51:49 | rehankhn01 (FID 979652) submits **NOTRE**. Phase 1 commits to DB (winnerFid set). Phase 2 fails silently. **Zombie round created.** This request is outside Vercel log retention. |
| Feb 5 23:24:26 | **coolhat** (FID 1017205) submits NOTRE — first NOTRE in Vercel logs. Gets **504** (Vercel timeout). |
| Feb 5 23:24–00:41 | coolhat retries 17 times over ~1.5 hours. All 504 except 2 "Duplicate guess ignored." |
| Feb 6 12:02 | **faroff** (FID 738714) discovers NOTRE. Begins 504 storm with 29 attempts over ~2 hours. |
| Feb 6 12:33 | **sekoweed.eth** (FID 13182) joins — 10 attempts, all 504. |
| Feb 6 12:34 | **jorja** (FID 817332) joins — 20 attempts, all 504. |
| Feb 6 12:35 | **tamey** (FID 827722) joins — 5 attempts. |
| Feb 6 12:37 | **peyson.eth** (FID 269515) joins — 9 attempts. |
| Feb 6 12:49 | **rilas00** (FID 203482) — 1 attempt, 504. |
| Feb 6 13:18 | **rend** (FID 243134) joins — 21 attempts. |
| Feb 6 13:34 | **rehankhn01** (FID 979652) comes back — also getting 504s now. 7 attempts. |
| Feb 6 13:41 | **daxexp29** (FID 978244) — 1 attempt. |
| Feb 6 13:47 | 504 storm clears — requests start returning 200. |
| Feb 6 13:48 | **jmk** (FID 205881) — 1 attempt, 200. |
| Feb 6 18:18 | Admin runs `recover-stuck-round` to process onchain payouts. |

---

## The 504 Storm: Full Impact

**121 total NOTRE submissions. 100 returned 504. 11 unique players.**

| # | Player | FID | First NOTRE (UTC) | Attempts | 504s |
|---|--------|-----|-------------------|----------|------|
| 1 | **coolhat** | 1017205 | Feb 5 23:24 | 17 | 14 |
| 2 | **faroff** | 738714 | Feb 6 12:02 | 29 | 28 |
| 3 | **sekoweed.eth** | 13182 | Feb 6 12:33 | 10 | 9 |
| 4 | **jorja** | 817332 | Feb 6 12:34 | 20 | 18 |
| 5 | **tamey** | 827722 | Feb 6 12:35 | 5 | 4 |
| 6 | **peyson.eth** | 269515 | Feb 6 12:37 | 9 | 7 |
| 7 | **rilas00** | 203482 | Feb 6 12:49 | 1 | 1 |
| 8 | **rend** | 243134 | Feb 6 13:18 | 21 | 15 |
| 9 | **rehankhn01** | 979652 | Feb 6 13:34 | 7 | 4 |
| 10 | **daxexp29** | 978244 | Feb 6 13:41 | 1 | 0 |
| 11 | **jmk** | 205881 | Feb 6 13:48 | 1 | 0 |

**coolhat should be recognized as the Round 13 winner.** They were the first player to submit NOTRE to the server, doing so 3.5 hours after the zombie was created and ~12.5 hours before the next player (faroff). Every one of coolhat's 17 attempts was blocked by the zombie state — not by any fault of their own.

---

## Root Causes

### Root Cause 1: Silent Phase 2 Failure (Zombie State)

The two-phase resolution in `src/lib/guesses.ts` has a critical gap:

```
Phase 1 (DB transaction):
  - Lock round row with FOR UPDATE
  - Insert winning guess
  - Set winnerFid on rounds table
  - COMMIT

Phase 2 (outside transaction):
  - Call resolveRoundAndCreatePayouts()
  - This does: onchain resolution + payout creation + mark resolvedAt
  - If this fails: catch block logs error, does NOT re-throw
```

When Phase 2 fails, the round has `winnerFid` set but `resolvedAt` is null and no payouts exist. The `getActiveRound()` function filters on `isNull(winnerFid)`, so the round becomes invisible to all existing tooling.

### Root Cause 2: Zombie State Causes Total Game Outage

After the zombie was created, ALL guess requests (not just NOTRE) followed this path:

1. `getActiveRound()` returns null (zombie has `winnerFid` set)
2. `ensureActiveRound()` tries to create a new round
3. New round creation calls the smart contract to commit a new answer
4. Contract rejects because the previous round was never resolved onchain
5. Serverless function hangs until Vercel's 300-second timeout → **504**

This made the game **completely unplayable for ~18 hours**.

### Root Cause 3: No Client-Side Timeout/Retry

The `fetch('/api/guess', ...)` call in `pages/index.tsx` had no timeout and no retry logic. Players saw "SUBMITTING..." indefinitely with no feedback. Many players (especially coolhat with 17 attempts, faroff with 29, rend with 21) kept manually retrying for hours.

---

## Impact

| Impact | Details |
|--------|---------|
| **Wrong winner recorded** | rehankhn01 was the DB-recorded winner, but coolhat submitted NOTRE to the server first (Vercel logs). |
| **11 players blocked** | 11 players found the correct answer but were blocked by 504 errors from the zombie state. |
| **121 failed requests** | 100 out of 121 NOTRE submissions returned 504. Players wasted hours retrying. |
| **~18 hour outage** | Game was completely unplayable from ~19:51 UTC Feb 5 to ~13:47 UTC Feb 6. |
| **Prize payout delayed** | No onchain resolution or payouts until admin recovery at 18:18 UTC Feb 6. |
| **Player trust** | Multiple dedicated players (coolhat, faroff, rend) spent hours hitting a wall with no explanation. |

---

## Resolution

### Immediate Recovery

1. **Built `recover-stuck-round` endpoint** (`pages/api/admin/operational/recover-stuck-round.ts`)
   - Queries round directly by ID, bypassing `getActiveRound()` filter
   - GET mode: diagnoses round state (DB + contract) and identifies if it's stuck
   - POST mode: completes Phase 2 (onchain resolution + payouts)
   - Auto-enables dead day mode after recovery to prevent auto-starting the next round

2. **Added admin UI** in the Operations tab of the admin dashboard

3. **Executed recovery** at 18:18 UTC Feb 6 to resolve the round onchain

### Preventive Fixes

4. **Added `fetchWithRetry` to client-side guess submission** (`pages/index.tsx`)
   - 12-second timeout per attempt using `AbortController`
   - Automatic retry on timeout or network failure (1 retry)
   - Clear error message ("Request timed out -- please try again") instead of hanging on "SUBMITTING..."

5. **Added Sentry `fatal` alert on Phase 2 failure** (`src/lib/guesses.ts`)
   - Immediate alert when payout processing fails after DB winner lock

6. **Added zombie round detection to cron health check** (`pages/api/cron/health-check.ts`)
   - Runs every 30 minutes, checks for `winnerFid IS NOT NULL AND resolvedAt IS NULL`
   - Reports to Sentry as fatal if found

### Winner Correction

7. **coolhat (FID 1017205) should be recognized as the Round 13 winner.** They submitted NOTRE to the server first according to Vercel logs, 3.5 hours after the zombie was created. Their guess was blocked solely by the zombie state bug.

---

## What Went Well

- The two-phase design correctly prevented partial DB corruption (Phase 1 transaction was atomic)
- Vercel log retention preserved enough data to establish the true submission order
- The community was persistent — multiple players kept trying despite repeated failures
- Recovery tooling was built and deployed within hours of diagnosis

---

## What Went Wrong

- **Silent failure in Phase 2**: The catch block logs the error but swallows it. No alert, no Sentry report, no admin notification.
- **Zombie causes total outage**: The zombie state didn't just block resolution — it broke ALL guess requests by hanging `ensureActiveRound()` on an impossible contract call.
- **Invisible zombie state**: `getActiveRound()` filtering on `isNull(winnerFid)` means zombie rounds are invisible to all existing queries and admin tools.
- **No client-side timeout**: The fetch call would hang indefinitely, giving players no feedback. They had to manually retry.
- **No monitoring**: No cron job or health check detected the zombie for ~18 hours. The outage was only noticed when players reported it.
- **Wrong winner recorded**: The Phase 1 DB commit happened before the 504 storm, recording rehankhn01 as the winner when other players (coolhat first, then 10 others) submitted the same answer and were blocked by the bug.

---

## Action Items

| Priority | Action | Status |
|----------|--------|--------|
| P0 | Build and deploy `recover-stuck-round` admin endpoint | Done |
| P0 | Add client-side fetch timeout + retry (12s, 1 retry) | Done |
| P0 | Recognize coolhat as the Round 13 winner | Decision needed |
| P1 | Add Sentry alert when Phase 2 fails (the silent catch block) | Done |
| P1 | Add cron health check that detects zombie rounds | Done |
| P2 | Consider making Phase 2 retriable with a queue/job system instead of inline execution | TODO |
| P2 | Add server-side request logging to trace guess submissions that reach the API but fail before DB insert | TODO |
| P3 | Evaluate recognition/compensation for all 11 players who found NOTRE | Decision needed |

---

## Lessons Learned

1. **Never silently swallow errors in critical paths.** The Phase 2 catch block should have triggered an immediate alert. A logged warning that nobody reads is the same as no warning.

2. **A "locked" state that prevents recovery is worse than a crash.** The zombie state didn't just fail gracefully — it made the entire game unplayable by hanging every subsequent request on an impossible contract call. Failure modes should fail fast, not hang.

3. **Client-side fetch calls to critical endpoints need explicit timeouts.** Browser default timeouts (60-120s) are far too long for a game submission. The lack of timeout turned a server bug into a UX nightmare where players saw "SUBMITTING..." for minutes with no feedback.

4. **The first correct answer matters, not the first recorded one.** When a server-side bug prevents guesses from being recorded, the server logs (not the database) are the source of truth for who submitted first. coolhat's 17 attempts prove they found NOTRE before anyone else in the logs.

5. **Admin tooling must handle edge cases, not just happy paths.** Every existing admin tool used `getActiveRound()` which filters out the exact failure mode that occurred.
