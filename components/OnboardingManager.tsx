/**
 * OnboardingManager Component
 *
 * Orchestrates the post-launch onboarding flow:
 * 1. "How It Works" modal (FirstTimeOverlay) - shown to all new users
 * 2. "Hey, OG Hunter!" modal - shown only to OG Hunters after step 1
 * 3. Round 34 announcement - only while a $WORD round is active
 *
 * The Superguess announcement used to sit between steps 2 and 3. It was a
 * feature-launch notice, and everyone it was written for has long since been
 * shown it; the only people still eligible were new players, for whom a "NEW:"
 * banner about a shipped feature reads as noise. The SuperguessBar teaches it
 * in place. `users.has_seen_superguess_announcement` is left alone as history.
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
import Round34AnnouncementModal from './Round34AnnouncementModal';
import type { OnboardingStatusResponse } from '../pages/api/onboarding/status';

interface OnboardingManagerProps {
  /** User's Farcaster ID */
  fid: number;
  /** Skip all onboarding (for testing) */
  disabled?: boolean;
}

type OnboardingStep = 'loading' | 'howItWorks' | 'ogHunterThanks' | 'round34Announcement' | 'done';

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

        // Determine first step to show. The round-34 announcement is offered
        // only while the server says a $WORD round is ACTIVE (wordEraActive) —
        // the leak guard: opening the app before round 34 starts never
        // reveals the update.
        if (!data.hasSeenIntro) {
          setStep('howItWorks');
        } else if (data.isOgHunter && !data.hasSeenOgHunterThanks) {
          setStep('ogHunterThanks');
        } else if (data.wordEraActive && !data.hasSeenRound34Announcement) {
          setStep('round34Announcement');
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
  const markSeen = useCallback(async (key: 'intro' | 'ogHunterThanks' | 'round34Announcement') => {
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

  // Advance to the next unseen step, or finish
  const advanceFrom = useCallback((currentStep: OnboardingStep) => {
    const round34Pending = !!status?.wordEraActive && !status?.hasSeenRound34Announcement;
    if (currentStep === 'howItWorks') {
      if (status?.isOgHunter && !status?.hasSeenOgHunterThanks) {
        setStep('ogHunterThanks');
      } else if (round34Pending) {
        setStep('round34Announcement');
      } else {
        setStep('done');
      }
    } else if (currentStep === 'ogHunterThanks') {
      if (round34Pending) {
        setStep('round34Announcement');
      } else {
        setStep('done');
      }
    } else {
      setStep('done');
    }
  }, [status]);

  // Handle "How It Works" dismissal
  const handleHowItWorksDismiss = useCallback(async () => {
    await markSeen('intro');
    advanceFrom('howItWorks');
  }, [markSeen, advanceFrom]);

  // Handle OG Hunter Thanks dismissal
  const handleOgHunterThanksDismiss = useCallback(async () => {
    await markSeen('ogHunterThanks');
    advanceFrom('ogHunterThanks');
  }, [markSeen, advanceFrom]);

  // Handle Round 34 Announcement dismissal
  const handleRound34AnnouncementDismiss = useCallback(async () => {
    await markSeen('round34Announcement');
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

      {step === 'round34Announcement' && (
        <Round34AnnouncementModal
          fid={fid}
          onDismiss={handleRound34AnnouncementDismiss}
          grandfathered={status?.grandfathered ?? false}
          earlyAdopter={status?.earlyAdopter ?? false}
        />
      )}
    </>
  );
}
