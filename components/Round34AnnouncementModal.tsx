/**
 * Round34AnnouncementModal Component
 *
 * One-time announcement for the $WORD era, shown to every player the first
 * time they open the app AFTER round 34 has started. The gate lives
 * server-side: /api/onboarding/status only offers this step while the active
 * round's prize_currency is 'word', so nobody sees it early.
 *
 * Covers, in one screen: the $WORD jackpot, the $3 play requirement (with a
 * "you're in free" variant for grandfathered players), the holder ladder,
 * and the fact that packs and Superguess still cost ETH.
 */
import { useEffect } from 'react';
import confetti from 'canvas-confetti';
import { triggerHaptic } from '../src/lib/haptics';

/**
 * A $WORD-era send-off: purple-and-gold bursts as the player steps into
 * round 34. canvas-confetti draws on its own document-level canvas, so the
 * animation plays out even though the modal unmounts immediately.
 */
function fireWordEraCelebration() {
  const colors = ['#7C3AED', '#8B5CF6', '#A78BFA', '#C4B5FD', '#F59E0B'];
  confetti({ particleCount: 90, spread: 75, origin: { y: 0.7 }, zIndex: 100, colors });
  setTimeout(() => {
    confetti({ particleCount: 45, angle: 60, spread: 55, origin: { x: 0, y: 0.8 }, zIndex: 100, colors });
    confetti({ particleCount: 45, angle: 120, spread: 55, origin: { x: 1, y: 0.8 }, zIndex: 100, colors });
  }, 180);
}

interface Round34AnnouncementModalProps {
  onDismiss: () => void;
  fid?: number;
  /** First guess in rounds 1–27 — plays free under the reward gate */
  grandfathered: boolean;
  /**
   * First guess in rounds 1–18 — holds the Early Adopter 💅 wordmark. A
   * strict subset of `grandfathered`; rounds 19–27 players are in free but
   * do not get the mark, so the wordmark line keys off this flag alone.
   */
  earlyAdopter: boolean;
}

export default function Round34AnnouncementModal({
  onDismiss,
  fid,
  grandfathered,
  earlyAdopter,
}: Round34AnnouncementModalProps) {
  useEffect(() => {
    fetch('/api/analytics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'round34_announcement_viewed',
        userId: fid?.toString(),
      }),
    }).catch(() => {});
  }, [fid]);

  const handleDismiss = () => {
    triggerHaptic('light');
    onDismiss();
  };

  // The CTA celebrates; a backdrop dismiss does not.
  const handleLetsGo = () => {
    fireWordEraCelebration();
    triggerHaptic('success');
    onDismiss();
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleDismiss}
    >
      <div
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-5 max-h-[85vh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 text-center">
          🟣 Round 34: the $WORD era
        </h2>

        <ul className="space-y-4 text-gray-700">
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            <span>The jackpot and prizes (bonus words, Top 10) now pays out in <strong>$WORD</strong>, the game’s native token</span>
          </li>
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            {grandfathered ? (
              <span><strong>You’re in free</strong> since you played before rounds were botted, but new players need <strong>$3 of $WORD</strong> (held or staked){earlyAdopter ? (
                <>. We also comped you the <strong>Early Adopter</strong> 💅 Wordmark for playing before the bots arrived</>
              ) : null}</span>
            ) : (
              <span>Playing now requires about <strong>$3 of $WORD</strong>, held or staked. Top up once and you’re in for good</span>
            )}
          </li>
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            <span>Holding more earns more: about <strong>$25 / $50 / $75</strong> of $WORD (held or staked) gives <strong>+1 / +2 / +3 free guesses</strong> every day</span>
          </li>
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            <span>Guess packs + Superguess still cost <strong>ETH</strong>; 80% of every purchase grows the prize pool</span>
          </li>
        </ul>

        <button
          onClick={handleLetsGo}
          className="btn-primary-lg w-full"
        >
          Let’s have a word! 👉
        </button>
      </div>
    </div>
  );
}
