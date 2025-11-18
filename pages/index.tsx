import { useState, useEffect, FormEvent, ChangeEvent, KeyboardEvent } from 'react';
import type { SubmitGuessResult } from '../src/types';
import TopTicker from '../components/TopTicker';
import Wheel from '../components/Wheel';

export default function Home() {
  const [word, setWord] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<SubmitGuessResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Wheel state (Milestone 2.3)
  const [wheelWords, setWheelWords] = useState<string[]>([]);
  const [isLoadingWheel, setIsLoadingWheel] = useState(true);

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
   * Handle Enter key press
   */
  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && word.length === 5 && !isLoading) {
      handleSubmit(e as any);
    }
  };

  /**
   * Submit guess to backend
   */
  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

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
      // For Milestone 2.1: In development mode (no NEYNAR_API_KEY), send devFid
      // In production, the Farcaster SDK will provide frameMessage or signerUuid
      const requestBody: any = { word };

      // Development mode: use a test FID (when not in a Farcaster context)
      // In production, this will be replaced by Farcaster frame/miniapp authentication
      if (process.env.NODE_ENV === 'development') {
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

            {/* White mask behind input boxes for visibility */}
            <div
              className="absolute"
              style={{
                top: '35%',
                left: '50%',
                transform: 'translate(-50%, -50%)',
                width: '100%',
                height: '140px',
                background: 'rgba(255, 255, 255, 0.92)',
                backdropFilter: 'blur(8px)',
                borderRadius: '16px',
                zIndex: 0,
              }}
            />

            {/* Input Area (on top of mask) */}
            <div className="relative z-10 w-full px-8">
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* 5-Letter Input Boxes */}
                <div>
                  <input
                    type="text"
                    value={word}
                    onChange={handleChange}
                    onKeyDown={handleKeyDown}
                    placeholder="     "
                    className="w-full px-4 py-4 text-4xl font-mono text-center uppercase border-4 border-gray-300 rounded-xl focus:outline-none focus:border-green-500 tracking-[0.5em] bg-white shadow-lg"
                    maxLength={5}
                    autoFocus
                    disabled={isLoading}
                    style={{
                      fontWeight: 'bold',
                      letterSpacing: '0.5em',
                    }}
                  />
                  <p className="text-xs text-gray-500 text-center mt-2 font-semibold">
                    {word.length}/5 letters
                  </p>
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
                type="submit"
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
