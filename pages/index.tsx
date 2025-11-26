import { useState, useEffect, useRef, useMemo, useLayoutEffect, ChangeEvent, KeyboardEvent, useTransition } from 'react';
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
import StatsSheet from '../components/StatsSheet';
import ReferralSheet from '../components/ReferralSheet';
import FAQSheet from '../components/FAQSheet';
import GameKeyboard from '../components/GameKeyboard';
import RoundArchiveModal from '../components/RoundArchiveModal';
// Milestone 6.3: New components
import GuessPurchaseModal from '../components/GuessPurchaseModal';
import AnotherGuessModal from '../components/AnotherGuessModal';
// Milestone 6.4.7: Dev mode persona switcher
import { DevPersonaProvider, useDevPersona } from '../src/contexts/DevPersonaContext';
import DevPersonaSwitcher from '../components/DevPersonaPanel';
import { triggerHaptic, haptics } from '../src/lib/haptics';
import { isValidGuess } from '../src/lib/word-lists';
import { getInputState, getErrorMessage, isGuessButtonEnabled, type InputState } from '../src/lib/input-state';
import { useInputStateHaptics } from '../src/lib/input-state-haptics';
import { useModalDecision } from '../src/hooks/useModalDecision';
import { useGuessInput } from '../src/hooks/useGuessInput';
import { markKeydown, markInputPainted } from '../src/lib/perf-debug';
import sdk from '@farcaster/miniapp-sdk';
import confetti from 'canvas-confetti';
import { WagmiProvider } from 'wagmi';
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

  // Wheel state (Milestone 2.3, updated Milestone 4.10)
  const [wheelWords, setWheelWords] = useState<WheelWord[]>([]);
  const [isLoadingWheel, setIsLoadingWheel] = useState(true);
  const [wheelStartIndex, setWheelStartIndex] = useState<number | null>(null);

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
  const [boxResultState, setBoxResultState] = useState<'typing' | 'wrong' | 'correct'>('typing');
  const [hideStateError, setHideStateError] = useState(false);

  // Round Archive modal state (Milestone 5.4)
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [currentRoundId, setCurrentRoundId] = useState<number | undefined>(undefined);

  // Milestone 6.3: Guess purchase and "another guess" modal state
  const [showGuessPurchaseModal, setShowGuessPurchaseModal] = useState(false);
  const [showAnotherGuessModal, setShowAnotherGuessModal] = useState(false);
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

  // Milestone 6.4.7: Dev persona overrides for QA testing
  const {
    applyOverrides: applyDevPersonaOverrides,
    registerModalTestCallback,
    currentPersona,
    isDevMode,
  } = useDevPersona();

  /**
   * Milestone 6.4.7: Register callback for dev panel "Test Modal Flow" button
   * This allows the dev panel to trigger the modal flow based on the current persona
   */
  useEffect(() => {
    if (!isDevMode) return;

    const handleModalTest = () => {
      // Get the current persona's overrides
      const overrides = currentPersona.overrides;

      // Use the modal decision logic with persona state
      const decision = decideModal({
        guessesRemaining: overrides.totalGuessesRemaining ?? 0,
        hasUsedShareBonusToday: overrides.hasSharedToday ?? false,
        packsPurchasedToday: overrides.paidPacksPurchased ?? 0,
        maxPacksPerDay: maxPaidPacksPerDay,
      });

      console.log('[DevPersona] Modal test decision:', decision);

      // Show appropriate modal based on decision
      switch (decision) {
        case 'share':
          // Create a mock result for the share modal
          setPendingShareResult({
            status: 'incorrect',
            word: 'TEST',
            totalGuessesForUserThisRound: 1,
          });
          setShowShareModal(true);
          break;
        case 'pack':
          setShowGuessPurchaseModal(true);
          break;
        case 'out_of_guesses':
          setShowAnotherGuessModal(true);
          break;
        case 'none':
        default:
          // For 'none' - user has guesses, show a note
          console.log('[DevPersona] User has guesses remaining, no modal to show');
          break;
      }
    };

    registerModalTestCallback(handleModalTest);
  }, [isDevMode, currentPersona, decideModal, maxPaidPacksPerDay, registerModalTestCallback]);

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
        } else {
          // No FID in context, use dev mode fallback
          console.log('No FID in context, using dev mode');
          setFid(12345); // Dev fallback
          setIsInMiniApp(false);
        }

        // Signal that the app is ready to the Farcaster mini-app runtime
        sdk.actions.ready();
      } catch (error) {
        console.log('Not in Farcaster context, using dev mode');
        setFid(12345); // Dev fallback
        setIsInMiniApp(false);
      }
    };

    getFarcasterContext();
  }, []);

  /**
   * Check if user has seen intro overlay (Milestone 4.3)
   */
  useEffect(() => {
    const checkFirstTimeUser = async () => {
      if (!fid) return;

      try {
        const response = await fetch(`/api/user/state?devFid=${fid}`);
        if (response.ok) {
          const data = await response.json();
          if (!data.hasSeenIntro) {
            setShowFirstTimeOverlay(true);
          }
        }
      } catch (error) {
        console.error('Error checking first-time user status:', error);
      }
    };

    checkFirstTimeUser();
  }, [fid]);

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
   * Fetch user state to check if user has guesses left (Milestone 4.6)
   * Milestone 6.3: Also check share bonus eligibility, CLANKTON holder status, and pack purchase status
   * Milestone 6.4.7: Apply dev persona overrides for QA testing
   */
  useEffect(() => {
    const fetchUserGuessCount = async () => {
      if (!fid) return;

      try {
        const response = await fetch(`/api/user-state?devFid=${fid}`);
        if (response.ok) {
          const rawData: UserStateResponse = await response.json();
          // Milestone 6.4.7: Apply dev persona overrides if active
          const data = applyDevPersonaOverrides(rawData);

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
  }, [fid, userStateKey, applyDevPersonaOverrides]); // Re-fetch when userStateKey changes or persona changes

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
      if (isLoading || showStatsSheet || showReferralSheet || showFAQSheet || showShareModal || showFirstTimeOverlay) {
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
  }, [letters, isLoading, currentInputState, showStatsSheet, showReferralSheet, showFAQSheet, showShareModal, showFirstTimeOverlay]);

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
   */
  const handleLettersChange = (newLetters: string[]) => {
    setLetters(newLetters);

    // Reset to typing state when user starts typing
    setBoxResultState('typing');

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

    // Quick rejection: locked or error states need full check
    if (isLoading || boxResultState === 'correct' || !hasGuessesLeft) {
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

    // Only clear result/error if they exist
    if (result) setResult(null);
    if (errorMessage) setErrorMessage(null);

    void haptics.keyTap();
  };

  /**
   * Handle backspace from GameKeyboard (Milestone 4.4)
   * Milestone 6.4: Uses centralized input control for consistent behavior
   * Milestone 6.4.6: Optimized to avoid redundant state updates
   */
  const handleBackspace = () => {
    // Fast path: check if locked (don't allow backspace during submission or after winning)
    if (isLoading || boxResultState === 'correct' || !hasGuessesLeft) {
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

    // Clear previous state
    setIsLoading(true);
    setResult(null);
    setErrorMessage(null);

    // Haptic feedback on submission (Milestone 4.7)
    void haptics.guessSubmitting();

    try {
      // Use Farcaster FID if available, otherwise use dev FID
      const requestBody: any = { word };

      if (fid) {
        // Use Farcaster context FID
        requestBody.devFid = fid;
      } else {
        // Fallback to dev FID when not in Farcaster context
        requestBody.devFid = 12345;
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
            const stateResponse = await fetch(`/api/user-state?devFid=${fid}`);
            if (stateResponse.ok) {
              const stateData: UserStateResponse = await stateResponse.json();

              // Use modal decision logic
              const decision = decideModal({
                guessesRemaining: stateData.totalGuessesRemaining,
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
                  setShowAnotherGuessModal(true);
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

    } catch (error) {
      console.error('Error submitting guess:', error);
      setErrorMessage('Something went wrong. Please try again.');
      triggerHaptic('error');
      triggerShake();
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Get feedback message based on result
   * Returns variant and message for unified ResultBanner component
   */
  const getFeedbackMessage = (): { variant: ResultBannerVariant; message: string } | null => {
    if (!result) return null;

    switch (result.status) {
      case 'correct':
        return {
          variant: 'success',
          message: `Correct! You found the word "${result.word}" and won this round!`,
        };

      case 'incorrect':
        return {
          variant: 'error',
          message: `Incorrect. You've made ${result.totalGuessesForUserThisRound} guess${result.totalGuessesForUserThisRound === 1 ? '' : 'es'} this round.`,
        };

      case 'already_guessed_word':
        return {
          variant: 'warning',
          message: `The word "${result.word}" has already been guessed this round.`,
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

    // Milestone 6.3: If user didn't share and has no guesses left, determine next modal
    if (!hasGuessesLeft) {
      setTimeout(() => {
        // User closed share modal without sharing - now offer packs or show out-of-guesses
        if (paidPacksPurchased < maxPaidPacksPerDay) {
          setShowGuessPurchaseModal(true);
        } else {
          setShowAnotherGuessModal(true);
        }
      }, 300);
    }
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
  };

  /**
   * Milestone 6.3: Handle "another guess" modal actions
   */
  const handleAnotherGuessShare = () => {
    setShowAnotherGuessModal(false);
    // Open the share modal directly
    setShowShareModal(true);
  };

  const handleAnotherGuessBuyPacks = () => {
    setShowAnotherGuessModal(false);
    setShowGuessPurchaseModal(true);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Milestone 6.4.7: Dev Persona Switcher (only visible in dev mode) */}
      <DevPersonaSwitcher />

      {/* Top Ticker (Milestone 2.3, 5.4: clickable round number) */}
      <TopTicker
        onRoundClick={(roundId) => {
          setCurrentRoundId(roundId);
          setShowArchiveModal(true);
        }}
      />

      {/* User State (Milestone 4.1) - Minimal */}
      <div className="px-4 pt-1">
        <div className="max-w-md mx-auto">
          <UserState key={userStateKey} fid={fid} />
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
                contain: 'strict', // Strict containment: layout, style, paint, and size
                contentVisibility: 'auto', // Optimize rendering
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
              className="absolute left-0 right-0"
              style={{
                top: '50%',
                transform: 'translateY(-50%)',
                height: '4rem', // Same height as input boxes (64px)
                zIndex: 5,
                pointerEvents: 'none'
              }}
            >
              <div
                className="mx-auto"
                style={{
                  maxWidth: '21rem', // Slightly wider than 5 boxes + gaps (5*4rem + 4*0.5rem = 22rem)
                  height: '100%',
                  backgroundColor: 'rgb(249, 250, 251)', // Match page background (bg-gray-50)
                  borderRadius: '1rem',
                }}
              />
            </div>

            {/* Fixed Layer: Input Boxes - always visible, always centered */}
            <div
              className="absolute left-0 right-0 px-8"
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

              {/* Error/feedback area - FIXED HEIGHT to prevent layout shifts (Milestone 4.14) */}
              <div
                className="absolute left-0 right-0 px-8"
                style={{
                  top: '100%',
                  marginTop: '1rem',
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
                {feedback && !errorMessage && !stateErrorMessage && (
                  <ResultBanner
                    variant={feedback.variant}
                    message={feedback.message}
                  />
                )}
              </div>
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
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all shadow"
                >
                  📊 Stats
                </button>
                <button
                  onClick={() => {
                    setShowReferralSheet(true);
                    void haptics.buttonTapMinor();
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all shadow"
                >
                  🤝 Refer
                </button>
                <button
                  onClick={() => {
                    setShowFAQSheet(true);
                    void haptics.buttonTapMinor();
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all shadow"
                >
                  🤔 FAQ
                </button>
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
          fid={fid}
          guessResult={pendingShareResult}
          onClose={handleShareModalClose}
          onShareSuccess={handleShareSuccess}
        />
      )}

      {/* First Time Overlay (Milestone 4.3) */}
      {showFirstTimeOverlay && (
        <FirstTimeOverlay
          fid={fid}
          onClose={() => setShowFirstTimeOverlay(false)}
        />
      )}

      {/* Stats Sheet (Milestone 4.3) */}
      {showStatsSheet && (
        <StatsSheet
          fid={fid}
          onClose={() => setShowStatsSheet(false)}
        />
      )}

      {/* Referral Sheet (Milestone 4.3) */}
      {showReferralSheet && (
        <ReferralSheet
          fid={fid}
          onClose={() => setShowReferralSheet(false)}
        />
      )}

      {/* FAQ Sheet (Milestone 4.3) */}
      {showFAQSheet && (
        <FAQSheet
          onClose={() => setShowFAQSheet(false)}
        />
      )}

      {/* Winner Share Card (Milestone 4.14, 6.3 enhancements) */}
      {showWinnerShareCard && winnerData && (
        <WinnerShareCard
          winnerWord={winnerData.word}
          roundId={winnerData.roundId}
          jackpotEth={currentJackpotEth}
          isClanktonHolder={isClanktonHolder}
          onClose={() => setShowWinnerShareCard(false)}
        />
      )}

      {/* Milestone 6.3: Guess Purchase Modal */}
      {showGuessPurchaseModal && (
        <GuessPurchaseModal
          fid={fid}
          onClose={() => {
            setShowGuessPurchaseModal(false);
            markPackModalSeen();
            // If user closed without purchasing and out of guesses, show out-of-guesses modal
            if (!hasGuessesLeft) {
              setTimeout(() => {
                setShowAnotherGuessModal(true);
              }, 300);
            }
          }}
          onPurchaseSuccess={handlePackPurchaseSuccess}
        />
      )}

      {/* Milestone 6.3: Another Guess Modal */}
      {showAnotherGuessModal && (
        <AnotherGuessModal
          fid={fid}
          canClaimShareBonus={canClaimShareBonus}
          onClose={() => setShowAnotherGuessModal(false)}
          onShareForGuess={handleAnotherGuessShare}
          onBuyPacks={handleAnotherGuessBuyPacks}
        />
      )}

      {/* Round Archive Modal (Milestone 5.4) */}
      <RoundArchiveModal
        isOpen={showArchiveModal}
        onClose={() => setShowArchiveModal(false)}
        currentRoundId={currentRoundId}
      />
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
 *
 * Milestone 6.4.7: DevPersonaProvider wraps GameContent for QA testing
 */
export default function Home() {
  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <DevPersonaProvider>
          <GameContent />
        </DevPersonaProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
