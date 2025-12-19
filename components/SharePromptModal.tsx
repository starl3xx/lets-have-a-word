import { useState, useMemo } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import type { SubmitGuessResult } from '../src/types';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';

interface SharePromptModalProps {
  fid: number | null;
  guessResult?: SubmitGuessResult;
  onClose: () => void;
  onShareSuccess: () => void;
}

/**
 * SharePromptModal
 * Milestone 4.2, Updated Milestone 6.3, Updated Milestone 7.0
 *
 * Prompts user to share to Farcaster to earn +1 free guess.
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent button styling
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

  // Get random interjection once when modal mounts
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
      const word = getGuessedWord();
      const guessNumber = getGuessNumber();
      const roundId = getRoundId();

      let shareText: string;

      if (word && guessNumber && roundId) {
        shareText = `My guess "${word}" was #${guessNumber} in round #${roundId} of Let's Have A Word!\n\nEvery guess helps narrow the field — and one person wins the ETH jackpot! 🎯\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;
      } else if (word) {
        shareText = `My guess "${word}" in Let's Have A Word!\n\nEvery guess helps narrow the field — and one person wins the ETH jackpot! 🎯\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;
      } else {
        shareText = `I'm playing Let's Have A Word! 🔤\n\nDaily jackpot-based word puzzle on Base.\n\nhttps://lets-have-a-word.vercel.app`;
      }

      console.log('[SharePromptModal] Opening composer with text:', shareText);

      const result = await sdk.actions.openUrl({
        url: `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}`,
      });

      console.log('[SharePromptModal] Composer result:', result);

      setTimeout(async () => {
        try {
          const response = await fetch('/api/share-callback', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              fid,
              castHash: 'unknown',
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
      }, 2000);
    } catch (err) {
      console.error('[SharePromptModal] Error opening composer:', err);
      setError('Failed to open share dialog');
      setIsSharing(false);
    }
  };

  const word = getGuessedWord();

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with interjection */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            {interjection} {t('shareForGuess.titleSuffix')}
          </h2>
          <p className="text-gray-600 mt-3">
            {word ? (
              <>
                Share your guess <span className="font-bold">{word.toUpperCase()}</span> to unlock{' '}
                <span className="font-bold text-success-600">+1 free guess</span> today!
              </>
            ) : (
              <>
                Share to unlock <span className="font-bold text-success-600">+1 free guess</span> today!
              </>
            )}
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-error-50 border border-error-200 rounded-btn p-3">
            <p className="text-sm text-error-700 text-center">{error}</p>
          </div>
        )}

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          {/* Primary CTA button */}
          <button
            onClick={handleShare}
            disabled={isSharing}
            className={`btn-accent w-full text-lg flex items-center justify-center gap-3 ${
              isSharing ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {!isSharing && <img src="/FC-arch-icon.png" alt="Farcaster" className="w-5 h-5" />}
            <span>
              {isSharing ? t('shareForGuess.sharing') : t('shareForGuess.ctaButton')}
            </span>
          </button>

          {/* Secondary button */}
          <button
            onClick={onClose}
            disabled={isSharing}
            className="btn-secondary w-full"
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
