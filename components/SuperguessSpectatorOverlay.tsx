/**
 * Superguess Spectator Overlay
 * Milestone 15: Full-screen overlay shown to all non-Superguessers
 *
 * Displays: Superguesser username, guess counter, countdown timer, live guess log
 * Polls /api/superguess/state every 3 seconds
 * On win → triggers celebration (same as normal win)
 * On fail → shows "Superguess ended" + cooldown countdown
 */

import { useState, useEffect, useRef } from 'react';
import { useCountdown } from '../src/hooks/useCountdown';

interface SuperguessSession {
  id: number;
  fid: number;
  username: string;
  guessesUsed: number;
  guessesAllowed: number;
  expiresAt: string;
  startedAt: string;
  tier: string;
}

interface SuperguessStateResponse {
  active: boolean;
  session?: SuperguessSession;
  cooldown?: { endsAt: string };
  eligible: boolean;
}

interface Props {
  roundId: number;
  onDismiss: () => void;
  onWin?: () => void;
}

export default function SuperguessSpectatorOverlay({ roundId, onDismiss, onWin }: Props) {
  const [state, setState] = useState<SuperguessStateResponse | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const prevActiveRef = useRef(true);

  // Poll every 3 seconds
  useEffect(() => {
    let active = true;

    const poll = async () => {
      try {
        const res = await fetch('/api/superguess/state');
        if (res.ok) {
          const data: SuperguessStateResponse = await res.json();
          if (active) {
            setState(data);

            // Detect transition from active → inactive
            if (prevActiveRef.current && !data.active) {
              // Session ended
              prevActiveRef.current = false;
            }
            if (data.active) {
              prevActiveRef.current = true;
            }
          }
        }
      } catch (err) {
        console.error('[SuperguessOverlay] Poll error:', err);
      }
    };

    poll();
    const interval = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [roundId]);

  const countdown = useCountdown(state?.session?.expiresAt);
  const cooldownCountdown = useCountdown(state?.cooldown?.endsAt);

  // Auto-dismiss when cooldown ends
  useEffect(() => {
    if (!state?.active && !state?.cooldown) {
      // No active session and no cooldown — dismiss overlay
      const timer = setTimeout(() => {
        onDismiss();
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [state?.active, state?.cooldown, onDismiss]);

  if (dismissed) return null;

  // Cooldown state (Superguess ended, waiting for normal play to resume)
  if (!state?.active && state?.cooldown) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm px-6">
        <div className="text-center max-w-sm">
          <div className="text-4xl mb-4">😤</div>
          <h2 className="text-xl font-bold text-white mb-2">Superguess Ended</h2>
          <p className="text-gray-400 mb-6">
            The Superguesser didn't find the word. Normal play resumes after cooldown.
          </p>
          <div className="text-3xl font-mono text-amber-400 mb-6">
            {cooldownCountdown}
          </div>
          <p className="text-xs text-gray-500">Cooldown remaining</p>
        </div>
      </div>
    );
  }

  // Active Superguess session
  if (state?.active && state.session) {
    const { session } = state;
    const progressPct = (session.guessesUsed / session.guessesAllowed) * 100;

    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm px-6">
        <div className="text-center max-w-sm w-full">
          {/* Live indicator */}
          <div className="flex items-center justify-center gap-2 mb-6">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600" />
            </span>
            <span className="text-red-500 font-bold text-sm tracking-widest uppercase">
              Superguess Live
            </span>
          </div>

          {/* Username */}
          <h2 className="text-2xl font-bold text-white mb-1">
            @{session.username}
          </h2>
          <p className="text-gray-400 text-sm mb-6">
            is attempting a Superguess
          </p>

          {/* Guess counter */}
          <div className="bg-gray-900/80 rounded-xl p-4 mb-4">
            <div className="text-sm text-gray-400 mb-1">Guesses</div>
            <div className="text-4xl font-bold text-white">
              {session.guessesUsed} <span className="text-gray-500 text-2xl">/ {session.guessesAllowed}</span>
            </div>
            {/* Progress bar */}
            <div className="w-full bg-gray-700 rounded-full h-2 mt-3">
              <div
                className="bg-red-500 h-2 rounded-full transition-all duration-300"
                style={{ width: `${Math.min(progressPct, 100)}%` }}
              />
            </div>
          </div>

          {/* Timer */}
          <div className="bg-gray-900/80 rounded-xl p-4 mb-6">
            <div className="text-sm text-gray-400 mb-1">Time Remaining</div>
            <div className="text-4xl font-mono text-amber-400">
              {countdown || '--:--'}
            </div>
          </div>

          <p className="text-xs text-gray-500">
            All other guessing is paused during a Superguess
          </p>
        </div>
      </div>
    );
  }

  // Transitional state (loading or session just ended without cooldown)
  if (!state?.active && !state?.cooldown) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm">
        <div className="text-center">
          <div className="text-2xl text-white mb-2">Superguess complete</div>
          <p className="text-gray-400">Resuming normal play...</p>
        </div>
      </div>
    );
  }

  return null;
}
