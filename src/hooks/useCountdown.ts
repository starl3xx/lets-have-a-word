/**
 * useCountdown Hook
 * Milestone 15: Shared countdown timer for Superguess components
 *
 * Returns a formatted "M:SS" string counting down to the target ISO timestamp.
 * Returns '0:00' when expired, empty string if no target provided.
 */

import { useState, useEffect } from 'react';

export function useCountdown(targetIso: string | undefined): string {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
    if (!targetIso) {
      setRemaining('');
      return;
    }

    const update = () => {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) {
        setRemaining('0:00');
        return;
      }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setRemaining(`${mins}:${secs.toString().padStart(2, '0')}`);
    };

    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [targetIso]);

  return remaining;
}
