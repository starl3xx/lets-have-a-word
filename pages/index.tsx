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
          if (data && data.words) {
            setWheelWords(data.words);
          }
        }
      } catch (error) {
        console.error('Error fetching wheel words:', error);
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
        const wheelResponse = await fetch('/api/wheel');
        if (wheelResponse.ok) {
          const wheelData = await wheelResponse.json();
          if (wheelData && wheelData.words) {
            setWheelWords(wheelData.words);
          }
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

      {/* Main Content */}
      <div className="flex-1 flex items-start justify-center p-4 pt-8">
        <div className="max-w-5xl w-full grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Left Column: Guess Form */}
          <div className="bg-white rounded-lg shadow-md p-8">
        {/* Title */}
        <h1 className="text-3xl font-bold text-center text-gray-900 mb-2">
          Let's Have A Word
        </h1>

        {/* Subtitle */}
        <p className="text-center text-gray-600 mb-8">
          Guess the secret 5-letter word
        </p>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Input */}
          <div>
            <input
              type="text"
              value={word}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              placeholder="Enter word"
              className="w-full px-4 py-3 text-2xl font-mono text-center uppercase border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 tracking-widest"
              maxLength={5}
              autoFocus
              disabled={isLoading}
            />
            <p className="text-xs text-gray-500 text-center mt-2">
              {word.length}/5 letters
            </p>
          </div>

          {/* Button */}
          <button
            type="submit"
            disabled={isButtonDisabled}
            className={`w-full py-3 px-4 rounded-lg font-semibold text-white transition-colors ${
              isButtonDisabled
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800'
            }`}
          >
            {isLoading ? 'Submitting...' : 'Guess'}
          </button>
        </form>

        {/* Feedback area */}
        <div className="mt-6 min-h-[60px]">
          {/* Error message */}
          {errorMessage && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-600 text-center">{errorMessage}</p>
            </div>
          )}

          {/* Result feedback */}
          {feedback && !errorMessage && (
            <div className={`bg-gray-50 border border-gray-200 rounded-lg p-4`}>
              <p className={`${feedback.color} text-center font-medium`}>
                {feedback.text}
              </p>
            </div>
          )}
        </div>

        {/* Info footer */}
        <div className="mt-8 pt-6 border-t border-gray-200">
          <p className="text-xs text-gray-500 text-center">
            Milestone 2.3 - Wheel + Visual State
            <br />
            Everyone in the world is guessing the same word
          </p>
        </div>
          </div>

          {/* Right Column: Wheel (Milestone 2.3) */}
          <div className="bg-white rounded-lg shadow-md p-8">
            {isLoadingWheel ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 animate-pulse">Loading wheel...</p>
              </div>
            ) : (
              <Wheel words={wheelWords} currentGuess={word} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
