/**
 * Superguess Active Bar
 * Milestone 15: Compact bar shown to the Superguesser above keyboard
 *
 * Shows: guesses remaining, time remaining
 */

import { useState, useEffect } from 'react';

interface Props {
  guessesUsed: number;
  guessesAllowed: number;
  expiresAt: string;
}

function useCountdown(targetIso: string): string {
  const [remaining, setRemaining] = useState('');

  useEffect(() => {
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

export default function SuperguessActiveBar({ guessesUsed, guessesAllowed, expiresAt }: Props) {
  const countdown = useCountdown(expiresAt);
  const guessesRemaining = guessesAllowed - guessesUsed;

  return (
    <div className="w-full bg-red-900/40 border border-red-500/30 rounded-lg px-4 py-2 mb-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Live dot */}
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-600" />
          </span>
          <span className="text-red-400 text-xs font-bold tracking-wider uppercase">
            Superguess
          </span>
        </div>

        <div className="flex items-center gap-4 text-sm">
          <span className="text-white font-mono">
            {guessesRemaining} <span className="text-gray-400">left</span>
          </span>
          <span className="text-amber-400 font-mono">
            {countdown}
          </span>
        </div>
      </div>
    </div>
  );
}
