import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import type { SubmitGuessResult } from '../src/types';
import TopTicker from '../components/TopTicker';
import Wheel from '../components/Wheel';
import UserState from '../components/UserState';
import SharePromptModal from '../components/SharePromptModal';
import LetterBoxes from '../components/LetterBoxes';
import FirstTimeOverlay from '../components/FirstTimeOverlay';
import StatsSheet from '../components/StatsSheet';
import ReferralSheet from '../components/ReferralSheet';
import FAQSheet from '../components/FAQSheet';
import XPSheet from '../components/XPSheet';
import { triggerHaptic } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';

export default function Home() {
  // Word input state - now managed as array of 5 letters (Milestone 4.3)
  const [letters, setLetters] = useState<string[]>(['', '', '', '', '']);
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SubmitGuessResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Farcaster context
  const [fid, setFid] = useState<number | null>(null);

  // Wheel state (Milestone 2.3)
  const [wheelWords, setWheelWords] = useState<string[]>([]);
  const [isLoadingWheel, setIsLoadingWheel] = useState(true);

  // User state refetch trigger (Milestone 4.1)
  const [userStateKey, setUserStateKey] = useState(0);

  // Share modal state (Milestone 4.2)
  const [showShareModal, setShowShareModal] = useState(false);
  const [pendingShareResult, setPendingShareResult] = useState<SubmitGuessResult | null>(null);

  // UX state (Milestone 4.3)
  const [isShaking, setIsShaking] = useState(false);
  const [showFirstTimeOverlay, setShowFirstTimeOverlay] = useState(false);
  const [showStatsSheet, setShowStatsSheet] = useState(false);
  const [showReferralSheet, setShowReferralSheet] = useState(false);
  const [showFAQSheet, setShowFAQSheet] = useState(false);
  const [showXPSheet, setShowXPSheet] = useState(false);

  /**
   * Get Farcaster context on mount
   */
  useEffect(() => {
    const getFarcasterContext = async () => {
      try {
        const context = await sdk.context;
        if (context?.user?.fid) {
          setFid(context.user.fid);
          console.log('Farcaster FID:', context.user.fid);
        }
      } catch (error) {
        console.log('Not in Farcaster context, using dev mode');
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
   * Handle letter changes from LetterBoxes component (Milestone 4.3)
   */
  const handleLettersChange = (newLetters: string[]) => {
    setLetters(newLetters);

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
   * Submit guess to backend
   * Only called when GUESS button is tapped
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

      // Haptic feedback based on result (Milestone 4.3)
      if (data.status === 'correct') {
        triggerHaptic('success');
      } else if (data.status === 'incorrect') {
        triggerHaptic('light');
      } else if (data.status === 'invalid_word' || data.status === 'already_guessed_word') {
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

  // Check if all 5 letters are filled (Milestone 4.3)
  const word = letters.join('');
  const isButtonDisabled = word.length !== 5 || isLoading;

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

      {/* User State (Milestone 4.1) */}
      <div className="px-4 pt-4">
        <div className="max-w-md mx-auto">
          <UserState key={userStateKey} fid={fid} />
        </div>
      </div>

      {/* Main Game Container with Layered Wheel */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="max-w-md w-full relative" style={{ height: '600px' }}>

          {/* Background Layer: Wheel */}
          <div className="absolute inset-0" style={{ zIndex: 1 }}>
            {isLoadingWheel ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-400 animate-pulse">Loading...</p>
              </div>
            ) : (
              <Wheel words={wheelWords} currentGuess={word} />
            )}
          </div>

          {/* Foreground Layer: Input & Controls */}
          <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ zIndex: 10 }}>

            {/* Input Area - LetterBoxes Component (Milestone 4.3) */}
            <div className="relative z-10 w-full px-8">
              <LetterBoxes
                letters={letters}
                onChange={handleLettersChange}
                disabled={isLoading}
                isShaking={isShaking}
              />

              {/* Feedback area below input */}
              {(errorMessage || feedback) && (
                <div className="mt-4">
                  {errorMessage && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-lg p-3">
                      <p className="text-red-700 text-center text-sm font-medium">{errorMessage}</p>
                    </div>
                  )}

                  {feedback && !errorMessage && (
                    <div className="bg-white border-2 border-gray-200 rounded-lg p-3 shadow">
                      <p className={`${feedback.color} text-center text-sm font-medium`}>
                        {feedback.text}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Guess Button - positioned below the input area */}
            <div className="absolute bottom-8 left-0 right-0 px-8 z-10">
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isButtonDisabled}
                className={`w-full py-4 px-6 rounded-xl font-bold text-white text-lg transition-all shadow-lg ${
                  isButtonDisabled
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 active:scale-95'
                }`}
              >
                {isLoading ? 'SUBMITTING...' : 'GUESS'}
              </button>

              {/* Navigation Buttons (Milestone 4.3) */}
              <div className="mt-4 grid grid-cols-4 gap-2">
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
                <button
                  onClick={() => {
                    setShowXPSheet(true);
                    triggerHaptic('light');
                  }}
                  className="py-2 px-3 bg-white border-2 border-gray-200 rounded-lg text-xs font-semibold text-gray-700 hover:bg-gray-50 active:scale-95 transition-all shadow"
                >
                  ✨ XP
                </button>
              </div>
            </div>

          </div>
        </div>
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

      {/* XP Sheet (Milestone 4.3) */}
      {showXPSheet && (
        <XPSheet
          fid={fid}
          onClose={() => setShowXPSheet(false)}
        />
      )}
    </div>
  );
}
