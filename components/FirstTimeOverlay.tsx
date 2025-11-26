import { useState } from 'react';
import { triggerHaptic } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';

interface FirstTimeOverlayProps {
  onDismiss: () => void;
}

/**
 * FirstTimeOverlay Component
 * Milestone 4.3
 *
 * Full-screen tutorial overlay shown on first visit
 * Explains core game mechanics and rules
 * Prompts user to add mini app for notifications
 */
export default function FirstTimeOverlay({ onDismiss }: FirstTimeOverlayProps) {
  const [isAddingApp, setIsAddingApp] = useState(false);
  const [addAppStatus, setAddAppStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const handleAddMiniApp = async () => {
    setIsAddingApp(true);
    try {
      const result = await sdk.actions.addFrame();
      if (result.added) {
        setAddAppStatus('success');
        triggerHaptic('success');
        // Store notification details if provided
        if (result.notificationDetails) {
          console.log('Mini app added with notifications enabled');
          console.log('Notification URL:', result.notificationDetails.url);
          // Token is managed by Neynar webhook, no need to store client-side
        }
        // Auto-dismiss after successful add
        setTimeout(() => {
          onDismiss();
        }, 1200);
      } else {
        // User rejected or invalid domain - just dismiss
        console.log('Mini app add declined:', result.reason);
        onDismiss();
      }
    } catch (error) {
      console.error('Error adding mini app:', error);
      // On error, just dismiss and let them play
      onDismiss();
    } finally {
      setIsAddingApp(false);
    }
  };

  const handleSkip = () => {
    triggerHaptic('light');
    onDismiss();
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-8 space-y-6 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-bold text-gray-900">
            Let's Have A Word! 💬
          </h1>
          <p className="text-lg text-gray-600">
            Massively multiplayer word hunt
          </p>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200"></div>

        {/* Content */}
        <div className="space-y-5">
          {/* How it works */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              🎯 How it works
            </h2>
            <ul className="space-y-2 text-gray-700">
              <li className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                <span>There's <strong>one hidden 5-letter word</strong> shared by everyone in the world</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                <span>Every wrong guess appears on the <strong>global spinning wheel</strong></span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                <span>The word only changes when someone <strong>guesses it correctly</strong></span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                <span>First correct guesser <strong>wins the ETH jackpot!</strong> 🏆</span>
              </li>
            </ul>
          </div>

          {/* Guesses */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              🎲 Your Guesses
            </h2>
            <ul className="space-y-2 text-gray-700">
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">•</span>
                <span><strong>1 free guess per day</strong> (base)</span>
              </li>
              <li className="flex items-start">
                <span className="text-purple-600 mr-2">•</span>
                <span><strong>+3 free guesses</strong> if you hold ≥100M CLANKTON tokens</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-2">•</span>
                <span><strong>+1 free guess</strong> when you share to Farcaster</span>
              </li>
              <li className="flex items-start">
                <span className="text-gray-600 mr-2">•</span>
                <span>Buy <strong>paid guess packs</strong> (3 guesses for 0.0003 ETH)</span>
              </li>
            </ul>
          </div>

          {/* Jackpot */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              💰 The Jackpot
            </h2>
            <p className="text-gray-700">
              The jackpot grows from paid guesses. When someone wins:
            </p>
            <ul className="space-y-2 text-gray-700 mt-2">
              <li className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                <span><strong>80%</strong> goes to the winner</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                <span><strong>10%</strong> goes to their referrer</span>
              </li>
              <li className="flex items-start">
                <span className="text-green-600 mr-2">•</span>
                <span><strong>10%</strong> split among top 10 guessers</span>
              </li>
            </ul>
          </div>

          {/* Fairness */}
          <div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">
              ✅ Provably Fair
            </h2>
            <p className="text-gray-700 text-sm">
              Each round's word is <strong>pre-committed</strong> with a cryptographic hash before the round starts. This proves the word wasn't changed after anyone guessed.
            </p>
          </div>
        </div>

        {/* Divider */}
        <div className="border-t border-gray-200"></div>

        {/* Action Buttons */}
        <div className="space-y-3">
          {addAppStatus === 'success' ? (
            <div className="w-full py-4 px-6 bg-green-500 text-white text-lg font-bold rounded-xl text-center">
              Added! Let's play!
            </div>
          ) : (
            <>
              <button
                onClick={handleAddMiniApp}
                disabled={isAddingApp}
                className="w-full py-4 px-6 bg-gradient-to-r from-blue-600 to-purple-600 text-white text-lg font-bold rounded-xl hover:from-blue-700 hover:to-purple-700 transition-all shadow-lg disabled:opacity-50"
              >
                {isAddingApp ? 'Adding...' : 'Add to Warpcast & Play'}
              </button>
              <button
                onClick={handleSkip}
                disabled={isAddingApp}
                className="w-full py-2 px-6 text-gray-500 text-sm hover:text-gray-700 transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
            </>
          )}
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-gray-500">
          Adding enables notifications for new rounds
        </p>
      </div>
    </div>
  );
}
