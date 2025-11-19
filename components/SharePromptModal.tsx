import { useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import type { SubmitGuessResult } from '../src/types';

interface SharePromptModalProps {
  fid: number | null;
  guessResult: SubmitGuessResult;
  onClose: () => void;
  onShareSuccess: () => void;
}

/**
 * SharePromptModal
 * Milestone 4.2
 *
 * Prompts user to share their guess to Farcaster to earn +1 free guess
 * Shows after each guess (correct or incorrect)
 * Only shows if share bonus hasn't been claimed today
 */
export default function SharePromptModal({
  fid,
  guessResult,
  onClose,
  onShareSuccess,
}: SharePromptModalProps) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Get the guessed word from the result
   */
  const getGuessedWord = (): string | null => {
    if (guessResult.status === 'incorrect' || guessResult.status === 'correct') {
      return guessResult.word;
    }
    return null;
  }

  /**
   * Get the global guess number for this user's round
   */
  const getGuessNumber = (): number | null => {
    if (guessResult.status === 'incorrect') {
      return guessResult.totalGuessesForUserThisRound;
    }
    // For correct guesses, we don't have this data yet
    // TODO: Add to API response
    return null;
  }

  /**
   * Get the round ID
   */
  const getRoundId = (): number | null => {
    if (guessResult.status === 'correct') {
      return guessResult.roundId;
    }
    // For incorrect guesses, we don't have this data yet
    // TODO: Add to API response
    return null;
  }

  /**
   * Handle share button click
   * Opens Farcaster composer with prefilled text
   */
  const handleShare = async () => {
    if (!fid) {
      setError('Unable to share: Not authenticated');
      return;
    }

    const word = getGuessedWord();
    if (!word) {
      setError('Unable to share: No guess found');
      return;
    }

    setIsSharing(true);
    setError(null);

    try {
      // Build share text
      const guessNumber = getGuessNumber();
      const roundId = getRoundId();

      let shareText: string;
      if (guessNumber && roundId) {
        shareText = `My guess "${word}" was #${guessNumber} in round #${roundId} of Let's Have A Word!\n\nEvery guess helps narrow the field — and one person wins the ETH jackpot! 🎯\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;
      } else {
        // Fallback if we don't have round data
        shareText = `My guess "${word}" in Let's Have A Word!\n\nEvery guess helps narrow the field — and one person wins the ETH jackpot! 🎯\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;
      }

      console.log('[SharePromptModal] Opening composer with text:', shareText);

      // Open Farcaster composer with prefilled text
      const result = await sdk.actions.openUrl({
        url: `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}`,
      });

      console.log('[SharePromptModal] Composer result:', result);

      // Note: Since we can't reliably detect if the cast was actually published
      // (openUrl doesn't return cast hash), we'll give the benefit of the doubt
      // and call the share callback after a brief delay
      setTimeout(async () => {
        try {
          // Call share callback API
          const response = await fetch('/api/share-callback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fid,
              castHash: 'unknown', // We don't have access to the cast hash from openUrl
            }),
          });

          const data = await response.json();

          if (data.ok) {
            console.log('[SharePromptModal] Share bonus awarded!', data);
            onShareSuccess();
            onClose();
          } else {
            console.log('[SharePromptModal] Share bonus not awarded:', data.message);
            setError(data.message || 'Share bonus already claimed');
          }
        } catch (err) {
          console.error('[SharePromptModal] Error calling share callback:', err);
          setError('Failed to verify share');
        } finally {
          setIsSharing(false);
        }
      }, 2000); // 2 second delay to allow user to cast
    } catch (err) {
      console.error('[SharePromptModal] Error opening composer:', err);
      setError('Failed to open share dialog');
      setIsSharing(false);
    }
  };

  const word = getGuessedWord();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6 space-y-4">
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            Want another free guess?
          </h2>
        </div>

        {/* Content */}
        <div className="text-center space-y-3">
          <p className="text-gray-700">
            Share your guess <span className="font-bold">{word}</span> to Farcaster
            to unlock <span className="font-bold text-green-600">+1 free guess</span> today!
          </p>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded p-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          <button
            onClick={handleShare}
            disabled={isSharing}
            className={`w-full py-3 px-4 rounded-lg font-semibold text-white transition-all ${
              isSharing
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700'
            }`}
          >
            {isSharing ? 'Sharing...' : 'Share to Farcaster'}
          </button>

          <button
            onClick={onClose}
            disabled={isSharing}
            className="w-full py-3 px-4 rounded-lg font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Not now
          </button>
        </div>

        {/* Info */}
        <p className="text-xs text-gray-500 text-center">
          Share bonus can only be earned once per day
        </p>
      </div>
    </div>
  );
}
