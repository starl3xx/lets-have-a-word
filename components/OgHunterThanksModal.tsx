/**
 * OG Hunter Thanks Modal
 *
 * Shown to OG Hunters after they've seen the "How it works" tutorial.
 * Features:
 * - Thank-you message
 * - Claim badge button that calls /api/og-hunter/claim
 * - Simple celebration animation on successful claim
 *
 * Post-launch onboarding flow for OG Hunters who completed both steps
 * (added mini app + verified cast) during prelaunch.
 */

import { useState } from 'react';
import confetti from 'canvas-confetti';
import { triggerHaptic } from '../src/lib/haptics';

interface OgHunterThanksModalProps {
  fid: number;
  onDismiss: () => void;
  /** Whether badge was already awarded (show success state immediately) */
  alreadyAwarded?: boolean;
}

type ModalState = 'ready' | 'claiming' | 'claimed' | 'error';

/**
 * Fire a simple confetti burst
 */
function fireCelebration() {
  // Center burst
  confetti({
    particleCount: 80,
    spread: 70,
    origin: { y: 0.6 },
    colors: ['#8B5CF6', '#A78BFA', '#C4B5FD', '#DDD6FE', '#F5D0FE'], // Purple tones
  });
}

export default function OgHunterThanksModal({
  fid,
  onDismiss,
  alreadyAwarded = false,
}: OgHunterThanksModalProps) {
  const [state, setState] = useState<ModalState>(alreadyAwarded ? 'claimed' : 'ready');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleClaim = async () => {
    setState('claiming');
    setErrorMessage(null);

    try {
      const response = await fetch('/api/og-hunter/claim', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid }),
      });

      const data = await response.json();

      if (data.success || data.status?.isAwarded) {
        // Success! (Either newly claimed or already awarded)
        setState('claimed');
        triggerHaptic('success');
        fireCelebration();

        // Log analytics
        fetch('/api/analytics/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            eventType: 'og_hunter_thanks_claimed',
            userId: fid.toString(),
            data: { alreadyAwarded: data.status?.isAwarded && !data.success },
          }),
        }).catch(() => {});
      } else {
        setState('error');
        setErrorMessage(data.error || 'Failed to claim badge');
      }
    } catch (error) {
      console.error('[OgHunterThanksModal] Claim error:', error);
      setState('error');
      setErrorMessage('Network error. Please try again.');
    }
  };

  const handleDismiss = () => {
    triggerHaptic('light');
    onDismiss();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleDismiss}
    >
      <div
        className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {state === 'claimed' ? (
          // Claimed state - celebration!
          <>
            <div className="text-center">
              {/* Badge with pop animation */}
              <div className="relative inline-block">
                <div className="w-20 h-20 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4 animate-badge-pop">
                  <span className="text-4xl" role="img" aria-label="OG Hunter">🕵️‍♂️</span>
                </div>
              </div>

              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                You're an OG Hunter!
              </h2>
              <p className="text-gray-600 text-sm mb-1">
                Your badge and +500 XP have been added to your profile.
              </p>
              <p className="text-purple-600 text-sm font-medium">
                Thanks for being an early supporter! 💜
              </p>
            </div>

            <button
              onClick={handleDismiss}
              className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-xl font-semibold transition-colors"
            >
              Let's play!
            </button>
          </>
        ) : (
          // Ready / claiming / error states
          <>
            <div className="text-center">
              <div className="w-16 h-16 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-3xl" role="img" aria-label="OG Hunter">🕵️‍♂️</span>
              </div>

              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                Hey, OG Hunter!
              </h2>
              <p className="text-gray-600">
                Thanks for helping kick off Let's Have A Word.
                Your OG Hunter badge is ready.
              </p>
            </div>

            {/* Error message */}
            {state === 'error' && errorMessage && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
                {errorMessage}
              </div>
            )}

            {/* Reward preview */}
            <div className="bg-purple-50 rounded-xl p-4">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                  <span className="text-2xl">🏆</span>
                </div>
                <div>
                  <div className="font-semibold text-purple-900">OG Hunter Badge</div>
                  <div className="text-sm text-purple-600">+500 XP</div>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleClaim}
                disabled={state === 'claiming'}
                className="w-full px-4 py-3 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 disabled:from-purple-300 disabled:to-blue-300 text-white rounded-xl font-semibold transition-all shadow-lg shadow-purple-200"
              >
                {state === 'claiming' ? 'Claiming...' : 'Claim my badge'}
              </button>

              <button
                onClick={handleDismiss}
                disabled={state === 'claiming'}
                className="w-full px-4 py-2 text-gray-500 hover:text-gray-700 text-sm transition-colors"
              >
                Not now
              </button>
            </div>
          </>
        )}
      </div>

      {/* CSS animation for badge pop */}
      <style jsx>{`
        @keyframes badge-pop {
          0% {
            transform: scale(0.6) rotate(-10deg);
            opacity: 0;
          }
          50% {
            transform: scale(1.1) rotate(5deg);
          }
          70% {
            transform: scale(0.95) rotate(-2deg);
          }
          100% {
            transform: scale(1) rotate(0deg);
            opacity: 1;
          }
        }
        .animate-badge-pop {
          animation: badge-pop 0.6s ease-out forwards;
        }
      `}</style>
    </div>
  );
}
