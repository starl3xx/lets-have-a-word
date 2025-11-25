import { useState, useMemo } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import type { SubmitGuessResult } from '../src/types';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';

interface SharePromptModalProps {
  fid: number | null;
  guessResult?: SubmitGuessResult; // Optional - if not provided, use generic share text
  onClose: () => void;
  onShareSuccess: () => void;
}

/**
 * SharePromptModal
 * Milestone 4.2, Updated Milestone 6.3
 *
 * Prompts user to share to Farcaster to earn +1 free guess.
 * - Shows after incorrect guesses (with guess context)
 * - Can also be triggered directly (without guess context)
 * - Only Farcaster users can claim share bonus
 * - Share bonus can only be earned once per day
 *
 * Updated spec:
 * - Title: "[Interjection] Want another guess?"
 * - Body: "Share your guess [WORD] to unlock +1 free guess today!"
 * - Primary button: "Share" with arch icon
 * - Secondary button: "Not now"
 * - Footer: "Share bonus can only be earned once per day (Farcaster only)"
 */
export default function SharePromptModal({
  fid,
  guessResult,
  onClose,
  onShareSuccess,
}: SharePromptModalProps) {
  const { t, getRandomInterjection } = useTranslation();
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Get random interjection once when modal mounts (memoized)
  const interjection = useMemo(() => getRandomInterjection(), [getRandomInterjection]);

  /**
   * Get the guessed word from the result (if available)
   */
  const getGuessedWord = (): string | null => {
    if (!guessResult) return null;
    if (guessResult.status === 'incorrect' || guessResult.status === 'correct') {
      return guessResult.word;
    }
    return null;
  };

  /**
   * Get the global guess number for this user's round
   */
  const getGuessNumber = (): number | null => {
    if (!guessResult) return null;
    if (guessResult.status === 'incorrect') {
      return guessResult.totalGuessesForUserThisRound;
    }
    return null;
  };

  /**
   * Get the round ID
   */
  const getRoundId = (): number | null => {
    if (!guessResult) return null;
    if (guessResult.status === 'correct') {
      return guessResult.roundId;
    }
    return null;
  };

  /**
   * Handle share button click
   * Opens Farcaster composer with prefilled text
   */
  const handleShare = async () => {
    if (!fid) {
      setError('Unable to share: Not authenticated');
      return;
    }

    void haptics.buttonTapMinor();
    setIsSharing(true);
    setError(null);

    try {
      // Build share text
      const word = getGuessedWord();
      const guessNumber = getGuessNumber();
      const roundId = getRoundId();

      let shareText: string;

      if (word && guessNumber && roundId) {
        // Context-rich share (after a guess)
        shareText = `My guess "${word}" was #${guessNumber} in round #${roundId} of Let's Have A Word!\n\nEvery guess helps narrow the field — and one person wins the ETH jackpot! 🎯\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;
      } else if (word) {
        // Share with word but limited context
        shareText = `My guess "${word}" in Let's Have A Word!\n\nEvery guess helps narrow the field — and one person wins the ETH jackpot! 🎯\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;
      } else {
        // Generic share text (Milestone 6.3 spec)
        shareText = `I'm playing Let's Have A Word! 🔤\n\nDaily jackpot-based word puzzle on Base.\n\nhttps://lets-have-a-word.vercel.app`;
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
            void haptics.shareCompleted();
            onShareSuccess();
            onClose();
          } else {
            console.log('[SharePromptModal] Share bonus not awarded:', data.message);
            setError(data.message || t('shareForGuess.alreadyClaimed'));
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
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with interjection */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            {interjection} {t('shareForGuess.titleSuffix')}
          </h2>
          <p className="text-gray-600 mt-3">
            {word
              ? t('shareForGuess.description', { word: word.toUpperCase() })
              : 'Share to unlock +1 free guess today!'}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-600 text-center">{error}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          {/* Primary CTA button - Share with arch icon */}
          <button
            onClick={handleShare}
            disabled={isSharing}
            className="w-full py-4 px-6 rounded-xl font-bold text-white text-lg transition-all flex items-center justify-center gap-3 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95 shadow-lg"
            style={{
              backgroundColor: isSharing ? '#9ca3af' : '#6A3CFF',
            }}
            onMouseEnter={(e) => {
              if (!isSharing) e.currentTarget.style.backgroundColor = '#5A2CEF';
            }}
            onMouseLeave={(e) => {
              if (!isSharing) e.currentTarget.style.backgroundColor = '#6A3CFF';
            }}
          >
            {!isSharing && <img src="/FC-arch-icon.png" alt="Farcaster" className="w-6 h-6" />}
            <span>
              {isSharing ? t('shareForGuess.sharing') : t('shareForGuess.ctaButton')}
            </span>
          </button>

          {/* Secondary button - Not now */}
          <button
            onClick={onClose}
            disabled={isSharing}
            className="w-full py-3 px-6 rounded-xl font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {t('anotherGuess.notNow')}
          </button>
        </div>

        {/* Footer info */}
        <p className="text-xs text-gray-500 text-center">
          {t('shareForGuess.footer')}
        </p>
      </div>
    </div>
  );
}
