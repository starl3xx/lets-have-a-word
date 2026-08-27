/**
 * Detects a client runtime older than the deployed server, and reloads it.
 *
 * WHY. Base App's webview resumes pages from memory. On 2026-08-27 a player's
 * device was still executing the previous day's bundle a full deploy later:
 * they re-tested a fixed bug, hit the old code, and reported the fix dead.
 * Cache headers cannot reach a page that never reloads — the only cure is the
 * running page noticing it is stale and reloading itself.
 *
 * HOW. next.config.ts inlines the git sha the client was built from
 * (NEXT_PUBLIC_BUILD_SHA); every /api/round-state response — the 204 included,
 * which is why it is a header and not a body field — carries the sha the
 * server is running. The round-state poll already happens every 15s, so
 * comparison is free. On mismatch the page reloads at a moment the player
 * will not feel:
 *
 *  - within 30s of arriving (page load or resume from background) — the
 *    resumed-stale-page case, and the freshest possible moment to swap;
 *  - otherwise when the tab next goes to the background — the mid-session
 *    deploy case, where yanking a visible game would be worse than staleness;
 *  - or immediately when a caller reports the player is already stuck on
 *    stale code (reloadIfStale).
 *
 * Automatic reloads defer while anything holds them (holdReloads): a pack or
 * Superguess purchase between onchain payment and server crediting, a share
 * flow between composeCast and its callback, or letters sitting in the guess
 * boxes. The staleness flag survives the hold, so the reload happens at the
 * next opportunity instead. reloadIfStale ignores holds on purpose — its one
 * caller has just watched a request fail on stale code, so there is nothing
 * left to protect.
 *
 * LOOP PROTECTION, precisely. One reload attempt per server sha is recorded
 * in sessionStorage — but a committed reload destroys this JS heap, so if the
 * guard is set AND this same heap remembers issuing it (issuedReloadFor), the
 * navigation provably never committed (Base App can freeze the page between
 * the two) and retrying is safe. A genuine reload that still served stale
 * HTML arrives in a fresh heap where issuedReloadFor is null, and the
 * sessionStorage guard stops it there.
 */

import { useEffect } from 'react';

const RELOADED_FOR_KEY = 'lhaw.reloadedForBuild';

/** How long after page load / resume a mismatch may still reload immediately. */
const JUST_ARRIVED_MS = 30_000;

let staleServerSha: string | null = null;
let listenerInstalled = false;
let lastBecameVisibleAt = typeof window === 'undefined' ? 0 : Date.now();
/** The sha THIS heap has issued a reload for. See "loop protection" above. */
let issuedReloadFor: string | null = null;
/** Active holds; automatic reloads wait while > 0. */
let reloadHolds = 0;

function clientSha(): string | undefined {
  const sha = process.env.NEXT_PUBLIC_BUILD_SHA;
  return sha && sha !== 'dev' ? sha : undefined;
}

function isHeld(): boolean {
  return reloadHolds > 0;
}

/**
 * Issue a reload for `serverSha` unless a FOREIGN attempt already covers it.
 * Returns whether a reload was issued.
 */
function reloadOnceFor(serverSha: string): boolean {
  let guardSet: boolean;
  try {
    guardSet = window.sessionStorage.getItem(RELOADED_FOR_KEY) === serverSha;
  } catch {
    // Storage unavailable — cannot remember the attempt, so do not reload at
    // all rather than risk a loop.
    return false;
  }

  if (guardSet && issuedReloadFor !== serverSha) {
    // A previous page life already reloaded for this sha and the server still
    // says we are stale: reloading again would loop. Stop.
    return false;
  }

  if (!guardSet) {
    try {
      window.sessionStorage.setItem(RELOADED_FOR_KEY, serverSha);
    } catch {
      return false;
    }
  }

  // Recorded before navigating; if the webview freezes us right here, the
  // heap survives, issuedReloadFor === serverSha, and the next opportunity
  // retries instead of finding its one attempt burned.
  issuedReloadFor = serverSha;
  window.location.reload();
  return true;
}

function installListener(): void {
  if (listenerInstalled) return;
  listenerInstalled = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      lastBecameVisibleAt = Date.now();
    } else if (staleServerSha && !isHeld()) {
      // Backgrounded while stale: reload out of sight.
      reloadOnceFor(staleServerSha);
    }
  });
}

/**
 * Feed the server's build sha from a round-state response (the
 * `x-lhaw-server-build` header). Cheap and idempotent; safe on every poll.
 */
export function noteServerBuildSha(serverSha: string | undefined | null): void {
  if (typeof window === 'undefined') return;
  installListener();

  const mine = clientSha();
  if (!mine || !serverSha || serverSha === 'dev') return;

  if (serverSha === mine) {
    staleServerSha = null;
    return;
  }

  staleServerSha = serverSha;

  const justArrived = Date.now() - lastBecameVisibleAt < JUST_ARRIVED_MS;
  if ((justArrived || document.visibilityState === 'hidden') && !isHeld()) {
    reloadOnceFor(serverSha);
  }
}

/** Is the running client known to be older than the server? */
export function isRuntimeStale(): boolean {
  return staleServerSha != null;
}

/**
 * The player is already stuck on stale code (e.g. a session-expired 401 that
 * the current build cannot produce). Ignores holds — the failed request is
 * the proof that nothing worth protecting can proceed — and reloads now.
 */
export function reloadIfStale(): boolean {
  if (typeof window === 'undefined' || !staleServerSha) return false;
  return reloadOnceFor(staleServerSha);
}

/**
 * Suspend automatic reloads while a critical client-driven flow is in flight.
 * Returns a release function; releasing twice is safe. The canonical user is
 * a purchase between the onchain payment and the crediting POST — a reload in
 * that window loses real money's worth of credits, because nothing persists
 * the txHash for recovery.
 */
export function holdReloads(): () => void {
  reloadHolds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    reloadHolds--;
  };
}

/**
 * Declarative hold for React call sites: holds automatic reloads while
 * `active` is true. One line in a component beats hand-managed acquire and
 * release around every state transition of a purchase flow.
 */
export function useReloadHold(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    return holdReloads();
  }, [active]);
}
