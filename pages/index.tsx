import { useState, useEffect, useRef, ChangeEvent, KeyboardEvent } from 'react';
import type { SubmitGuessResult } from '../src/types';
import TopTicker from '../components/TopTicker';
import Wheel from '../components/Wheel';
import UserState from '../components/UserState';
import sdk from '@farcaster/miniapp-sdk';

export default function Home() {
  const [word, setWord] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SubmitGuessResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Input ref for auto-focus on mobile
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Farcaster context
  const [fid, setFid] = useState<number | null>(null);

  // Wheel state (Milestone 2.3)
  const [wheelWords, setWheelWords] = useState<string[]>([]);
  const [isLoadingWheel, setIsLoadingWheel] = useState(true);

  // User state refetch trigger (Milestone 4.1)
  const [userStateKey, setUserStateKey] = useState(0);

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
   * Auto-focus input on mobile with retry logic
   */
  useEffect(() => {
    const isMobile =
      typeof navigator !== 'undefined' &&
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (!isMobile) return;

    // Attempt to focus the input with progressive delays
    // This helps with Farcaster webview and iOS Safari
    const attemptFocus = (attempt = 1) => {
      if (!inputRef.current) {
        if (attempt < 5) {
          setTimeout(() => attemptFocus(attempt + 1), 100 * attempt);
        }
        return;
      }

      try {
        inputRef.current.focus();
        console.log(`[Mobile] Input focused successfully (attempt ${attempt})`);
      } catch (error) {
        console.error('[Mobile] Focus failed:', error);
      }
    };

    // Initial delay for Farcaster webview to fully render
    setTimeout(() => attemptFocus(), 500);
  }, []);

  /**
   * Handle input change
   * - Strip non-alphabetic characters
   * - Convert to uppercase
   * - Limit to 5 characters
   */
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;

    // Only allow A-Z letters
    const filtered = value.replace(/[^A-Za-z]/g, '');

    // Convert to uppercase and limit to 5 characters
    const normalized = filtered.toUpperCase().slice(0, 5);

    setWord(normalized);

    // Clear previous result and errors when user starts typing
    if (result || errorMessage) {
      setResult(null);
      setErrorMessage(null);
    }
  };

  /**
   * Handle Enter key press - PREVENT submission, user must tap GUESS button
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Do NOT submit - user must tap the GUESS button
      return;
    }
  };

  /**
   * Submit guess to backend
   * Only called when GUESS button is tapped
   */
  const handleSubmit = async () => {
    // Validate word length
    if (word.length !== 5) {
      setErrorMessage('Word must be exactly 5 letters.');
      return;
    }

    // Clear previous state
    setIsLoading(true);
    setResult(null);
    setErrorMessage(null);

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

      // Clear input on success (optional)
      // setWord('');

    } catch (error) {
      console.error('Error submitting guess:', error);
      setErrorMessage('Something went wrong. Please try again.');
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
  const isButtonDisabled = word.length !== 5 || isLoading;

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top Ticker (Milestone 2.3) */}
      <TopTicker />

      {/* User State (Milestone 4.1) */}
      <div className="px-4 pt-2 pb-0">
        <div className="max-w-md mx-auto">
          <UserState key={userStateKey} fid={fid} />
        </div>
      </div>

      {/* Main Game Container with Layered Wheel */}
      <div className="flex-1 flex items-stretch p-0">
        <div className="max-w-md w-full relative mx-auto" style={{ minHeight: '600px' }}>

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

            {/* Input Area */}
            <div className="relative z-10 w-full px-8">
              <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
                {/* 5-Letter Input Boxes */}
                <div>
                  <input
                    ref={inputRef}
                    type="text"
                    value={word}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="     "
                    className="w-full px-4 py-4 text-4xl font-mono text-center uppercase border-4 border-gray-300 rounded-xl focus:outline-none focus:border-green-500 tracking-[0.5em] bg-gray-50 shadow-lg"
                    maxLength={5}
                    disabled={isLoading}
                    style={{
                      fontWeight: 'bold',
                      letterSpacing: '0.5em',
                    }}
                  />
                  <div className="text-center mt-2">
                    <p className="text-xs text-gray-500 font-semibold">
                      {word.length}/5 letters
                    </p>
                  </div>
                </div>
              </form>

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

              {/* Info footer */}
              <div className="mt-4">
                <p className="text-xs text-gray-400 text-center">
                  Milestone 2.3 - Faux-3D Wheel
                </p>
              </div>
            </div>

          </div>
        </div>
      </div>
    </div>
  );
}
