/**
 * LexigotchiBetaModal Component
 *
 * A one-time popup that tells players about Lexigotchi, starl3xx’s new
 * letter-character game, and asks for beta testers. The one CTA opens a
 * Farcaster direct cast to starl3xx with the message already typed.
 *
 * Shown once per PLAYER: OnboardingManager marks `has_seen_lexigotchi_beta`
 * the moment this renders, and offers it only to returning players with no
 * other onboarding step pending (see OnboardingManager).
 *
 * Born with an expiry: when the beta closes, delete this file, its step in
 * OnboardingManager, and `hasSeenLexigotchiBeta` from /api/onboarding/status.
 * Keep the column, as with has_seen_superguess_announcement.
 */
import { useEffect } from 'react';
import ExternalLink from './ExternalLink';
import { triggerHaptic } from '../src/lib/haptics';

/** starl3xx on Farcaster (fname `starl3xx`, checked on a hub 2026-11-25). */
const STARL3XX_FID = 6500;

const DM_TEXT = 'Hey! I saw Lexigotchi in Let’s Have A Word! and I’d like to be a beta tester.';

/**
 * Farcaster's direct cast intent: opens a DM composer to the FID with the
 * text prefilled. Documented at
 * https://docs.farcaster.xyz/reference/farcaster/direct-casts
 */
export const LEXIGOTCHI_BETA_DM_URL = `https://farcaster.xyz/~/inbox/create/${STARL3XX_FID}?text=${encodeURIComponent(DM_TEXT)}`;

/** The header art’s own paper color, so the picture reads full-bleed. */
const HEADER_BG = '#FBF4E3';

interface LexigotchiBetaModalProps {
  onDismiss: () => void;
  fid?: number;
}

function logEvent(eventType: string, fid?: number) {
  fetch('/api/analytics/log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ eventType, userId: fid?.toString() }),
  }).catch(() => {});
}

export default function LexigotchiBetaModal({ onDismiss, fid }: LexigotchiBetaModalProps) {
  useEffect(() => {
    logEvent('lexigotchi_beta_viewed', fid);
  }, [fid]);

  const handleDismiss = () => {
    triggerHaptic('light');
    onDismiss();
  };

  // Close on the next tick, so the link opens before the anchor unmounts.
  const handleDm = () => {
    logEvent('lexigotchi_beta_dm_clicked', fid);
    triggerHaptic('success');
    setTimeout(onDismiss, 0);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleDismiss}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lexigotchi-beta-title"
        className="bg-white rounded-card shadow-modal max-w-md w-full max-h-[85vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pt-3 pb-1 px-2" style={{ backgroundColor: HEADER_BG }}>
          <img
            src="/lexigotchi-heyoo.png"
            width={471}
            height={124}
            alt="Five Lexigotchi letter characters holding hands, spelling HEyOO"
            className="block w-full h-auto"
          />
        </div>

        <div className="p-6 space-y-4 text-center">
          <h2 id="lexigotchi-beta-title" className="text-xl font-bold text-gray-900">
            Meet Lexigotchi
          </h2>
          <p className="text-gray-700 text-balance">
            A new word game from starl3xx. Collect letter characters, roll them from lowercase
            to UPPERCASE, and claim words that are yours alone.
          </p>
          <p className="text-gray-700 text-balance">
            It’s in beta now, and we need testers. Want in?
          </p>

          <div className="space-y-2 pt-1">
            <ExternalLink
              href={LEXIGOTCHI_BETA_DM_URL}
              onClick={handleDm}
              className="btn-primary-lg w-full block"
            >
              DM starl3xx
            </ExternalLink>
            <button onClick={handleDismiss} className="btn-ghost w-full">
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
