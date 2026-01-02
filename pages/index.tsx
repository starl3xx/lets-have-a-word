import { useState, useEffect, useRef, useMemo, useLayoutEffect, ChangeEvent, KeyboardEvent, useTransition, type ReactNode } from 'react';
import Head from 'next/head';
import type { SubmitGuessResult, WheelWord, WheelResponse } from '../src/types';
import type { UserStateResponse } from './api/user-state';
import TopTicker from '../components/TopTicker';
import Wheel from '../components/Wheel';
import UserState from '../components/UserState';
import SharePromptModal from '../components/SharePromptModal';
import WinnerShareCard from '../components/WinnerShareCard';
import LetterBoxes from '../components/LetterBoxes';
import ResultBanner, { type ResultBannerVariant } from '../components/ResultBanner';
import FirstTimeOverlay from '../components/FirstTimeOverlay';
import OnboardingManager from '../components/OnboardingManager';
import StatsSheet from '../components/StatsSheet';
import ReferralSheet from '../components/ReferralSheet';
import FAQSheet from '../components/FAQSheet';
import GameKeyboard from '../components/GameKeyboard';
import RoundArchiveModal from '../components/RoundArchiveModal';
// Milestone 6.3: New components
import GuessPurchaseModal from '../components/GuessPurchaseModal';
// Milestone 9.5: Game paused banner
import GamePausedBanner, { parseOperationalError } from '../components/GamePausedBanner';
// AnotherGuessModal removed - when out of options, user just can't play anymore
// Dev mode fallback FID (used when Farcaster SDK doesn't provide a FID)
// Uses 6500 which is the dev mode FID defined in daily-limits.ts
const DEV_FALLBACK_FID = 6500;

/**
 * Check if dev mode is enabled on the client
 * Used to determine if we should use DEV_FALLBACK_FID
 */
function isClientDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  return process.env.NEXT_PUBLIC_LHAW_DEV_MODE === 'true';
}
import { triggerHaptic, haptics } from '../src/lib/haptics';
import { isValidGuess } from '../src/lib/word-lists';
import { getInputState, getErrorMessage, isGuessButtonEnabled, type InputState } from '../src/lib/input-state';
import { useInputStateHaptics } from '../src/lib/input-state-haptics';
import { useModalDecision } from '../src/hooks/useModalDecision';
import { useGuessInput } from '../src/hooks/useGuessInput';
import { markKeydown, markInputPainted } from '../src/lib/perf-debug';
import sdk from '@farcaster/miniapp-sdk';
import confetti from 'canvas-confetti';
import { WagmiProvider, useAccount } from 'wagmi';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { config } from '../src/config/wagmi';

// Create a client for React Query
const queryClient = new QueryClient();

/**
 * GameContent - Main game component
 *
 * IMPORTANT: This component uses wagmi and @farcaster/miniapp-sdk, which are
 * client-side only libraries. They are NOT compatible with server-side rendering.
 * The parent Home component wraps this with WagmiProvider to scope these dependencies
 * to the game page only, preventing them from affecting other pages like /admin/analytics.
 */
function GameContent() {
  // Word input state - now managed as array of 5 letters (Milestone 4.3)
  const [letters, setLetters] = useState<string[]>(['', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SubmitGuessResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Milestone 6.4.2: Deferred wheel update for instant input responsiveness
  // Wheel updates are marked as transitions (low priority) to prevent blocking input rendering
  const [wheelCurrentGuess, setWheelCurrentGuess] = useState<string>('');
  const [isPendingWheelUpdate, startWheelTransition] = useTransition();

  // Farcaster context
  const [fid, setFid] = useState<number | null>(null);
  const [isInMiniApp, setIsInMiniApp] = useState(false);
  const [hasCheckedContext, setHasCheckedContext] = useState(false);

  // Get connected wallet from Wagmi for CLANKTON bonus check
  const { address: connectedWalletAddress } = useAccount();

  // Effective FID: use real Farcaster FID, or dev fallback in dev mode
  // This ensures consistent FID usage across guess submission, user state fetch, and share callbacks
  const effectiveFid = useMemo(() => {
    if (fid) return fid;
    if (isClientDevMode()) return DEV_FALLBACK_FID;
    return null;
  }, [fid]);

  // Wheel state (Milestone 2.3, updated Milestone 4.10)
  const [wheelWords, setWheelWords] = useState<WheelWord[]>([]);
  const [isLoadingWheel, setIsLoadingWheel] = useState(true);
  const [wheelStartIndex, setWheelStartIndex] = useState<number | null>(null);

  // Milestone 6.7.1: Track wrong guess count to skip unnecessary updates
  const lastWrongGuessCountRef = useRef<number>(0);
  const WRONG_GUESS_POLL_INTERVAL_MS = 60000; // 60 seconds

  // User state refetch trigger (Milestone 4.1)
  const [userStateKey, setUserStateKey] = useState(0);

  // User guess count state (Milestone 4.6)
  const [hasGuessesLeft, setHasGuessesLeft] = useState(true);

  // Share modal state (Milestone 4.2)
  const [showShareModal, setShowShareModal] = useState(false);
  const [pendingShareResult, setPendingShareResult] = useState<SubmitGuessResult | null>(null);

  // Winner share card state (Milestone 4.14)
  const [showWinnerShareCard, setShowWinnerShareCard] = useState(false);
  const [winnerData, setWinnerData] = useState<{ word: string; roundId: number } | null>(null);

  // UX state (Milestone 4.3)
  const [isShaking, setIsShaking] = useState(false);
  const [showFirstTimeOverlay, setShowFirstTimeOverlay] = useState(false);
  const [showStatsSheet, setShowStatsSheet] = useState(false);
  const [showReferralSheet, setShowReferralSheet] = useState(false);
  const [showFAQSheet, setShowFAQSheet] = useState(false);
  const [showTutorial, setShowTutorial] = useState(false);
  const [boxResultState, setBoxResultState] = useState<'typing' | 'wrong' | 'correct'>('typing');
  const [hideStateError, setHideStateError] = useState(false);

  /**
   * Milestone 6.7.1: Incorrect banner state machine
   * - 'none': No incorrect banner visible
   * - 'active': Bright red error, input locked visually
   * - 'faded': Softer gray banner showing context, input ready again
   * - 'fading_out': Gray banner fading out to transparent
   */
  type IncorrectState = 'none' | 'active' | 'faded' | 'fading_out';
  const [incorrectState, setIncorrectState] = useState<IncorrectState>('none');
  const [lastSubmittedGuess, setLastSubmittedGuess] = useState<string | null>(null);
  const incorrectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadedDismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Milestone 6.7.1: Duration for incorrect state transitions
  const INCORRECT_ACTIVE_DURATION_MS = 1500; // Red state: 1.5s
  const INCORRECT_FADED_DURATION_MS = 1500; // Gray state: 1.5s
  const INCORRECT_FADEOUT_DURATION_MS = 1000; // Fade out: 1s

  // Round Archive modal state (Milestone 5.4)
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [currentRoundId, setCurrentRoundId] = useState<number | undefined>(undefined);

  // Milestone 6.3: Guess purchase modal state
  const [showGuessPurchaseModal, setShowGuessPurchaseModal] = useState(false);
  const [canClaimShareBonus, setCanClaimShareBonus] = useState(true); // Whether user has already claimed share bonus today
  const [isClanktonHolder, setIsClanktonHolder] = useState(false); // For winner share card
  const [currentJackpotEth, setCurrentJackpotEth] = useState('0.00'); // For winner share card
  const [paidPacksPurchased, setPaidPacksPurchased] = useState(0); // Packs purchased today
  const [maxPaidPacksPerDay, setMaxPaidPacksPerDay] = useState(3); // Max packs allowed per day

  // Milestone 6.3: Modal decision hook for daily guess flow
  const {
    decideModal,
    markShareModalSeen,
    markPackModalSeen,
  } = useModalDecision();

  // Milestone 9.5: Game paused/operational error state
  const [operationalError, setOperationalError] = useState<{
    code: string;
    reason?: string;
  } | null>(null);


  /**
   * Milestone 6.7.1: Cleanup incorrect timers on unmount or round change
   */
  useEffect(() => {
    return () => {
      if (incorrectTimerRef.current) {
        clearTimeout(incorrectTimerRef.current);
      }
      if (fadedDismissTimerRef.current) {
        clearTimeout(fadedDismissTimerRef.current);
      }
      if (fadeoutTimerRef.current) {
        clearTimeout(fadeoutTimerRef.current);
      }
    };
  }, []);

  /**
   * Get Farcaster context on mount and signal ready
   * NOTE: @farcaster/miniapp-sdk is ONLY imported here (main game page)
   * It should NEVER be imported in _app.tsx, admin pages, or server-side code
   * because it's not compatible with Node.js server environment
   */
  useEffect(() => {
    const getFarcasterContext = async () => {
      try {
        const context = await sdk.context;
        if (context?.user?.fid) {
          setFid(context.user.fid);
          setIsInMiniApp(true);
          console.log('Farcaster FID:', context.user.fid);

          // Extract referral from SDK context.location.embed
          // When opened from a cast embed, Warpcast stores the original URL here (not in window.location)
          const location = context.location as { type?: string; embed?: string } | undefined;
          if (location?.type === 'cast_embed' && location.embed) {
            try {
              const embedUrl = new URL(location.embed);
              const refParam = embedUrl.searchParams.get('ref');
              if (refParam) {
                const refFid = parseInt(refParam, 10);
                if (!isNaN(refFid) && refFid > 0 && !sessionStorage.getItem('referrerFid')) {
                  sessionStorage.setItem('referrerFid', refFid.toString());
                  console.log(`[Referral] Captured from SDK context.location.embed: ${refFid}`);
                }
              }
            } catch (e) {
              console.error('[Referral] Failed to parse embed URL:', e);
            }
          }
        } else {
          // No FID in context - check if dev mode
          console.log('No FID in context');
          if (isClientDevMode()) {
            console.log('Dev mode enabled, using fallback FID');
            setFid(12345); // Dev fallback
          }
          setIsInMiniApp(false);
        }

        setHasCheckedContext(true);

        // Signal that the app is ready to the Farcaster mini-app runtime
        sdk.actions.ready();
      } catch (error) {
        console.log('Not in Farcaster context');
        if (isClientDevMode()) {
          console.log('Dev mode enabled, using fallback FID');
          setFid(12345); // Dev fallback
        }
        setIsInMiniApp(false);
        setHasCheckedContext(true);
      }
    };

    getFarcasterContext();
  }, []);

  /**
   * Capture referral from window.location (fallback for non-Warpcast contexts)
   * Primary capture happens in getFarcasterContext from sdk.context.location.embed
   */
  useEffect(() => {
    // Only use window.location as fallback if not already captured from SDK context
    if (sessionStorage.getItem('referrerFid')) return;

    const urlParams = new URLSearchParams(window.location.search);
    const refParam = urlParams.get('ref');
    if (refParam) {
      const refFid = parseInt(refParam, 10);
      if (!isNaN(refFid) && refFid > 0) {
        sessionStorage.setItem('referrerFid', refFid.toString());
        console.log(`[Referral] Captured from window.location: ${refFid}`);
      }
    }
  }, []);

  /**
   * Check if user has seen intro overlay (Milestone 4.3)
   * NOTE: In production, OnboardingManager now handles this via /api/onboarding/status
   * This effect is only for dev mode testing
   */
  useEffect(() => {
    // In dev mode, always show the tutorial overlay for testing
    if (isClientDevMode() && effectiveFid) {
      setShowFirstTimeOverlay(true);
    }
    // In production, OnboardingManager handles the full onboarding flow
    // including both "How It Works" and OG Hunter thanks modals
  }, [effectiveFid]);

  /**
   * Fetch wheel words on mount (Milestone 2.3, updated Milestone 4.10)
   * Wheel now returns all GUESS_WORDS with per-word status
   */
  useEffect(() => {
    const fetchWheelWords = async () => {
      try {
        const response = await fetch('/api/wheel');
        if (response.ok) {
          const data: WheelResponse = await response.json();
          if (data.words && data.words.length > 0) {
            setWheelWords(data.words);
          } else {
            console.warn('Wheel API returned empty words array');
          }
        } else {
          console.error('Wheel API returned non-OK status:', response.status);
        }
      } catch (error) {
        console.error('Error fetching wheel words:', error);
        // Don't clear wheelWords on error - keep existing words if any
      } finally {
        setIsLoadingWheel(false);
      }
    };

    fetchWheelWords();
  }, []); // Fetch once on mount - API handles all state derivation

  /**
   * Milestone 6.7.1: Poll for wrong guess updates every 60 seconds
   * This allows users to see other players' wrong guesses in near-real-time
   * without the bandwidth cost of fetching the full wheel
   */
  useEffect(() => {
    const pollWrongGuesses = async () => {
      try {
        const response = await fetch('/api/wheel/wrong-guesses');
        if (!response.ok) return;

        const data = await response.json();

        // Skip processing if count hasn't changed
        if (data.count === lastWrongGuessCountRef.current) {
          return;
        }

        lastWrongGuessCountRef.current = data.count;

        // Build a Set for O(1) lookup
        const wrongGuessSet = new Set<string>(data.wrongGuesses);

        // Update wheel words with new wrong statuses
        setWheelWords(prevWords => {
          if (prevWords.length === 0) return prevWords;

          let hasChanges = false;
          const updatedWords = prevWords.map(word => {
            // Only update unguessed words to wrong (don't override winner)
            if (word.status === 'unguessed' && wrongGuessSet.has(word.word)) {
              hasChanges = true;
              return { ...word, status: 'wrong' as const };
            }
            return word;
          });

          return hasChanges ? updatedWords : prevWords;
        });
      } catch (error) {
        // Silently fail - polling is best-effort
        console.debug('Wrong guess poll failed:', error);
      }
    };

    // Start polling after a short delay (don't poll immediately on mount)
    const intervalId = setInterval(pollWrongGuesses, WRONG_GUESS_POLL_INTERVAL_MS);

    // Cleanup on unmount
    return () => clearInterval(intervalId);
  }, []);

  // Track whether this is the first user state fetch (for dev mode reset)
  const isFirstUserStateFetchRef = useRef(true);

  /**
   * Fetch user state to check if user has guesses left (Milestone 4.6)
   * Milestone 6.3: Also check share bonus eligibility, CLANKTON holder status, and pack purchase status
   * Milestone 6.4.7: Apply dev persona overrides for QA testing
   * Uses effectiveFid (real FID or dev fallback) for consistent FID handling
   */
  useEffect(() => {
    const fetchUserGuessCount = async () => {
      if (!effectiveFid) return;

      try {
        // Only pass initialLoad=true on first fetch to trigger dev mode reset
        const isInitialLoad = isFirstUserStateFetchRef.current;
        isFirstUserStateFetchRef.current = false;

        // Build URL with FID and wallet address for CLANKTON bonus check
        const params = new URLSearchParams();
        params.append('devFid', effectiveFid.toString());
        if (isInitialLoad) params.append('initialLoad', 'true');
        if (connectedWalletAddress) params.append('walletAddress', connectedWalletAddress);
        const url = `/api/user-state?${params.toString()}`;

        const response = await fetch(url);
        if (response.ok) {
          const data: UserStateResponse = await response.json();

          setHasGuessesLeft(data.totalGuessesRemaining > 0);
          // Milestone 6.3: Check if user can still claim share bonus
          setCanClaimShareBonus(!data.hasSharedToday);
          // Milestone 6.3: Check if user is CLANKTON holder
          setIsClanktonHolder(data.isClanktonHolder || false);
          // Milestone 6.3: Track pack purchases for modal decision logic
          setPaidPacksPurchased(data.paidPacksPurchased || 0);
          setMaxPaidPacksPerDay(data.maxPaidPacksPerDay || 3);
          // Milestone 4.14 + dev mode: Set wheel start index ONLY on initial load
          // In dev mode, preserve the session's random position across refetches
          // (wheel should return to same position after guess, not get a new random)
          setWheelStartIndex(prev => {
            if (prev !== null) return prev; // Already set, keep session position
            return data.wheelStartIndex ?? prev;
          });
        }
      } catch (error) {
        console.error('Error fetching user guess count:', error);
        // Default to true to avoid blocking the user
        setHasGuessesLeft(true);
        setCanClaimShareBonus(true);
      }
    };

    fetchUserGuessCount();
  }, [effectiveFid, userStateKey, connectedWalletAddress]); // Re-fetch when FID, state key, or wallet changes

  /**
   * CRITICAL: Create memoized Set of wrong guesses for O(1) lookup
   * Using wheelWords.some() would be O(n) through 10,516 words on every keystroke!
   * This must be defined BEFORE the useEffects that use it.
   */
  const wrongGuessesSet = useMemo(() => {
    const set = new Set<string>();
    for (const w of wheelWords) {
      if (w.status === 'wrong') {
        set.add(w.word.toLowerCase());
      }
    }
    return set;
  }, [wheelWords]);

  /**
   * Milestone 6.4: Compute current input state and create centralized input control
   * These need to be defined early so handler functions can use them
   */
  const currentWord = useMemo(() => letters.join(''), [letters]);
  const isWordAlreadyGuessed = useMemo(() => {
    return currentWord.length === 5
      ? wrongGuessesSet.has(currentWord.toLowerCase())
      : false;
  }, [currentWord, wrongGuessesSet]);

  const currentInputState: InputState = useMemo(() => getInputState({
    letters,
    isInGuessList: currentWord.length === 5 ? isValidGuess(currentWord) : true,
    isAlreadyGuessed: isWordAlreadyGuessed,
    isSubmitting: isLoading,
    hasGuessesLeft,
    resultState: boxResultState,
  }), [letters, currentWord, isWordAlreadyGuessed, isLoading, hasGuessesLeft, boxResultState]);

  // Centralized input handling for consistent tap/input behavior
  const guessInputControl = useGuessInput({
    letters,
    inputState: currentInputState,
    disabled: isLoading,
  });

  /**
   * Milestone 6.4.2: Update wheel's current guess as a transition (low priority)
   * Milestone 6.4.6: Use requestIdleCallback for even better deferral
   * This prevents wheel updates from blocking input box rendering
   * Input boxes update immediately (high priority), wheel catches up afterwards
   */
  useEffect(() => {
    // Use requestIdleCallback if available, otherwise fall back to transition
    if (typeof requestIdleCallback !== 'undefined') {
      const id = requestIdleCallback(() => {
        startWheelTransition(() => {
          setWheelCurrentGuess(currentWord);
        });
      }, { timeout: 100 }); // Max 100ms delay
      return () => cancelIdleCallback(id);
    } else {
      startWheelTransition(() => {
        setWheelCurrentGuess(currentWord);
      });
    }
  }, [currentWord]);

  /**
   * Milestone 6.4.3: Mark input as painted for performance measurement
   * Uses useLayoutEffect to run synchronously after DOM updates
   * This allows measuring the time between keydown and first paint
   */
  useLayoutEffect(() => {
    // Mark that input boxes have been painted (for perf debugging)
    markInputPainted();
  }, [letters]);

  /**
   * Trigger shake when typing invalid words (Milestone 4.6, updated Milestone 4.10)
   * Provides immediate visual feedback for invalid state
   * Note: Haptics for invalid states are now handled by useInputStateHaptics hook (Milestone 4.7)
   * Milestone 6.4: Uses memoized currentInputState instead of recomputing
   */
  useEffect(() => {
    // Only trigger shake when in an invalid 5-letter state
    if (currentInputState === 'TYPING_FULL_INVALID_NONSENSE' ||
        currentInputState === 'TYPING_FULL_INVALID_ALREADY_GUESSED') {
      triggerShake();
    }
  }, [currentInputState]); // Trigger when input state changes to invalid

  /**
   * Hardware keyboard support for desktop (Milestone 4.4)
   * Milestone 6.4.3: Added performance marker for keydown events
   */
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      // Don't process if loading or if any modal/sheet is open
      if (isLoading || showStatsSheet || showReferralSheet || showFAQSheet || showShareModal || showFirstTimeOverlay || showTutorial) {
        return;
      }

      // Handle A-Z letters
      if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        // Milestone 6.4.3: Mark keydown for performance measurement
        markKeydown();
        handleLetter(e.key);
        return;
      }

      // Handle backspace
      if (e.key === 'Backspace') {
        e.preventDefault();
        // Milestone 6.4.3: Mark keydown for performance measurement
        markKeydown();
        handleBackspace();
        return;
      }

      // Handle enter - submit guess (only if guess button would be enabled)
      if (e.key === 'Enter') {
        e.preventDefault();
        // Milestone 6.4: Respect same validation as GUESS button
        if (!isGuessButtonEnabled(currentInputState) || isLoading) {
          return;
        }
        handleSubmit();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [letters, isLoading, currentInputState, showStatsSheet, showReferralSheet, showFAQSheet, showShareModal, showFirstTimeOverlay, showTutorial]);

  /**
   * Auto-dismiss state error messages after 2 seconds
   * Milestone 6.4: Uses memoized currentInputState instead of recomputing
   */
  useEffect(() => {
    // Reset hide flag when letters change (show error again for new invalid input)
    setHideStateError(false);

    // Check if there's an error based on current input state
    const errorMsg = getErrorMessage(currentInputState);
    if (errorMsg) {
      // Show error for 2 seconds then hide it
      const timer = setTimeout(() => {
        setHideStateError(true);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [currentInputState]); // Only depend on the memoized input state

  /**
   * Handle letter changes from LetterBoxes component (Milestone 4.3)
   * Milestone 6.7.1: Also clears incorrect state and timer when typing starts
   */
  const handleLettersChange = (newLetters: string[]) => {
    setLetters(newLetters);

    // Reset to typing state when user starts typing
    setBoxResultState('typing');

    // Milestone 6.7.1: Clear incorrect state when user starts typing
    if (incorrectState !== 'none') {
      // Cancel any pending timer
      if (incorrectTimerRef.current) {
        clearTimeout(incorrectTimerRef.current);
        incorrectTimerRef.current = null;
      }
      setIncorrectState('none');
      setLastSubmittedGuess(null);
    }

    // Clear previous result and errors when user starts typing
    if (result || errorMessage) {
      setResult(null);
      setErrorMessage(null);
    }
  };

  /**
   * Trigger shake animation (Milestone 4.3)
   */
  const triggerShake = () => {
    setIsShaking(true);
    setTimeout(() => setIsShaking(false), 400); // Match animation duration
  };

  /**
   * Handle letter input from GameKeyboard (Milestone 4.4)
   * Milestone 6.4: Uses centralized input control for consistent behavior
   * Milestone 6.4.6: Optimized for instant first-letter response
   */
  const handleLetter = (letter: string) => {
    // Fast path: inline the common case check to avoid hook overhead
    // Only call the hook for edge cases (error states, locked states)
    const filledCount = letters.filter(l => l !== '').length;

    // Quick rejection: row is full
    if (filledCount >= 5) return;

    // Show purchase modal if user is out of guesses and tries to type
    if (!hasGuessesLeft) {
      setShowGuessPurchaseModal(true);
      return;
    }

    // Quick rejection: locked or error states need full check
    if (isLoading || boxResultState === 'correct') {
      const newLetters = guessInputControl.handleLetter(letter);
      if (!newLetters) return;
      setLetters(newLetters);
    } else {
      // Fast path: directly compute new letters array
      const nextIndex = letters.findIndex(l => l === '');
      if (nextIndex === -1 || nextIndex >= 5) return;

      const newLetters = [...letters];
      newLetters[nextIndex] = letter.toUpperCase();
      setLetters(newLetters);
    }

    // Only update boxResultState if it's not already 'typing'
    if (boxResultState !== 'typing') {
      setBoxResultState('typing');
    }

    // Milestone 6.7.1: Clear incorrect state when user starts typing
    if (incorrectState !== 'none') {
      if (incorrectTimerRef.current) {
        clearTimeout(incorrectTimerRef.current);
        incorrectTimerRef.current = null;
      }
      setIncorrectState('none');
      setLastSubmittedGuess(null);
    }

    // Only clear result/error if they exist
    if (result) setResult(null);
    if (errorMessage) setErrorMessage(null);

    void haptics.keyTap();
  };

  /**
   * Handle backspace from GameKeyboard (Milestone 4.4)
   * Milestone 6.4: Uses centralized input control for consistent behavior
   * Milestone 6.4.6: Optimized to avoid redundant state updates
   * Milestone 6.7.1: Also clears incorrect state
   */
  const handleBackspace = () => {
    // Show purchase modal if user is out of guesses and tries to type
    if (!hasGuessesLeft) {
      setShowGuessPurchaseModal(true);
      return;
    }

    // Fast path: check if locked (don't allow backspace during submission or after winning)
    if (isLoading || boxResultState === 'correct') {
      const newLetters = guessInputControl.handleBackspace();
      if (!newLetters) return;
      setLetters(newLetters);
    } else {
      // Fast path: directly compute new letters array
      let lastFilledIndex = -1;
      for (let i = letters.length - 1; i >= 0; i--) {
        if (letters[i] !== '') {
          lastFilledIndex = i;
          break;
        }
      }

      // Nothing to delete
      if (lastFilledIndex < 0) return;

      const newLetters = [...letters];
      newLetters[lastFilledIndex] = '';
      setLetters(newLetters);
    }

    // Only update boxResultState if it's not already 'typing'
    if (boxResultState !== 'typing') {
      setBoxResultState('typing');
    }

    // Milestone 6.7.1: Clear incorrect state when user starts typing
    if (incorrectState !== 'none') {
      if (incorrectTimerRef.current) {
        clearTimeout(incorrectTimerRef.current);
        incorrectTimerRef.current = null;
      }
      setIncorrectState('none');
      setLastSubmittedGuess(null);
    }

    // Only clear result/error if they exist
    if (result) setResult(null);
    if (errorMessage) setErrorMessage(null);

    void haptics.keyBackspace();
  };

  /**
   * Submit guess to backend
   * Called when GUESS button is tapped or Enter is pressed
   */
  const handleSubmit = async () => {
    // Get word from letters array
    const word = letters.join('');

    // Validate word length
    if (word.length !== 5) {
      setErrorMessage('Word must be exactly 5 letters');
      triggerShake(); // Shake animation (Milestone 4.3)
      triggerHaptic('error'); // Haptic feedback (Milestone 4.3)
      return;
    }

    // Defense-in-depth: Check input state before submitting
    // This catches race conditions where the button/enter key handler might
    // allow submission before React has fully processed state updates
    if (!isGuessButtonEnabled(currentInputState)) {
      console.warn(`[handleSubmit] Blocked submission in state: ${currentInputState}`);
      // If it's a duplicate guess, show the error state
      if (currentInputState === 'TYPING_FULL_INVALID_ALREADY_GUESSED') {
        triggerShake();
        triggerHaptic('error');
      }
      return;
    }

    // Clear previous state
    setIsLoading(true);
    setResult(null);
    setErrorMessage(null);

    // Haptic feedback on submission (Milestone 4.7)
    void haptics.guessSubmitting();

    try {
      // Build request body with appropriate authentication
      const requestBody: any = { word };

      if (isInMiniApp && fid) {
        // In mini app context: use miniAppFid (production)
        // Warpcast has already authenticated the user via sdk.context
        requestBody.miniAppFid = fid;
      } else if (isClientDevMode() && effectiveFid) {
        // Local development: use devFid
        requestBody.devFid = effectiveFid;
      }

      // Get referral parameter from sessionStorage (captured on initial page load)
      // This ensures the ref is not lost if URL changed before first guess
      const storedRef = sessionStorage.getItem('referrerFid');
      if (storedRef) {
        const refFid = parseInt(storedRef, 10);
        if (!isNaN(refFid) && refFid > 0) {
          requestBody.ref = refFid;
        }
      }

      // Call API
      const response = await fetch('/api/guess', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        // Try to get detailed error from response
        try {
          const errorData = await response.json();

          // Milestone 9.6: Handle rate limiting gracefully (calm, non-punitive)
          if (response.status === 429 || errorData.error === 'RATE_LIMITED') {
            console.log('[Guess] Rate limited - showing brief message');
            // Return a soft result - don't throw, don't disrupt UI
            const rateLimitResult: SubmitGuessResult = {
              status: 'rate_limited',
              message: errorData.message || 'Too fast — try again in a moment',
              retryAfterSeconds: errorData.retryAfterSeconds,
            };
            setResult(rateLimitResult);
            setIsLoading(false);
            return; // Don't throw, just set result and return
          }

          // Milestone 9.5: Check for operational errors (kill switch, dead day)
          const opError = parseOperationalError(errorData);
          if (opError.isOperational) {
            setOperationalError({
              code: opError.code!,
              reason: opError.reason,
            });
            setIsLoading(false);
            return; // Don't throw, just show the banner
          }

          if (errorData.devDetails) {
            console.error('API Error Details:', errorData.devDetails);
            console.error('API Error Stack:', errorData.devStack);
            throw new Error(`API Error: ${errorData.devDetails}`);
          }
        } catch (parseError) {
          // Response wasn't JSON or parsing failed
        }
        throw new Error('Failed to submit guess');
      }

      const data: SubmitGuessResult = await response.json();
      setResult(data);

      // Set box result state based on guess outcome (Milestone 4.3)
      // Note: Haptics are now handled by useInputStateHaptics hook via state transitions
      if (data.status === 'correct') {
        setBoxResultState('correct');

        // Milestone 4.14: Trigger full-screen confetti on win
        const duration = 3000;
        const end = Date.now() + duration;

        const colors = ['#22c55e', '#10b981', '#4ade80', '#86efac']; // Green colors

        (function frame() {
          confetti({
            particleCount: 3,
            angle: 60,
            spread: 55,
            origin: { x: 0, y: 0.6 },
            colors,
          });
          confetti({
            particleCount: 3,
            angle: 120,
            spread: 55,
            origin: { x: 1, y: 0.6 },
            colors,
          });

          if (Date.now() < end) {
            requestAnimationFrame(frame);
          }
        }());

        // Milestone 4.14: Show winner share card after short delay
        setWinnerData({ word: data.word, roundId: data.roundId });
        setTimeout(() => {
          setShowWinnerShareCard(true);
        }, 2000); // 2 second delay to let confetti play first
      } else if (data.status === 'incorrect' || data.status === 'already_guessed_word') {
        setBoxResultState('wrong');
        if (data.status === 'already_guessed_word') {
          triggerShake();

          // Milestone 6.7.1: Immediately update wheel to show this word as wrong
          // This fixes the sync issue where another user guessed it before our poll updated
          setWheelWords(prevWords => {
            const wordUpper = word.toUpperCase();
            return prevWords.map(w =>
              w.word === wordUpper && w.status === 'unguessed'
                ? { ...w, status: 'wrong' as const }
                : w
            );
          });
        }

        // Milestone 6.7.1: Start incorrect state machine for incorrect guesses
        if (data.status === 'incorrect') {
          // Clear any previous timer
          if (incorrectTimerRef.current) {
            clearTimeout(incorrectTimerRef.current);
          }

          // Store the guessed word and enter active state
          setLastSubmittedGuess(word);
          setIncorrectState('active');

          // Timer will be started after we know if user has guesses remaining
          // (see modal decision logic below)
        }
      } else if (data.status === 'invalid_word') {
        setBoxResultState('wrong');
        triggerHaptic('error');
        triggerShake();
      }

      // Refetch wheel data after guess (Milestone 2.3, updated Milestone 4.10)
      // Wheel will automatically update with new wrong guesses via backend status derivation
      if (data.status === 'incorrect' || data.status === 'correct') {
        // Re-fetch wheel to get updated statuses
        try {
          const wheelResponse = await fetch('/api/wheel');
          if (wheelResponse.ok) {
            const wheelData: WheelResponse = await wheelResponse.json();
            if (wheelData.words && wheelData.words.length > 0) {
              setWheelWords(wheelData.words);
            } else {
              console.warn('Wheel refetch returned empty words array');
            }
          }
        } catch (error) {
          console.error('Error refetching wheel:', error);
          // Don't clear wheelWords on error - keep existing state
        }
      }

      // Refetch user state after any guess (Milestone 4.1)
      // This updates the guess counts in real-time
      setUserStateKey(prev => prev + 1);

      // Milestone 6.3: Use modal decision logic for incorrect guesses
      // Winners get the WinnerShareCard instead
      if (data.status === 'incorrect') {
        setPendingShareResult(data);

        // Delay showing the modal so user can see the guess result message
        setTimeout(async () => {
          // Refetch user state to get updated guesses remaining
          try {
            const stateParams = new URLSearchParams({ devFid: effectiveFid.toString() });
            if (connectedWalletAddress) stateParams.append('walletAddress', connectedWalletAddress);
            const stateResponse = await fetch(`/api/user-state?${stateParams.toString()}`);
            if (stateResponse.ok) {
              const stateData: UserStateResponse = await stateResponse.json();
              const guessesRemaining = stateData.totalGuessesRemaining;

              // Milestone 6.7.1: Start timer for faded transition if user has guesses remaining
              if (guessesRemaining > 0) {
                // Start timer to transition from active (red) to faded (gray)
                incorrectTimerRef.current = setTimeout(() => {
                  setIncorrectState('faded');
                  setBoxResultState('typing'); // Reset box state to normal

                  // Start timer to begin fade out after gray state
                  fadedDismissTimerRef.current = setTimeout(() => {
                    setIncorrectState('fading_out');

                    // Start timer to complete fade out and dismiss
                    fadeoutTimerRef.current = setTimeout(() => {
                      setIncorrectState('none');
                      setLastSubmittedGuess(null);
                      setResult(null); // Clear result to prevent banner reverting to red
                    }, INCORRECT_FADEOUT_DURATION_MS);
                  }, INCORRECT_FADED_DURATION_MS);
                }, INCORRECT_ACTIVE_DURATION_MS);
              } else {
                // No guesses remaining - stay in 'none' state (out-of-guesses banner will show)
                // Clear the active state since we'll show out-of-guesses instead
                setIncorrectState('none');
              }

              // Use modal decision logic
              const decision = decideModal({
                guessesRemaining: guessesRemaining,
                hasUsedShareBonusToday: stateData.hasSharedToday,
                packsPurchasedToday: stateData.paidPacksPurchased,
                maxPacksPerDay: stateData.maxPaidPacksPerDay,
              });

              // Show appropriate modal based on decision
              switch (decision) {
                case 'share':
                  setShowShareModal(true);
                  break;
                case 'pack':
                  setShowGuessPurchaseModal(true);
                  break;
                case 'out_of_guesses':
                  // No modal - user is out of options
                  break;
                case 'none':
                default:
                  // No modal needed, user still has guesses
                  break;
              }
            }
          } catch (error) {
            console.error('Error in modal decision:', error);
            // Fallback: show share modal if eligible
            if (canClaimShareBonus) {
              setShowShareModal(true);
            }
          }
        }, 2000); // 2 second delay
      }

      // Clear input after submission (Milestone 4.3)
      // Milestone 4.14: Keep winning word in input boxes, only clear for non-winning guesses
      // This also resets the wheel to its daily start position
      if (data.status !== 'correct') {
        setLetters(['', '', '', '', '']);
      }
      // For 'correct', keep the winning word in the boxes with green pulse-glow

    } catch (error: any) {
      console.error('Error submitting guess:', error);
      // In dev mode, show the actual error for debugging
      if (isClientDevMode() && error.message && error.message !== 'Failed to submit guess') {
        setErrorMessage(error.message);
      } else {
        setErrorMessage('Something went wrong. Please try again.');
      }
      triggerHaptic('error');
      triggerShake();
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Get feedback message based on result
   * Returns variant and message for unified ResultBanner component
   * Milestone 6.7.1: Added faded property for incorrect state transitions
   */
  const getFeedbackMessage = (): { variant: ResultBannerVariant; message: ReactNode; icon?: ReactNode; faded?: boolean; visible?: boolean } | null => {
    // Milestone 6.7.1: Handle fading_out state (visible=false triggers opacity fade)
    if (incorrectState === 'fading_out' && lastSubmittedGuess) {
      return {
        variant: 'error',
        faded: true,
        visible: false, // Triggers opacity fade out
        icon: null,
        message: (
          <>
            <span>Incorrect! </span>
            <span className="font-bold">{lastSubmittedGuess.toUpperCase()}</span>
            <span> is not the secret word.</span>
          </>
        ),
      };
    }

    // Milestone 6.7.1: Handle faded incorrect state
    // Show faded banner with last submitted guess even if result is cleared
    if (incorrectState === 'faded' && lastSubmittedGuess) {
      return {
        variant: 'error',
        faded: true,
        icon: null,
        message: (
          <>
            <span>Incorrect! </span>
            <span className="font-bold">{lastSubmittedGuess.toUpperCase()}</span>
            <span> is not the secret word.</span>
          </>
        ),
      };
    }

    if (!result) return null;

    switch (result.status) {
      case 'correct':
        return {
          variant: 'success',
          icon: null,
          message: (
            <>
              <span>Correct! You found the word </span>
              <span className="font-bold">{result.word.toUpperCase()}</span>
              <span> and won this round!</span>
            </>
          ),
        };

      case 'incorrect':
        return {
          variant: 'error',
          icon: null,
          // Milestone 6.7.1: Use lastSubmittedGuess if available for consistency
          message: (
            <>
              <span>Incorrect! </span>
              <span className="font-bold">{(lastSubmittedGuess || result.word).toUpperCase()}</span>
              <span> is not the secret word.</span>
            </>
          ),
        };

      case 'already_guessed_word':
        // Duplicate guesses show as warning (yellow) to match client-side validation
        // Red is reserved for incorrect guesses (words that were wrong)
        return {
          variant: 'warning',
          message: 'Already guessed this round',
        };

      case 'invalid_word':
        if (result.reason === 'not_5_letters') {
          return {
            variant: 'error',
            message: 'Word must be exactly 5 letters',
          };
        } else if (result.reason === 'non_alpha') {
          return {
            variant: 'error',
            message: 'Word can only contain letters A–Z',
          };
        } else if (result.reason === 'not_in_dictionary') {
          return {
            variant: 'warning',
            message: 'Not a valid word',
          };
        }
        break;

      case 'round_closed':
        return {
          variant: 'warning',
          message: 'This round is already over. A new round will start soon.',
        };

      // Milestone 9.6: Rate limiting - calm, non-punitive message
      case 'rate_limited':
        return {
          variant: 'warning',
          message: result.message || 'Too fast — try again in a moment',
        };

      // Milestone 9.6: Duplicate submission - silently absorbed, no banner
      case 'duplicate_ignored':
        // Return null to show no banner - the guess was already processed
        // This prevents confusing the user with double feedback
        return null;
    }

    return null;
  };

  const feedback = getFeedbackMessage();

  // Trigger haptics on input state transitions (Milestone 4.7)
  // Note: currentInputState is now computed earlier (Milestone 6.4) for use by input control
  useInputStateHaptics(currentInputState);

  // Get state-based error message (Milestone 4.6)
  const stateErrorMessage = getErrorMessage(currentInputState);

  // Check if GUESS button should be enabled (Milestone 4.6)
  const isButtonDisabled = !isGuessButtonEnabled(currentInputState) || isLoading;

  /**
   * Handle share modal close
   * Milestone 6.3: Use modal decision logic to determine next modal
   */
  const handleShareModalClose = () => {
    setShowShareModal(false);
    setPendingShareResult(null);

    // Mark share modal as seen this session
    markShareModalSeen();

    // Milestone 6.3: If user didn't share and has no guesses left, offer packs if available
    if (!hasGuessesLeft && paidPacksPurchased < maxPaidPacksPerDay) {
      setTimeout(() => {
        setShowGuessPurchaseModal(true);
      }, 300);
    }
    // If out of packs too, no modal - user just can't play anymore
  };

  /**
   * Handle successful share
   * Refetch user state to show updated share bonus
   */
  const handleShareSuccess = () => {
    setUserStateKey(prev => prev + 1);
    setCanClaimShareBonus(false);
  };

  /**
   * Milestone 6.3: Handle pack purchase success
   */
  const handlePackPurchaseSuccess = (packCount: number) => {
    console.log(`[GameContent] Pack purchase success: ${packCount} packs`);
    // Refetch user state to update guess counts
    setUserStateKey(prev => prev + 1);
    void haptics.packPurchased();

    // Close share modal if open (user chose to buy packs instead of sharing)
    if (showShareModal) {
      setShowShareModal(false);
      setPendingShareResult(null);
    }

    // Clear any existing incorrect banner timers to prevent conflicts
    // Note: We unconditionally clear timers and state to avoid stale closure issues
    // (the modal may hold an old callback where incorrectState is stale)
    if (incorrectTimerRef.current) {
      clearTimeout(incorrectTimerRef.current);
      incorrectTimerRef.current = null;
    }
    if (fadedDismissTimerRef.current) {
      clearTimeout(fadedDismissTimerRef.current);
      fadedDismissTimerRef.current = null;
    }
    if (fadeoutTimerRef.current) {
      clearTimeout(fadeoutTimerRef.current);
      fadeoutTimerRef.current = null;
    }

    // Immediately dismiss the incorrect banner (no fade needed - user took action)
    setIncorrectState('none');
    setLastSubmittedGuess(null);

    // Clear the result state and reset input boxes for fresh guessing
    setResult(null);
    setLetters(['', '', '', '', '']);
  };

  // Show browser fallback when not in mini app and not in dev mode
  if (hasCheckedContext && !isInMiniApp && !isClientDevMode()) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-primary-50 to-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full text-center space-y-6">
          {/* Logo */}
          <div className="flex justify-center">
            <img
              src="/LHAW-icon.png"
              alt="Let’s Have A Word"
              className="w-24 h-24 rounded-2xl shadow-lg"
            />
          </div>

          {/* Title */}
          <h1 className="text-3xl font-bold text-gray-900">
            Let’s Have A Word!
          </h1>

          {/* Message */}
          <div className="bg-white rounded-xl shadow-card p-6 space-y-4">
            <p className="text-gray-700 leading-relaxed">
              <strong>Let's Have A Word!</strong> uses the Farcaster stack. You can play in{' '}
              <a href="https://farcaster.xyz/~/code/ZFYXLS" target="_blank" rel="noopener noreferrer" className="text-primary-600 underline">
                Farcaster
              </a>
              {' '}and the{' '}
              <a href="https://base.app/invite/starl3xx/23BC6Y0C" target="_blank" rel="noopener noreferrer" className="text-primary-600 underline">
                Base app
              </a>
              , which share the same identity and wallet infrastructure.
            </p>
            <p className="text-gray-600 text-sm">
              Standalone web play isn’t supported yet. A standalone web version may be explored later.
            </p>
          </div>

          {/* CTA Button */}
          <a
            href="https://warpcast.com/letshaveaword"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-accent inline-flex items-center gap-2 px-6 py-3"
          >
            <img src="/FC-arch-icon.png" alt="" className="w-4 h-4" />
            @letshaveaword
          </a>

          {/* Footer */}
          <div className="space-y-1">
            <p className="text-xs text-gray-500">
              Don't have Farcaster?{' '}
              <a
                href="https://farcaster.xyz/~/code/ZFYXLS"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline"
              >
                Sign up here
              </a>
            </p>
            <p className="text-xs text-gray-500">
              Don't have Base app?{' '}
              <a
                href="https://base.app/invite/starl3xx/23BC6Y0C"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary-600 underline"
              >
                Sign up here
              </a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Milestone 9.5: Game Paused Banner */}
      {operationalError && (
        <GamePausedBanner
          errorCode={operationalError.code}
          reason={operationalError.reason}
          onDismiss={() => setOperationalError(null)}
        />
      )}

      {/* Top Ticker (Milestone 2.3, 5.4: clickable round number) */}
      <TopTicker
        onRoundClick={(roundId) => {
          setCurrentRoundId(roundId);
          setShowArchiveModal(true);
        }}
        adminFid={effectiveFid ?? undefined}
      />

      {/* Game Area Wrapper - contains UserState, game container, and overlays */}
      <div className="flex-1 flex flex-col relative overflow-hidden">
        {/* User State (Milestone 4.1) - Minimal */}
        <div className="px-4 pt-1">
          <div className="max-w-md mx-auto">
            <UserState key={userStateKey} fid={effectiveFid} />
          </div>
        </div>

        {/* Main Game Container with Layered Wheel */}
        <div
          className="flex-1 flex flex-col px-4 pt-1 overflow-hidden"
          style={{
            paddingBottom: 'max(13rem, calc(13rem + env(safe-area-inset-bottom)))',
          }}
        >
        <div className="max-w-md w-full mx-auto flex-1 relative flex flex-col">

          {/* Info Icon - resurface tutorial (absolutely positioned to not affect layout) */}
          {!showFirstTimeOverlay && !showTutorial && (
            <button
              onClick={() => {
                setShowTutorial(true);
                void haptics.buttonTapMinor();
              }}
              className="absolute top-0 right-0 p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
              style={{ zIndex: 20 }}
              aria-label="How to play"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="w-5 h-5"
              >
                <circle cx="12" cy="12" r="9" />
                <line x1="12" y1="11" x2="12" y2="16" />
                <circle cx="12" cy="8" r="0.5" fill="currentColor" />
              </svg>
            </button>
          )}

          {/* Wheel + Input Container - fills remaining space with stable height */}
          <div
            className="flex-1 relative"
            style={{
              minHeight: 0,
              overflow: 'hidden', // Ensure content doesn't affect height
              willChange: 'auto', // Prevent paint/layout thrashing
            }}
          >
            {/* Background Layer: Wheel with real gap (no words can occupy this vertical space) */}
            <div
              className="absolute inset-0"
              style={{
                zIndex: 1,
                contain: 'layout style', // Avoid paint containment to allow backdrop-filter
              }}
            >
              {isLoadingWheel ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-400 animate-pulse">Loading...</p>
                </div>
              ) : (
                <Wheel
                  words={wheelWords}
                  currentGuess={wheelCurrentGuess}
                  inputState={currentInputState}
                  startIndex={wheelStartIndex}
                />
              )}
            </div>

            {/* Background blocker - prevents words from flashing behind input boxes */}
            <div
              className="absolute inset-x-0 flex justify-center"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                height: '4rem', // Same height as input boxes (64px)
                zIndex: 5,
                pointerEvents: 'none'
              }}
            >
              <div
                style={{
                  width: '21rem', // Match 5 boxes + gaps (5*4rem + 4*0.5rem = 22rem)
                  maxWidth: 'calc(100% - 4rem)', // Respect px-8 padding
                  height: '100%',
                  backgroundColor: 'rgb(249, 250, 251)', // Match page background (bg-gray-50)
                  borderRadius: '1rem',
                }}
              />
            </div>

            {/* Fixed Layer: Input Boxes - always visible, always centered */}
            <div
              className="absolute inset-x-0 flex justify-center px-8"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 10,
                pointerEvents: 'none', // Allow clicks through to wheel
                willChange: 'transform', // Ensure stable positioning
              }}
            >
              <div style={{ pointerEvents: 'auto' }}> {/* Re-enable clicks on input */}
                <LetterBoxes
                  letters={letters}
                  onChange={handleLettersChange}
                  disabled={isLoading}
                  isShaking={isShaking}
                  resultState={boxResultState}
                  inputState={currentInputState}
                />
              </div>
            </div>

            {/* Error/feedback area - positioned to overlap wheel for backdrop blur effect */}
            {/* Milestone 6.7.1: Moved outside input container for proper backdrop-filter */}
            <div
              className="absolute left-0 right-0 px-8"
              style={{
                top: 'calc(50% + 3rem)', // Below input boxes (50% + half input height + gap)
                zIndex: 8, // Above wheel (1) but below input boxes (10)
                pointerEvents: 'auto',
                height: '3.5rem', // Fixed height - content toggles opacity only
              }}
            >
              {/* Show explicit error messages first - using unified ResultBanner */}
              {errorMessage && (
                <ResultBanner
                  variant="error"
                  message={errorMessage}
                />
              )}

              {/* Show state-based error messages (Milestone 4.6) - using unified ResultBanner */}
              {/* "Not a valid word" and "Already guessed this round" use warning variant per spec */}
              {/* "No guesses left today" uses error variant */}
              {!errorMessage && stateErrorMessage && (
                <ResultBanner
                  variant={stateErrorMessage === 'No guesses left today' ? 'error' : 'warning'}
                  message={stateErrorMessage}
                  visible={!hideStateError}
                />
              )}

              {/* Show feedback from last submission - using unified ResultBanner */}
              {/* Milestone 6.7.1: Pass faded and visible props for incorrect state transitions */}
              {feedback && !errorMessage && !stateErrorMessage && (
                <ResultBanner
                  variant={feedback.variant}
                  message={feedback.message}
                  icon={feedback.icon}
                  faded={feedback.faded}
                  visible={feedback.visible !== false}
                />
              )}
            </div>
          </div>

          {/* Fixed Layer: Buttons - at bottom */}
          <div className="mt-4 px-8" style={{ position: 'relative', zIndex: 5 }}>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isButtonDisabled}
                onMouseDown={(e) => {
                  if (!isButtonDisabled) {
                    e.currentTarget.style.backgroundColor = '#1e4a8f'; // Darker on press
                  }
                }}
                onMouseUp={(e) => {
                  if (!isButtonDisabled) {
                    e.currentTarget.style.backgroundColor = '#2D68C7'; // Back to normal
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isButtonDisabled) {
                    e.currentTarget.style.backgroundColor = '#2D68C7'; // Reset if mouse leaves while pressed
                  }
                }}
                className={`w-full py-4 px-6 rounded-xl font-bold text-white text-lg transition-all shadow-lg tracking-wider ${
                  isButtonDisabled
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'active:scale-95'
                }`}
                style={!isButtonDisabled ? { backgroundColor: '#2D68C7' } : {}}
              >
                {isLoading ? 'SUBMITTING...' : 'GUESS'}
              </button>

              {/* Navigation Buttons (Milestone 4.3) */}
              <div className="mt-4 mb-4 grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    setShowStatsSheet(true);
                    void haptics.buttonTapMinor();
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all"
                >
                  📊 Stats
                </button>
                <button
                  onClick={() => {
                    setShowReferralSheet(true);
                    void haptics.buttonTapMinor();
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all"
                >
                  🤝 Refer
                </button>
                <button
                  onClick={() => {
                    setShowFAQSheet(true);
                    void haptics.buttonTapMinor();
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all"
                >
                  🤔 FAQ
                </button>
              </div>
          </div>
        </div>
        </div>

      </div>

      {/* Custom Keyboard (Milestone 4.4) */}
      <div
        className="fixed bottom-0 left-0 right-0 bg-gray-100 pt-2"
        style={{
          zIndex: 50,
          paddingBottom: isInMiniApp
            ? 'max(2.5rem, env(safe-area-inset-bottom))'
            : 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        <GameKeyboard
          onLetter={handleLetter}
          onBackspace={handleBackspace}
          disabled={isLoading}
        />
      </div>

      {/* Share Prompt Modal (Milestone 4.2) */}
      {showShareModal && pendingShareResult && (
        <SharePromptModal
          fid={effectiveFid}
          guessResult={pendingShareResult}
          onClose={handleShareModalClose}
          onShareSuccess={handleShareSuccess}
        />
      )}

      {/* Stats Sheet (Milestone 4.3) */}
      {showStatsSheet && (
        <StatsSheet
          fid={effectiveFid}
          onClose={() => setShowStatsSheet(false)}
        />
      )}

      {/* Referral Sheet (Milestone 4.3) */}
      {showReferralSheet && (
        <ReferralSheet
          fid={effectiveFid}
          onClose={() => setShowReferralSheet(false)}
        />
      )}

      {/* FAQ Sheet (Milestone 4.3) */}
      {showFAQSheet && (
        <FAQSheet
          onClose={() => setShowFAQSheet(false)}
        />
      )}

      {/* Winner Share Card (Milestone 4.14, 6.3, 6.8) */}
      {showWinnerShareCard && winnerData && (
        <WinnerShareCard
          winnerWord={winnerData.word}
          roundId={winnerData.roundId}
          jackpotEth={currentJackpotEth}
          onClose={() => setShowWinnerShareCard(false)}
        />
      )}

      {/* Milestone 6.3: Guess Purchase Modal */}
      {showGuessPurchaseModal && (
        <GuessPurchaseModal
          fid={effectiveFid}
          onClose={() => {
            setShowGuessPurchaseModal(false);
            markPackModalSeen();
            // If user closed without purchasing and out of guesses, no modal - just can't play
          }}
          onPurchaseSuccess={handlePackPurchaseSuccess}
        />
      )}

      {/* Round Archive Modal (Milestone 5.4) */}
      <RoundArchiveModal
        isOpen={showArchiveModal}
        onClose={() => setShowArchiveModal(false)}
        currentRoundId={currentRoundId}
      />

      {/* First Time Overlay - only shown in dev mode for testing */}
      {showFirstTimeOverlay && (
        <FirstTimeOverlay
          onDismiss={() => setShowFirstTimeOverlay(false)}
          fid={effectiveFid ?? undefined}
        />
      )}

      {/* Tutorial Overlay - resurface via info icon */}
      {showTutorial && (
        <FirstTimeOverlay
          onDismiss={() => setShowTutorial(false)}
          tutorialOnly
          fid={effectiveFid ?? undefined}
        />
      )}

      {/* Onboarding Manager - handles post-launch onboarding flow */}
      {/* Shows "How It Works" + OG Hunter thanks modals in sequence */}
      {/* Only active in production mode (not dev mode which uses showFirstTimeOverlay) */}
      {effectiveFid && !isClientDevMode() && (
        <OnboardingManager fid={effectiveFid} />
      )}
    </div>
  );
}

/**
 * Home - Main game page wrapper
 *
 * Provides WagmiProvider and QueryClientProvider for the game page ONLY.
 * This ensures that wagmi (which depends on @farcaster/miniapp-sdk via the
 * miniapp-wagmi-connector) is NOT bundled into other pages like /admin/analytics.
 *
 * Architecture:
 * - _app.tsx: Minimal, no providers
 * - pages/index.tsx (this file): Game page with WagmiProvider
 * - pages/admin/analytics.tsx: Admin page with NeynarContextProvider
 */
export default function Home() {
  return (
    <>
      <Head>
        <meta name="base:app_id" content="695205f8c63ad876c90817af" />
      </Head>
      <WagmiProvider config={config}>
        <QueryClientProvider client={queryClient}>
          <GameContent />
        </QueryClientProvider>
      </WagmiProvider>
    </>
  );
}
