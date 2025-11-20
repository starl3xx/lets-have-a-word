import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import type { SubmitGuessResult, UserStateResponse } from '../src/types';
import TopTicker from '../components/TopTicker';
import Wheel from '../components/Wheel';
import UserState from '../components/UserState';
import SharePromptModal from '../components/SharePromptModal';
import LetterBoxes from '../components/LetterBoxes';
import FirstTimeOverlay from '../components/FirstTimeOverlay';
import StatsSheet from '../components/StatsSheet';
import ReferralSheet from '../components/ReferralSheet';
import FAQSheet from '../components/FAQSheet';
import GameKeyboard from '../components/GameKeyboard';
import { triggerHaptic } from '../src/lib/haptics';
import { isValidGuess } from '../src/lib/word-lists';
import { getInputState, getErrorMessage, isGuessButtonEnabled, type InputState } from '../src/lib/input-state';
import sdk from '@farcaster/miniapp-sdk';

export default function Home() {
  // Word input state - now managed as array of 5 letters (Milestone 4.3)
  const [letters, setLetters] = useState<string[]>(['', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SubmitGuessResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Farcaster context
  const [fid, setFid] = useState<number | null>(null);
  const [isInMiniApp, setIsInMiniApp] = useState(false);

  // Wheel state (Milestone 2.3)
  const [wheelWords, setWheelWords] = useState<string[]>([]);
  const [isLoadingWheel, setIsLoadingWheel] = useState(true);

  // User state refetch trigger (Milestone 4.1)
  const [userStateKey, setUserStateKey] = useState(0);

  // User guess count state (Milestone 4.6)
  const [hasGuessesLeft, setHasGuessesLeft] = useState(true);

  // Share modal state (Milestone 4.2)
  const [showShareModal, setShowShareModal] = useState(false);
  const [pendingShareResult, setPendingShareResult] = useState<SubmitGuessResult | null>(null);

  // UX state (Milestone 4.3)
  const [isShaking, setIsShaking] = useState(false);
  const [showFirstTimeOverlay, setShowFirstTimeOverlay] = useState(false);
  const [showStatsSheet, setShowStatsSheet] = useState(false);
  const [showReferralSheet, setShowReferralSheet] = useState(false);
  const [showFAQSheet, setShowFAQSheet] = useState(false);
  const [boxResultState, setBoxResultState] = useState<'typing' | 'wrong' | 'correct'>('typing');

  /**
   * Get Farcaster context on mount
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
   * Fetch wheel words on mount (Milestone 2.3)
   */
  useEffect(() => {
    const fetchWheelWords = async () => {
      try {
        const response = await fetch('/api/wheel');
        if (response.ok) {
          const data = await response.json();
          setWheelWords(data.words || []);
        }
      } catch (error) {
        console.error('Error fetching wheel words:', error);
        setWheelWords([]);
      } finally {
        setIsLoadingWheel(false);
      }
    };

    fetchWheelWords();
  }, []);

  /**
   * Fetch user state to check if user has guesses left (Milestone 4.6)
   */
  useEffect(() => {
    const fetchUserGuessCount = async () => {
      if (!fid) return;

      try {
        const response = await fetch(`/api/user-state?devFid=${fid}`);
        if (response.ok) {
          const data: UserStateResponse = await response.json();
          setHasGuessesLeft(data.totalGuessesRemaining > 0);
        }
      } catch (error) {
        console.error('Error fetching user guess count:', error);
        // Default to true to avoid blocking the user
        setHasGuessesLeft(true);
      }
    };

    fetchUserGuessCount();
  }, [fid, userStateKey]); // Re-fetch when userStateKey changes

  /**
   * Trigger shake when typing invalid words (Milestone 4.6)
   * Provides immediate visual feedback for invalid state
   */
  useEffect(() => {
    const currentWord = letters.join('');
    // Only trigger shake when user has typed 5 letters and it's invalid
    if (currentWord.length === 5) {
      // Get current state
      const state = getInputState({
        letters,
        isInGuessList: isValidGuess(currentWord),
        isAlreadyGuessed: wheelWords.includes(currentWord.toLowerCase()),
        isSubmitting: isLoading,
        hasGuessesLeft,
        resultState: boxResultState,
      });

      if (state === 'TYPING_FULL_INVALID_NONSENSE' ||
          state === 'TYPING_FULL_INVALID_ALREADY_GUESSED') {
        triggerShake();
        triggerHaptic('error');
      }
    }
  }, [letters, wheelWords, isLoading, hasGuessesLeft, boxResultState]); // Trigger when any dependency changes

  /**
   * Hardware keyboard support for desktop (Milestone 4.4)
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
        handleLetter(e.key);
        return;
      }

      // Handle backspace
      if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
        return;
      }

      // Handle enter - submit guess
      if (e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [letters, isLoading, showStatsSheet, showReferralSheet, showFAQSheet, showShareModal, showFirstTimeOverlay]);

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
   */
  const handleLetter = (letter: string) => {
    // Find first empty slot
    const idx = letters.findIndex((ch) => ch === '');
    if (idx === -1) return; // Already full

    const next = [...letters];
    next[idx] = letter.toUpperCase();
    setLetters(next);

    // Reset to typing state when user starts typing
    setBoxResultState('typing');

    // Clear previous result and errors when user starts typing
    if (result || errorMessage) {
      setResult(null);
      setErrorMessage(null);
    }

    triggerHaptic('light');
  };

  /**
   * Handle backspace from GameKeyboard (Milestone 4.4)
   */
  const handleBackspace = () => {
    // Find last non-empty slot
    let idx = letters.length - 1;
    while (idx >= 0 && letters[idx] === '') idx--;
    if (idx < 0) return; // All empty

    const next = [...letters];
    next[idx] = '';
    setLetters(next);

    // Reset to typing state
    setBoxResultState('typing');

    // Clear previous result and errors
    if (result || errorMessage) {
      setResult(null);
      setErrorMessage(null);
    }

    triggerHaptic('light');
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
      setErrorMessage('Word must be exactly 5 letters.');
      triggerShake(); // Shake animation (Milestone 4.3)
      triggerHaptic('error'); // Haptic feedback (Milestone 4.3)
      return;
    }

    // Clear previous state
    setIsLoading(true);
    setResult(null);
    setErrorMessage(null);

    // Haptic feedback on submission (Milestone 4.3)
    triggerHaptic('medium');

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
      if (data.status === 'correct') {
        setBoxResultState('correct');
        triggerHaptic('success');
      } else if (data.status === 'incorrect' || data.status === 'already_guessed_word') {
        setBoxResultState('wrong');
        triggerHaptic(data.status === 'incorrect' ? 'light' : 'error');
        if (data.status === 'already_guessed_word') {
          triggerShake();
        }
      } else if (data.status === 'invalid_word') {
        setBoxResultState('wrong');
        triggerHaptic('error');
        triggerShake();
      }

      // Refetch wheel data after guess (Milestone 2.3)
      // Wrong guesses will now appear in the wheel
      if (data.status === 'incorrect') {
        try {
          const wheelResponse = await fetch('/api/wheel');
          if (wheelResponse.ok) {
            const wheelData = await wheelResponse.json();
            setWheelWords(wheelData.words || []);
          }
        } catch (err) {
          console.error('Error refetching wheel:', err);
        }
      }

      // Refetch user state after any guess (Milestone 4.1)
      // This updates the guess counts in real-time
      setUserStateKey(prev => prev + 1);

      // Show share modal for correct/incorrect guesses (Milestone 4.2)
      // Only show if the guess was actually submitted (not an error)
      if (data.status === 'correct' || data.status === 'incorrect') {
        setPendingShareResult(data);
        setShowShareModal(true);
      }

      // Clear input after successful submission (Milestone 4.3)
      if (data.status === 'correct' || data.status === 'incorrect') {
        setLetters(['', '', '', '', '']);
      }

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
   */
  const getFeedbackMessage = (): { text: string; color: string } | null => {
    if (!result) return null;

    switch (result.status) {
      case 'correct':
        return {
          text: `🎉 Correct! You found the word "${result.word}" and won this round!`,
          color: 'text-green-600',
        };

      case 'incorrect':
        return {
          text: `❌ Incorrect guess. You've made ${result.totalGuessesForUserThisRound} guess${result.totalGuessesForUserThisRound === 1 ? '' : 'es'} this round.`,
          color: 'text-red-600',
        };

      case 'already_guessed_word':
        return {
          text: `⚠️ The word "${result.word}" has already been guessed by someone else this round.`,
          color: 'text-yellow-600',
        };

      case 'invalid_word':
        if (result.reason === 'not_5_letters') {
          return {
            text: 'Word must be exactly 5 letters.',
            color: 'text-red-600',
          };
        } else if (result.reason === 'non_alpha') {
          return {
            text: 'Word can only contain letters A–Z.',
            color: 'text-red-600',
          };
        } else if (result.reason === 'not_in_dictionary') {
          return {
            text: "That's not a valid word.",
            color: 'text-red-600',
          };
        }
        break;

      case 'round_closed':
        return {
          text: 'This round is already over. A new round will start soon.',
          color: 'text-gray-600',
        };
    }

    return null;
  };

  const feedback = getFeedbackMessage();

  // Compute current input state using state machine (Milestone 4.6)
  const word = letters.join('');
  const currentInputState: InputState = getInputState({
    letters,
    isInGuessList: word.length === 5 ? isValidGuess(word) : true, // Only check if 5 letters
    isAlreadyGuessed: word.length === 5 ? wheelWords.includes(word.toLowerCase()) : false,
    isSubmitting: isLoading,
    hasGuessesLeft,
    resultState: boxResultState,
  });

  // Get state-based error message (Milestone 4.6)
  const stateErrorMessage = getErrorMessage(currentInputState);

  // Check if GUESS button should be enabled (Milestone 4.6)
  const isButtonDisabled = !isGuessButtonEnabled(currentInputState) || isLoading;

  /**
   * Handle share modal close
   */
  const handleShareModalClose = () => {
    setShowShareModal(false);
    setPendingShareResult(null);
  };

  /**
   * Handle successful share
   * Refetch user state to show updated share bonus
   */
  const handleShareSuccess = () => {
    setUserStateKey(prev => prev + 1);
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Ticker (Milestone 2.3) */}
      <TopTicker />

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

          {/* Wheel + Input Container - fills remaining space */}
          <div className="flex-1 relative">
            {/* Wheel with input boxes embedded in the true layout gap */}
            <div className="absolute inset-0">
              {isLoadingWheel ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-gray-400 animate-pulse">Loading...</p>
                </div>
              ) : (
                <Wheel
                  words={wheelWords}
                  currentGuess={word}
                  inputState={currentInputState}
                  inputBoxes={
                    <LetterBoxes
                      letters={letters}
                      onChange={handleLettersChange}
                      disabled={isLoading}
                      isShaking={isShaking}
                      resultState={boxResultState}
                      inputState={currentInputState}
                    />
                  }
                  errorFeedback={
                    (errorMessage || feedback || stateErrorMessage) ? (
                      <>
                        {/* Show explicit error messages first */}
                        {errorMessage && (
                          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
                            <p className="text-red-700 text-center text-sm font-medium">{errorMessage}</p>
                          </div>
                        )}

                        {/* Show state-based error messages (Milestone 4.6) */}
                        {!errorMessage && stateErrorMessage && (
                          <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
                            <p className="text-red-700 text-center text-sm font-medium">{stateErrorMessage}</p>
                          </div>
                        )}

                        {/* Show feedback from last submission */}
                        {feedback && !errorMessage && !stateErrorMessage && (
                          <div className="bg-white border-2 border-gray-200 rounded-lg p-3 shadow">
                            <p className={`${feedback.color} text-center text-sm font-medium`}>
                              {feedback.text}
                            </p>
                          </div>
                        )}
                      </>
                    ) : undefined
                  }
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
              <div className="mt-4 mb-2 grid grid-cols-3 gap-2">
                <button
                  onClick={() => {
                    setShowStatsSheet(true);
                    triggerHaptic('light');
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all shadow"
                >
                  📊 Stats
                </button>
                <button
                  onClick={() => {
                    setShowReferralSheet(true);
                    triggerHaptic('light');
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all shadow"
                >
                  🤝 Refer
                </button>
                <button
                  onClick={() => {
                    setShowFAQSheet(true);
                    triggerHaptic('light');
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
        className="fixed bottom-0 left-0 right-0 bg-gray-100"
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
    </div>
  );
}
