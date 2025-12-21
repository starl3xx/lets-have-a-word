import { useState, useEffect } from 'react';
import { triggerHaptic } from '../src/lib/haptics';
import sdk from '@farcaster/miniapp-sdk';

interface FirstTimeOverlayProps {
  onDismiss: () => void;
  /** Start directly at tutorial phase and skip add-app prompt entirely */
  tutorialOnly?: boolean;
  /** User's FID for analytics tracking */
  fid?: number;
}

type OverlayPhase = 'tutorial' | 'add-app';

/**
 * Helper to log analytics events (fire-and-forget)
 */
function logOnboardingEvent(
  eventType: string,
  fid?: number,
  data?: Record<string, any>
) {
  fetch('/api/analytics/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType,
      userId: fid?.toString(),
      data,
    }),
  }).catch(() => {
    // Silently ignore - analytics should never block UI
  });
}

/**
 * FirstTimeOverlay Component
 * Updated Milestone 7.x
 *
 * Two-phase first-time user experience:
 * 1. "How the game works" tutorial (shown first to educate users)
 * 2. Prompt to add mini app to Farcaster (enables notifications)
 *
 * Analytics events emitted:
 * - onboarding_how_it_works_viewed: When tutorial phase is shown
 * - onboarding_how_it_works_completed: When user clicks "I'm ready"
 * - onboarding_add_app_viewed: When add-app phase is shown
 * - onboarding_add_app_accepted: When user successfully adds the app
 * - onboarding_add_app_skipped: When user skips adding the app
 * - onboarding_flow_completed: When entire onboarding flow is finished
 *
 * Milestone 7.0: Visual polish
 * - Uses unified design token classes
 * - Consistent button styling with brand colors
 */
export default function FirstTimeOverlay({
  onDismiss,
  tutorialOnly = false,
  fid,
}: FirstTimeOverlayProps) {
  // New flow: tutorial first, then add-app
  const [phase, setPhase] = useState<OverlayPhase>('tutorial');
  const [isAddingApp, setIsAddingApp] = useState(false);

  // Log initial view event
  useEffect(() => {
    logOnboardingEvent('onboarding_how_it_works_viewed', fid, {
      tutorialOnly,
    });
  }, [fid, tutorialOnly]);

  const handleTutorialComplete = () => {
    triggerHaptic('light');
    logOnboardingEvent('onboarding_how_it_works_completed', fid);

    if (tutorialOnly) {
      // Skip add-app phase entirely when tutorialOnly
      logOnboardingEvent('onboarding_flow_completed', fid, {
        addAppShown: false,
        source: 'tutorial_only',
      });
      onDismiss();
    } else {
      // Proceed to add-app phase
      logOnboardingEvent('onboarding_add_app_viewed', fid);
      setPhase('add-app');
    }
  };

  const handleAddMiniApp = async () => {
    setIsAddingApp(true);
    try {
      const result = await sdk.actions.addMiniApp();
      const notificationsEnabled = !!result.notificationDetails;

      if (notificationsEnabled) {
        console.log('Mini app added with notifications enabled');
      }

      triggerHaptic('success');
      logOnboardingEvent('onboarding_add_app_accepted', fid, {
        notificationsEnabled,
      });
      logOnboardingEvent('onboarding_flow_completed', fid, {
        addAppAccepted: true,
        notificationsEnabled,
      });
      onDismiss();
    } catch (error) {
      console.log('Mini app add declined:', error);
      // Treat decline as skip
      logOnboardingEvent('onboarding_add_app_skipped', fid, {
        reason: 'declined',
      });
      logOnboardingEvent('onboarding_flow_completed', fid, {
        addAppAccepted: false,
        reason: 'declined',
      });
      onDismiss();
    } finally {
      setIsAddingApp(false);
    }
  };

  const handleSkipAdd = () => {
    triggerHaptic('light');
    logOnboardingEvent('onboarding_add_app_skipped', fid, {
      reason: 'user_skip',
    });
    logOnboardingEvent('onboarding_flow_completed', fid, {
      addAppAccepted: false,
      reason: 'user_skip',
    });
    onDismiss();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={onDismiss}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {phase === 'tutorial' ? (
          // Phase 1: How the game works (shown first)
          <>
            <h2 className="text-xl font-bold text-gray-900 text-center">
              How the game works
            </h2>

            <ul className="space-y-4 text-gray-700">
              <li className="flex items-start">
                <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
                <span>Everyone is hunting the same secret word. The first person to find it wins the jackpot.</span>
              </li>
              <li className="flex items-start">
                <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
                <span>You get 1 free guess per day. Additional guesses can be earned or purchased.</span>
              </li>
              <li className="flex items-start">
                <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
                <span>Every incorrect guess helps everyone else by removing that word from play.</span>
              </li>
              <li className="flex items-start">
                <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
                <span><span className="text-error font-medium">Red</span> words have already been guessed. <span className="font-medium">Black</span> words are still available.</span>
              </li>
            </ul>

            <button
              onClick={handleTutorialComplete}
              className="btn-primary-lg w-full"
            >
              I'm ready! 👉
            </button>
          </>
        ) : (
          // Phase 2: Add to Farcaster (shown second)
          <>
            <div className="text-center space-y-2">
              <h2 className="text-2xl font-bold text-gray-900">
                One more thing!
              </h2>
              <p className="text-gray-600">
                Add this app to get notified when new rounds begin — each round has a jackpot!
              </p>
            </div>

            <div className="space-y-3">
              <button
                onClick={handleAddMiniApp}
                disabled={isAddingApp}
                className="btn-primary-lg w-full"
              >
                {isAddingApp ? 'Adding...' : 'Add to Farcaster'}
              </button>
              <button
                onClick={handleSkipAdd}
                disabled={isAddingApp}
                className="btn-ghost w-full"
              >
                Skip for now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
