import { useState } from 'react';
import { triggerHaptic } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';

interface FirstTimeOverlayProps {
  onDismiss: () => void;
  /** Start directly at tutorial phase (skip add-app prompt) */
  tutorialOnly?: boolean;
}

type OverlayPhase = 'add-app' | 'tutorial';

/**
 * FirstTimeOverlay Component
 *
 * Two-phase first-time user experience:
 * 1. Prompt to add mini app to Farcaster (enables notifications)
 * 2. Simple "How the game works" tutorial
 *
 * Can also be shown in tutorial-only mode via the info icon.
 *
 * Positioned as an overlay within the game container,
 * covering the area from guess bar to guess button.
 */
export default function FirstTimeOverlay({ onDismiss, tutorialOnly = false }: FirstTimeOverlayProps) {
  const [phase, setPhase] = useState<OverlayPhase>(tutorialOnly ? 'tutorial' : 'add-app');
  const [isAddingApp, setIsAddingApp] = useState(false);

  const handleAddMiniApp = async () => {
    setIsAddingApp(true);
    try {
      const result = await sdk.actions.addMiniApp();
      // Success - notificationDetails may be present if notifications were enabled
      if (result.notificationDetails) {
        console.log('Mini app added with notifications enabled');
      }
      triggerHaptic('success');
      // Move to tutorial
      setPhase('tutorial');
    } catch (error) {
      // User rejected or invalid domain - move to tutorial anyway
      // Errors are AddMiniApp.RejectedByUser or AddMiniApp.InvalidDomainManifest
      console.log('Mini app add declined:', error);
      setPhase('tutorial');
    } finally {
      setIsAddingApp(false);
    }
  };

  const handleSkipAdd = () => {
    triggerHaptic('light');
    setPhase('tutorial');
  };

  const handleReady = () => {
    triggerHaptic('light');
    onDismiss();
  };

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
      onClick={onDismiss}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'add-app' ? (
          // Phase 1: Add to Farcaster
          <>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-gray-900">
                Welcome!
              </h2>
              <p className="text-gray-600">
                Add this app to get notified when new rounds begin — each round has a jackpot!
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleAddMiniApp}
                disabled={isAddingApp}
                className="w-full py-4 px-6 text-white text-lg font-bold rounded-xl transition-all shadow-lg disabled:opacity-50 active:scale-95"
                style={{ backgroundColor: '#2D68C7' }}
              >
                {isAddingApp ? 'Adding...' : 'Add to Farcaster'}
              </button>
              <button
                onClick={handleSkipAdd}
                disabled={isAddingApp}
                className="w-full py-2 px-6 text-gray-500 text-sm hover:text-gray-700 transition-colors disabled:opacity-50"
              >
                Skip for now
              </button>
            </div>
          </>
        ) : (
          // Phase 2: Tutorial
          <>
            <h2 className="text-xl font-bold text-gray-900 text-center">
              How the game works
            </h2>

            <ul className="space-y-4 text-gray-700">
              <li className="flex items-start">
                <span className="text-blue-600 mr-3 mt-0.5 flex-shrink-0">&#x2022;</span>
                <span>Everyone is hunting the same secret word. The first person to find it wins the jackpot.</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-3 mt-0.5 flex-shrink-0">&#x2022;</span>
                <span>You get 1 free guess per day. Additional guesses can be earned or purchased.</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-3 mt-0.5 flex-shrink-0">&#x2022;</span>
                <span>Every incorrect guess helps everyone else by removing that word from play.</span>
              </li>
              <li className="flex items-start">
                <span className="text-blue-600 mr-3 mt-0.5 flex-shrink-0">&#x2022;</span>
                <span><span className="text-red-600 font-medium">Red</span> words have already been guessed. <span className="font-medium">Black</span> words are still available.</span>
              </li>
            </ul>

            <button
              onClick={handleReady}
              className="w-full py-4 px-6 text-white text-lg font-bold rounded-xl transition-all shadow-lg active:scale-95"
              style={{ backgroundColor: '#2D68C7' }}
            >
              I’m ready! 👉
            </button>
          </>
        )}
      </div>
    </div>
  );
}
