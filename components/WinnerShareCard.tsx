import { useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import { haptics } from '../src/lib/haptics';
import { useTranslation } from '../src/hooks/useTranslation';

interface WinnerShareCardProps {
  winnerWord: string;
  roundId: number;
  jackpotEth?: string; // Milestone 6.3: Jackpot amount
  onClose: () => void;
}

/**
 * WinnerShareCard
 * Milestone 4.14, Updated Milestone 6.3, 6.8
 *
 * Shows a celebration card when user wins the round
 * Includes Farcaster + X (Twitter) share options
 *
 * Milestone 6.3 enhancements:
 * - Brand color palette
 * - Jackpot amount display
 * - Round number display
 * - Haptics on save/download
 *
 * Milestone 6.8: Removed CLANKTON references from modal
 */
export default function WinnerShareCard({
  winnerWord,
  roundId,
  jackpotEth = '0.00',
  onClose,
}: WinnerShareCardProps) {
  const { t } = useTranslation();
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jackpotDisplay = parseFloat(jackpotEth).toFixed(4);
  const shareText = `I just hit the ${jackpotDisplay} ETH jackpot on Let's Have A Word! 🎉🟩\n\nI found the winning word "${winnerWord}" in round #${roundId}!\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;

  /**
   * Share to Farcaster
   */
  const handleShareToFarcaster = async () => {
    void haptics.buttonTapMinor();
    setIsSharing(true);
    setError(null);

    try {
      console.log('[WinnerShareCard] Opening Farcaster composer with text:', shareText);

      // Open Farcaster composer with prefilled text
      const result = await sdk.actions.openUrl({
        url: `https://warpcast.com/~/compose?text=${encodeURIComponent(shareText)}`,
      });

      if (result && result.reason) {
        console.log('[WinnerShareCard] Farcaster share result:', result.reason);
      }

      // Note: We don't close the modal automatically - let user decide when to dismiss
    } catch (err) {
      console.error('[WinnerShareCard] Error sharing to Farcaster:', err);
      setError('Failed to open Farcaster composer');
    } finally {
      setIsSharing(false);
    }
  };

  /**
   * Share to X (Twitter)
   */
  const handleShareToX = () => {
    void haptics.buttonTapMinor();
    setError(null);

    try {
      const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`;
      console.log('[WinnerShareCard] Opening X/Twitter composer with URL:', twitterUrl);

      // Open in new window/tab
      if (typeof window !== 'undefined') {
        window.open(twitterUrl, '_blank', 'noopener,noreferrer');
      }
    } catch (err) {
      console.error('[WinnerShareCard] Error sharing to X:', err);
      setError('Failed to open X composer');
    }
  };

  /**
   * Handle save/download share card (placeholder for future canvas export)
   */
  const handleSaveCard = () => {
    void haptics.cardSaved();
    // TODO: Implement canvas-based share card export
    console.log('[WinnerShareCard] Save card triggered');
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-60 z-50"
        onClick={onClose}
        style={{ backdropFilter: 'blur(4px)' }}
      />

      {/* Modal Card */}
      <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
        <div
          className="bg-gradient-to-br from-purple-600 via-purple-700 to-indigo-800 rounded-2xl shadow-2xl max-w-md w-full p-6 relative overflow-hidden"
          onClick={(e) => e.stopPropagation()}
          style={{ fontSmooth: 'always', WebkitFontSmoothing: 'antialiased' }}
        >
          {/* Background pattern */}
          <div className="absolute inset-0 opacity-10">
            <div className="absolute inset-0" style={{
              backgroundImage: 'radial-gradient(circle at 25% 25%, white 2px, transparent 2px)',
              backgroundSize: '30px 30px'
            }} />
          </div>

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl leading-none z-10"
          >
            ×
          </button>

          {/* Round number badge */}
          <div className="absolute top-4 left-4 bg-white/20 backdrop-blur-sm px-3 py-1 rounded-full">
            <span className="text-xs text-white font-medium">Round #{roundId}</span>
          </div>

          {/* Winner Celebration */}
          <div className="text-center mb-6 relative z-10">
            {/* Celebration emoji */}
            <div className="text-7xl mb-4">🎉</div>

            <h2 className="text-3xl font-bold text-white mb-2" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.2)' }}>
              {t('winner.congratulations')}
            </h2>

            {/* Winning word display */}
            <div className="bg-white/20 backdrop-blur-sm rounded-xl p-4 mb-4">
              <p className="text-white/80 text-sm mb-2">{t('winner.foundWord')}</p>
              <p className="text-4xl font-bold text-white tracking-widest uppercase" style={{ textShadow: '0 2px 4px rgba(0,0,0,0.3)' }}>
                {winnerWord}
              </p>
            </div>

            {/* Jackpot amount */}
            <div className="bg-gradient-to-r from-yellow-400 to-orange-500 rounded-xl p-4 shadow-lg">
              <p className="text-yellow-900 text-sm font-medium mb-1">Jackpot Won</p>
              <p className="text-3xl font-bold text-yellow-900">
                {jackpotDisplay} ETH
              </p>
            </div>
          </div>

          {/* Share Section */}
          <div className="space-y-3 relative z-10">
            <p className="text-sm text-white/80 text-center mb-4">
              {t('winner.shareVictory')}
            </p>

            {/* Farcaster Share Button */}
            <button
              onClick={handleShareToFarcaster}
              disabled={isSharing}
              className="w-full py-4 px-6 rounded-xl font-bold text-white active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
              style={{ backgroundColor: '#6A3CFF' }}
              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = '#5A2CEF'}
              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = '#6A3CFF'}
            >
              <img src="/FC-arch-icon.png" alt="Farcaster" className="w-3 h-3" />
              <span>{t('winner.shareOnFarcaster')}</span>
            </button>

            {/* X (Twitter) Share Button */}
            <button
              onClick={handleShareToX}
              disabled={isSharing}
              className="w-full py-4 px-6 rounded-xl font-bold text-white bg-black hover:bg-gray-800 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-3"
            >
              <span className="text-xl">𝕏</span>
              <span>{t('winner.shareOnX')}</span>
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 p-3 bg-red-500/20 border border-red-300/30 rounded-lg relative z-10">
              <p className="text-white text-sm text-center">{error}</p>
            </div>
          )}

          {/* Close button (bottom) */}
          <button
            onClick={onClose}
            className="mt-6 w-full py-3 px-6 rounded-xl font-semibold text-white/90 bg-white/10 hover:bg-white/20 active:scale-95 transition-all relative z-10"
          >
            {t('common.close')}
          </button>
        </div>
      </div>
    </>
  );
}
