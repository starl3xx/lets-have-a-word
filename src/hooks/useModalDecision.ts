/**
 * Modal Decision Hook
 * Milestone 6.3
 *
 * Implements the daily guess flow modal decision logic based on the spec.
 * Determines which modal to show (if any) after a guess is resolved.
 *
 * Decision Tree:
 * 1. If guesses remain → only show share modal once per session if unused
 * 2. If out of guesses → show share modal first (if unused and not seen)
 * 3. If share exhausted or declined → show pack modal (if packs available)
 * 4. Otherwise → show out-of-guesses state
 */

import { useState, useCallback } from 'react';

export type ModalDecision =
  | 'none'           // No modal needed
  | 'share'          // Show share-for-free-guess modal
  | 'pack'           // Show guess pack purchase modal
  | 'out_of_guesses'; // Show out of guesses state

export interface ModalDecisionState {
  hasSeenShareModalThisSession: boolean;
  hasSeenPackModalThisSession: boolean;
}

export interface ModalDecisionParams {
  guessesRemaining: number;
  hasUsedShareBonusToday: boolean;
  packsPurchasedToday: number;
  maxPacksPerDay: number;
}

export interface UseModalDecisionReturn {
  /**
   * Current session state for modal tracking
   */
  sessionState: ModalDecisionState;

  /**
   * Decide which modal to show after a guess is resolved
   * @param params - Current state parameters
   * @returns The modal to show
   */
  decideModal: (params: ModalDecisionParams) => ModalDecision;

  /**
   * Mark that the share modal has been seen this session
   * Call this when share modal is closed (regardless of whether user shared)
   */
  markShareModalSeen: () => void;

  /**
   * Mark that the pack modal has been seen this session
   * Call this when pack modal is closed (regardless of whether user purchased)
   */
  markPackModalSeen: () => void;

  /**
   * Reset session state (e.g., on new day or round)
   */
  resetSessionState: () => void;
}

/**
 * Hook for managing modal decision logic in the daily guess flow
 */
export function useModalDecision(): UseModalDecisionReturn {
  const [sessionState, setSessionState] = useState<ModalDecisionState>({
    hasSeenShareModalThisSession: false,
    hasSeenPackModalThisSession: false,
  });

  /**
   * Core decision logic based on the daily guess flow spec
   */
  const decideModal = useCallback((params: ModalDecisionParams): ModalDecision => {
    const {
      guessesRemaining,
      hasUsedShareBonusToday,
      packsPurchasedToday,
      maxPacksPerDay,
    } = params;

    const { hasSeenShareModalThisSession, hasSeenPackModalThisSession } = sessionState;

    // 1. Still have guesses → no paywall, maybe show share once
    if (guessesRemaining > 0) {
      // Show share modal once per session if share bonus unused
      if (!hasUsedShareBonusToday && !hasSeenShareModalThisSession) {
        return 'share';
      }
      // User has guesses, no need for modals
      return 'none';
    }

    // 2. Out of guesses: prioritize free share
    if (!hasUsedShareBonusToday && !hasSeenShareModalThisSession) {
      return 'share';
    }

    // 3. Share exhausted or declined: offer packs if available
    if (packsPurchasedToday < maxPacksPerDay && !hasSeenPackModalThisSession) {
      return 'pack';
    }

    // 4. Hard stop - no more options
    return 'out_of_guesses';
  }, [sessionState]);

  /**
   * Mark share modal as seen this session
   */
  const markShareModalSeen = useCallback(() => {
    setSessionState(prev => ({
      ...prev,
      hasSeenShareModalThisSession: true,
    }));
  }, []);

  /**
   * Mark pack modal as seen this session
   */
  const markPackModalSeen = useCallback(() => {
    setSessionState(prev => ({
      ...prev,
      hasSeenPackModalThisSession: true,
    }));
  }, []);

  /**
   * Reset session state
   */
  const resetSessionState = useCallback(() => {
    setSessionState({
      hasSeenShareModalThisSession: false,
      hasSeenPackModalThisSession: false,
    });
  }, []);

  return {
    sessionState,
    decideModal,
    markShareModalSeen,
    markPackModalSeen,
    resetSessionState,
  };
}

export default useModalDecision;
