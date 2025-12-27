import { useState, useEffect } from 'react';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';

interface AnotherGuessModalProps {
  fid: number | null;
  canClaimShareBonus: boolean; // True if user hasn't shared today
  onClose: () => void;
  onShareForGuess: () => void;
  onBuyPacks: () => void;
}

/**
 * AnotherGuessModal
 * Milestone 6.3
 *
 * "Want another guess?" popup shown when user runs out of guesses
 * or after closing the share prompt without sharing.
 *
 * Features:
 * - Random interjection from internationalized list
 * - Share for free guess option (if eligible)
 * - Buy guess packs option
 */
export default function AnotherGuessModal({
  fid,
  canClaimShareBonus,
  onClose,
  onShareForGuess,
  onBuyPacks,
}: AnotherGuessModalProps) {
  const { t, getRandomInterjection } = useTranslation();

  // Get random interjection on mount
  const [interjection, setInterjection] = useState<string>('Shucks!');

  useEffect(() => {
    // Generate random interjection when modal opens
    setInterjection(getRandomInterjection());
  }, [getRandomInterjection]);

  /**
   * Handle share option click
   */
  const handleShareClick = () => {
    void haptics.buttonTapMinor();
    onShareForGuess();
  };

  /**
   * Handle buy packs option click
   */
  const handleBuyPacksClick = () => {
    void haptics.buttonTapMinor();
    onBuyPacks();
  };

  /**
   * Handle not now click
   */
  const handleNotNowClick = () => {
    void haptics.buttonTapMinor();
    onClose();
  };

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
          <p className="text-3xl font-bold text-orange-500 mb-2">
            {interjection}
          </p>
          <h2 className="text-xl font-bold text-gray-900">
            {t('anotherGuess.title')}
          </h2>
        </div>

        {/* Options */}
        <div className="space-y-3">
          {/* Share for free guess - only show if eligible */}
          {canClaimShareBonus && (
            <button
              onClick={handleShareClick}
              className="w-full py-4 px-6 rounded-xl font-semibold text-white transition-all flex items-center justify-center gap-3 active:scale-95 shadow-lg"
              style={{ backgroundColor: '#6A3CFF' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5A2CEF'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6A3CFF'}
            >
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
              <span>{t('anotherGuess.shareOption')}</span>
              <span className="text-green-300 font-bold">+1 FREE</span>
            </button>
          )}

          {/* Buy guess packs */}
          <button
            onClick={handleBuyPacksClick}
            className="w-full py-4 px-6 rounded-xl font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-all flex items-center justify-center gap-3 active:scale-95 shadow-lg"
          >
            <span className="text-xl">💰</span>
            <span>{t('anotherGuess.buyOption')}</span>
          </button>

          {/* Not now */}
          <button
            onClick={handleNotNowClick}
            className="w-full py-3 px-6 rounded-xl font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 transition-all"
          >
            {t('anotherGuess.notNow')}
          </button>
        </div>

        {/* Info text */}
        <p className="text-xs text-gray-500 text-center">
          {canClaimShareBonus
            ? 'Share once per day for a free guess, or buy packs anytime'
            : 'Purchase guess packs to continue playing'}
        </p>
      </div>
    </div>
  );
}
