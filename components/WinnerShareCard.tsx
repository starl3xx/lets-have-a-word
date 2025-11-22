import { useState } from 'react';
import sdk from '@farcaster/miniapp-sdk';
import { haptics } from '../src/lib/haptics';

interface WinnerShareCardProps {
  winnerWord: string;
  roundId: number;
  onClose: () => void;
}

/**
 * WinnerShareCard
 * Milestone 4.14
 *
 * Shows a celebration card when user wins the round
 * Includes Farcaster + X (Twitter) share options
 */
export default function WinnerShareCard({
  winnerWord,
  roundId,
  onClose,
}: WinnerShareCardProps) {
  const [isSharing, setIsSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shareText = `I just hit the ETH jackpot on Let's Have A Word! 🎉🟩\n\nI found the winning word "${winnerWord}" in round #${roundId}!\n\n@letshaveaword\nhttps://lets-have-a-word.vercel.app`;

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
          className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 relative"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>

          {/* Winner Celebration */}
          <div className="text-center mb-6">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              Congratulations!
            </h2>
            <p className="text-gray-600 mb-4">
              You found the winning word <span className="font-bold text-green-600">{winnerWord}</span> and won the ETH jackpot! 🟩
            </p>
          </div>

          {/* Share Section */}
          <div className="space-y-3">
            <p className="text-sm text-gray-600 text-center mb-4">
              Share your victory:
            </p>

            {/* Farcaster Share Button */}
            <button
              onClick={handleShareToFarcaster}
              disabled={isSharing}
              className="w-full py-3 px-6 rounded-xl font-semibold text-white bg-purple-600 hover:bg-purple-700 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span className="text-xl">🎯</span>
              <span>Share on Farcaster</span>
            </button>

            {/* X (Twitter) Share Button */}
            <button
              onClick={handleShareToX}
              disabled={isSharing}
              className="w-full py-3 px-6 rounded-xl font-semibold text-white bg-black hover:bg-gray-800 active:scale-95 transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              <span className="text-xl">𝕏</span>
              <span>Share on X</span>
            </button>
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-600 text-sm text-center">{error}</p>
            </div>
          )}

          {/* Close button (bottom) */}
          <button
            onClick={onClose}
            className="mt-6 w-full py-3 px-6 rounded-xl font-semibold text-gray-700 bg-gray-100 hover:bg-gray-200 active:scale-95 transition-all"
          >
            Close
          </button>
        </div>
      </div>
    </>
  );
}
