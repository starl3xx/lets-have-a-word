import { useEffect } from 'react';
import { triggerHaptic } from '../src/lib/haptics';

interface SuperguessAnnouncementModalProps {
  onDismiss: () => void;
  fid?: number;
}

export default function SuperguessAnnouncementModal({
  onDismiss,
  fid,
}: SuperguessAnnouncementModalProps) {
  useEffect(() => {
    fetch('/api/analytics/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'superguess_announcement_viewed',
        userId: fid?.toString(),
      }),
    }).catch(() => {});
  }, [fid]);

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
        className="bg-white rounded-card shadow-modal max-w-md w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-xl font-bold text-gray-900 text-center">
          🔴 NEW: Superguess
        </h2>

        <ul className="space-y-4 text-gray-700">
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            <span>After <strong>850 guesses</strong>, any player can purchase a <strong>Superguess</strong> with $WORD tokens for an exclusive 25-guess, 10-minute window.</span>
          </li>
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            <span>During a Superguess, all other players are paused and watch live as spectators.</span>
          </li>
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            <span>50% of your $WORD payment is <strong>burned</strong>, and 50% goes to <strong>staking rewards</strong>.</span>
          </li>
          <li className="flex items-start">
            <span className="text-brand mr-3 mt-0.5 flex-shrink-0 font-bold">•</span>
            <span>Purchasing a Superguess earns you the <strong>Showstopper</strong> wordmark. One Superguess per round.</span>
          </li>
        </ul>

        <button
          onClick={handleDismiss}
          className="btn-primary-lg w-full"
        >
          I'm ready! 👉
        </button>
      </div>
    </div>
  );
}
