import sdk from '@farcaster/miniapp-sdk';
import { haptics } from '../src/lib/haptics';
import { withHostTimeout } from '../src/lib/hostActions';
import { useIsInMiniApp } from '../src/hooks/useIsInMiniApp';
import { WORD_BASE_APP_URL } from '../config/economy';

interface WordBonusModalProps {
  onClose: () => void;
}

// $WORD token address on Base
const WORD_TOKEN_ADDRESS = '0x304e649e69979298BD1AEE63e175ADf07885fb4b';

/**
 * WordBonusModal
 *
 * Explains the $WORD holder bonus to users who don't currently hold enough.
 * Opens when user taps the crossed-out "+2 $WORD" in the guess bar.
 *
 * - Never auto-opens
 * - No frequency caps or "seen" tracking
 * - Always available on tap
 */
export default function WordBonusModal({ onClose }: WordBonusModalProps) {
  const { inMiniApp, resolved } = useIsInMiniApp();

  /**
   * Handle learn more - opens the $WORD token page.
   *
   * Off-host `viewToken` NEVER SETTLES, so the old unbounded await made BOTH
   * the catch fallback and the `onClose()` below it unreachable: tapping this
   * left the modal open forever with no token page and no way back. Branch
   * before calling, exactly as components/word/BuyButton.tsx does, and send
   * those players to the token's page on Base — where their wallet already is,
   * one tap from a trade — rather than to a Basescan contract page.
   */
  const handleLearnMore = async () => {
    void haptics.buttonTapMinor();

    if (!inMiniApp && (resolved || !(await sdk.isInMiniApp()))) {
      window.open(WORD_BASE_APP_URL, '_blank', 'noopener,noreferrer');
      onClose();
      return;
    }

    try {
      // Open the token page via Farcaster SDK viewToken action
      await withHostTimeout(
        sdk.actions.viewToken({
          token: `eip155:8453/erc20:${WORD_TOKEN_ADDRESS}`,
        }),
        'viewToken'
      );
    } catch (err) {
      // Fallback to standard URL if SDK fails
      console.error('[WordBonusModal] Error opening token page:', err);
      window.open(WORD_BASE_APP_URL, '_blank', 'noopener,noreferrer');
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
        {/* Header with Logo */}
        <div className="text-center">
          {/* $WORD Logo */}
          <div className="flex justify-center mb-3">
            <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-purple-200 bg-white">
              <img
                src="/word-token-logo.png"
                alt="$WORD"
                className="w-full h-full object-cover"
              />
            </div>
          </div>
          <h2 className="text-2xl font-bold text-gray-900">
            $WORD bonus
          </h2>
        </div>

        {/* Body */}
        <div className="text-center space-y-3">
          <p className="text-gray-700">
            Holding ≥100M $WORD unlocks bonus guesses every day
          </p>
          <p className="text-sm text-gray-500">
            Holders receive extra guesses in addition to the free daily guess 😏
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3">
          {/* Primary CTA */}
          <button
            onClick={handleLearnMore}
            className="w-full text-lg flex items-center justify-center gap-2 py-3 px-4 rounded-xl text-white font-semibold transition-colors"
            style={{ backgroundColor: '#8268ce' }}
          >
            <span>Learn how to get $WORD →</span>
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
