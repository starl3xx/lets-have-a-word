/**
 * SuperguessBar Component
 * Milestone 15: Replaces the GuessBar during an active Superguess
 *
 * For the Superguesser: shows timer + guesses remaining
 * For spectators: shows "Superguess in progress | @user has N guesses remaining"
 */

import { useCountdown } from '../src/hooks/useCountdown';

interface SuperguessBarProps {
  mode: 'superguesser' | 'spectator';
  guessesUsed: number;
  guessesAllowed: number;
  expiresAt: string;
  username?: string; // Only needed for spectator mode
}

export default function SuperguessBar({
  mode,
  guessesUsed,
  guessesAllowed,
  expiresAt,
  username,
}: SuperguessBarProps) {
  const countdown = useCountdown(expiresAt);
  const guessesRemaining = guessesAllowed - guessesUsed;

  if (mode === 'superguesser') {
    return (
      <div className="flex items-center justify-between px-1">
        {/* Left: guesses remaining pill (matches GuessBar style) */}
        <span className="inline-flex items-center gap-1.5 bg-red-500/20 text-red-400 text-sm font-semibold px-2.5 py-0.5 rounded-full border border-red-500/30">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
          </span>
          {guessesRemaining} guesses left
        </span>

        {/* Right: timer */}
        <span className="text-sm text-gray-400">
          <span className="font-mono text-amber-400">{countdown}</span>
          <span className="ml-1.5 text-gray-500">remaining</span>
        </span>
      </div>
    );
  }

  // Spectator mode
  // Truncate long usernames to prevent line wrapping
  const displayName = (username || 'player').length > 12
    ? (username || 'player').slice(0, 12) + '\u2026'
    : (username || 'player');

  return (
    <div className="flex items-center justify-center px-1">
      <span className="inline-flex items-center gap-1.5 text-sm text-gray-400 whitespace-nowrap">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
        </span>
        <span className="text-red-400 font-medium">Superguess in progress</span>
        <span className="text-gray-500 mx-0.5">|</span>
        <span>@{displayName} has {guessesRemaining} guesses left</span>
      </span>
    </div>
  );
}
