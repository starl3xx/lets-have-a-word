/**
 * OnboardingManager Component
 *
 * Orchestrates the post-launch onboarding flow:
 * 1. "How It Works" modal (FirstTimeOverlay) - shown to all new users
 * 2. "Hey, OG Hunter!" modal - shown only to OG Hunters after step 1
 *
 * Flow logic:
 * - On mount, fetches /api/onboarding/status to determine what to show
 * - Shows modals in order, one at a time
 * - Marks each modal as seen via /api/onboarding/mark-seen
 * - OG Hunters who already claimed still see the thanks modal once
 *
 * Integration:
 * - Render this component in the main game layout
 * - Pass the user's FID as a prop
 * - Only renders when PRELAUNCH_MODE is off (normal gameplay mode)
 */

import { useState, useEffect, useCallback } from 'react';
import FirstTimeOverlay from './FirstTimeOverlay';
import OgHunterThanksModal from './OgHunterThanksModal';
import type { OnboardingStatusResponse } from '../pages/api/onboarding/status';

interface OnboardingManagerProps {
  /** User's Farcaster ID */
  fid: number;
  /** Skip all onboarding (for testing) */
  disabled?: boolean;
}

type OnboardingStep = 'loading' | 'howItWorks' | 'ogHunterThanks' | 'done';

export default function OnboardingManager({
  fid,
  disabled = false,
}: OnboardingManagerProps) {
  const [step, setStep] = useState<OnboardingStep>('loading');
  const [status, setStatus] = useState<OnboardingStatusResponse | null>(null);

  // Fetch onboarding status on mount
  useEffect(() => {
    if (disabled || !fid) {
      setStep('done');
      return;
    }

    const fetchStatus = async () => {
      try {
        const response = await fetch(`/api/onboarding/status?fid=${fid}`);
        if (!response.ok) {
          console.error('[OnboardingManager] Failed to fetch status:', response.status);
          setStep('done');
          return;
        }

        const data: OnboardingStatusResponse = await response.json();
        setStatus(data);

        // Determine first step to show
        if (!data.hasSeenIntro) {
          setStep('howItWorks');
        } else if (data.isOgHunter && !data.hasSeenOgHunterThanks) {
          setStep('ogHunterThanks');
        } else {
          setStep('done');
        }
      } catch (error) {
        console.error('[OnboardingManager] Error fetching status:', error);
        setStep('done');
      }
    };

    fetchStatus();
  }, [fid, disabled]);

  // Mark a modal as seen
  const markSeen = useCallback(async (key: 'intro' | 'ogHunterThanks') => {
    try {
      await fetch('/api/onboarding/mark-seen', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fid, key }),
      });
    } catch (error) {
      console.error('[OnboardingManager] Error marking seen:', error);
    }
  }, [fid]);

  // Handle "How It Works" dismissal
  const handleHowItWorksDismiss = useCallback(async () => {
    await markSeen('intro');

    // Check if we should show OG Hunter modal next
    if (status?.isOgHunter && !status?.hasSeenOgHunterThanks) {
      setStep('ogHunterThanks');
    } else {
      setStep('done');
    }
  }, [markSeen, status]);

  // Handle OG Hunter Thanks dismissal
  const handleOgHunterThanksDismiss = useCallback(async () => {
    await markSeen('ogHunterThanks');
    setStep('done');
  }, [markSeen]);

  // Don't render anything while loading or when done
  if (step === 'loading' || step === 'done') {
    return null;
  }

  return (
    <>
      {step === 'howItWorks' && (
        <FirstTimeOverlay
          onDismiss={handleHowItWorksDismiss}
          // OG Hunters skip the "add app" phase since they already added it
          tutorialOnly={status?.isOgHunter ?? false}
          fid={fid}
        />
      )}

      {step === 'ogHunterThanks' && (
        <OgHunterThanksModal
          fid={fid}
          onDismiss={handleOgHunterThanksDismiss}
          alreadyAwarded={status?.ogHunterAwarded ?? false}
        />
      )}
    </>
  );
}
