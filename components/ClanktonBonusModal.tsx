import sdk from '@farcaster/miniapp-sdk';
import { haptics } from '../src/lib/haptics';

interface ClanktonBonusModalProps {
  onClose: () => void;
}

// CLANKTON token address on Base
const CLANKTON_TOKEN_ADDRESS = '0x461DEb53515CaC6c923EeD9Eb7eD5Be80F4e0b07';

/**
 * ClanktonBonusModal
 *
 * Explains the CLANKTON holder bonus to users who don't currently hold enough.
 * Opens when user taps the crossed-out "+2 CLANKTON" in the guess bar.
 *
 * - Never auto-opens
 * - No frequency caps or "seen" tracking
 * - Always available on tap
 */
export default function ClanktonBonusModal({ onClose }: ClanktonBonusModalProps) {
  /**
   * Handle learn more - opens CLANKTON token page in Farcaster
   */
  const handleLearnMore = async () => {
    void haptics.buttonTapMinor();

    try {
      // Open the token page via Farcaster SDK
      // Using Warpcast's native token view URL
      await sdk.actions.openUrl({
        url: `https://warpcast.com/~/token/eip155:8453/${CLANKTON_TOKEN_ADDRESS}`,
      });
    } catch (err) {
      // Fallback to standard URL if SDK fails
      console.error('[ClanktonBonusModal] Error opening token page:', err);
      window.open(
        `https://basescan.org/token/${CLANKTON_TOKEN_ADDRESS}`,
        '_blank'
      );
    }

    onClose();
  };

  /**
   * Handle dismiss
   */
  const handleDismiss = () => {
    void haptics.buttonTapMinor();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleDismiss}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="text-center">
          <h2 className="text-2xl font-bold text-gray-900">
            CLANKTON bonus
          </h2>
        </div>

        {/* Body */}
        <div className="text-center space-y-3">
          <p className="text-gray-700">
            Holding ≥100M $CLANKTON unlocks bonus guesses every day
          </p>
          <p className="text-sm text-gray-500">
            Holders receive extra guesses in addition to the free daily guess
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          {/* Primary CTA */}
          <button
            onClick={handleLearnMore}
            className="btn-accent w-full text-lg flex items-center justify-center gap-2"
          >
            <span>Learn how to get CLANKTON →</span>
          </button>

          {/* Secondary: Dismiss */}
          <button
            onClick={handleDismiss}
            className="w-full text-sm text-gray-400 hover:text-gray-500 transition-colors"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
