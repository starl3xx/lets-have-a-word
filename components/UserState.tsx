import type { UserStateResponse } from '../pages/api/user-state';
import type { GuessSourceState } from '../src/types';
import GuessBar from './GuessBar';

interface UserStateProps {
  /**
   * The /api/user-state response, fetched ONCE by pages/index.tsx and passed
   * down. This component used to fetch it itself, which meant two independent
   * callers per load — and because /api/user-state creates the user row on
   * first sight and only index.tsx's call carries the `ref` referral param,
   * the duplicate could win the creation race and create the row without a
   * referrer — permanently, when no ref-carrying guess followed to backfill
   * it. Do not add a fetch back here.
   */
  userState: UserStateResponse | null;
  onGetMore?: () => void;
  onWordHintTap?: () => void;
}

/**
 * Initial fallback state for GuessBar
 * Shown on first load before data arrives
 * Uses neutral/minimal values (0 guesses, all sources empty)
 */
const INITIAL_FALLBACK_SOURCE_STATE: GuessSourceState = {
  totalRemaining: 0,
  free: {
    total: 1,
    used: 1,
    remaining: 0,
  },
  wordToken: {
    total: 0,
    used: 0,
    remaining: 0,
    isHolder: false,
  },
  share: {
    total: 0,
    used: 0,
    remaining: 0,
    hasSharedToday: false,
    canClaimBonus: true,
  },
  paid: {
    total: 0,
    used: 0,
    remaining: 0,
    packsPurchased: 0,
    maxPacksPerDay: 3,
    canBuyMore: true,
  },
};

/**
 * UserState Component
 * Milestone 4.1: Displays user's daily guess allocations and $WORD bonus status
 * Milestone 6.5: Uses unified GuessBar component for source-level display
 * Milestone 6.8: Never shows "Loading..." — falls back until data arrives
 * Consolidation 2026-08-30: purely presentational; the fetch lives in index.tsx.
 *
 * The old stale-while-revalidate module cache existed to survive remounts
 * driven by a key={} refetch trigger. The component no longer remounts (the
 * parent holds the data and simply re-renders it), so the prop itself is the
 * cache: it only ever changes when a newer response has landed.
 */
export default function UserState({ userState, onGetMore, onWordHintTap }: UserStateProps) {
  const displaySourceState = userState?.sourceState ?? INITIAL_FALLBACK_SOURCE_STATE;

  return (
    <GuessBar
      sourceState={displaySourceState}
      onGetMore={onGetMore}
      onWordHintTap={onWordHintTap}
      rewardGateLocked={userState?.rewardGate?.locked ?? false}
    />
  );
}
