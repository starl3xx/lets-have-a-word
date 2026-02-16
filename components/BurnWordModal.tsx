/**
 * BurnWordModal
 * Milestone 14: Celebration modal shown when a player finds a burn word.
 *
 * Features:
 * - Fire-themed confetti celebration
 * - 🔥 badge animation
 * - Burn amount display (5M $WORD destroyed)
 * - Link to BaseScan transaction
 */

import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { triggerHaptic } from '../src/lib/haptics';

interface BurnWordModalProps {
  word: string;
  burnAmount: string;
  txHash: string | null;
  onClose: () => void;
}

/**
 * Fire a fire-themed confetti celebration
 */
function fireCelebration() {
  const duration = 1500;
  const animationEnd = Date.now() + duration;

  const defaults = {
    startVelocity: 30,
    spread: 360,
    ticks: 60,
    zIndex: 100,
    colors: ['#f97316', '#ef4444', '#eab308', '#dc2626', '#f59e0b'],
  };

  const interval = setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      return clearInterval(interval);
    }

    const particleCount = 50 * (timeLeft / duration);

    confetti({
      ...defaults,
      particleCount,
      origin: { x: 0.2, y: 0.5 },
    });

    confetti({
      ...defaults,
      particleCount,
      origin: { x: 0.8, y: 0.5 },
    });
  }, 150);

  confetti({
    particleCount: 100,
    spread: 100,
    origin: { y: 0.4 },
    colors: ['#f97316', '#dc2626', '#eab308'],
  });
}

function formatTokenReward(amount: string): string {
  const num = parseInt(amount, 10);
  return num.toLocaleString('en-US');
}

export default function BurnWordModal({
  word,
  burnAmount,
  txHash,
  onClose,
}: BurnWordModalProps) {
  const [showContent, setShowContent] = useState(false);

  useEffect(() => {
    fireCelebration();
    triggerHaptic('success');
    setTimeout(() => setShowContent(true), 200);
  }, []);

  const handleViewTransaction = () => {
    triggerHaptic('light');
    if (txHash) {
      window.open(`https://basescan.org/tx/${txHash}`, '_blank');
    }
  };

  const handleContinue = () => {
    triggerHaptic('light');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      onClick={handleContinue}
    >
      <div
        className={`bg-gradient-to-b from-orange-50 to-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-5 transform transition-all duration-500 ${
          showContent ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header with Badge */}
        <div className="text-center">
          <div className="relative inline-block">
            <div className="w-24 h-24 bg-gradient-to-br from-orange-400 to-red-500 rounded-full flex items-center justify-center mx-auto mb-4 shadow-lg animate-bounce-subtle">
              <span className="text-5xl" role="img" aria-label="Burn">
                🔥
              </span>
            </div>
            <div className="absolute -top-1 -right-1 text-2xl animate-spin-slow">✨</div>
            <div className="absolute -bottom-1 -left-1 text-2xl animate-spin-slow" style={{ animationDelay: '0.5s' }}>✨</div>
          </div>

          <h2 className="text-3xl font-bold bg-gradient-to-r from-orange-600 to-red-500 bg-clip-text text-transparent mb-2">
            Burn Word Found!
          </h2>
          <p className="text-gray-600">
            You found a secret burn word
          </p>
        </div>

        {/* Word Display */}
        <div className="bg-white rounded-xl p-4 border-2 border-orange-200 shadow-inner text-center">
          <div className="text-3xl font-mono font-bold tracking-widest text-orange-700">
            {word}
          </div>
        </div>

        {/* Burn Display */}
        <div className="bg-gradient-to-r from-orange-100 to-red-100 rounded-xl p-5 text-center">
          <div className="flex items-center justify-center gap-3 mb-2">
            <img
              src="/word-token-logo.png"
              alt="$WORD"
              className="w-10 h-10 rounded-full border-2 border-white shadow"
            />
            <div>
              <div className="text-2xl font-bold text-orange-700">
                -{formatTokenReward(burnAmount)} $WORD
              </div>
              <div className="text-sm text-orange-500">
                Permanently destroyed
              </div>
            </div>
          </div>

          <div className="flex items-center justify-center gap-2 mt-3">
            <span className="text-xl">🏆</span>
            <span className="text-sm font-medium text-orange-600">
              +100 XP &amp; 🔥 Badge earned!
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          {txHash && (
            <button
              onClick={handleViewTransaction}
              className="w-full px-4 py-3 bg-white border-2 border-orange-200 hover:border-orange-400 text-orange-700 rounded-xl font-semibold transition-colors flex items-center justify-center gap-2"
            >
              <span>View Transaction</span>
              <span className="text-sm">↗</span>
            </button>
          )}

          <button
            onClick={handleContinue}
            className="w-full px-4 py-3 bg-gradient-to-r from-orange-600 to-red-500 hover:from-orange-700 hover:to-red-600 text-white rounded-xl font-semibold transition-all shadow-lg"
          >
            Keep Playing!
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          Keep guessing - there may be more burn words this round!
        </p>
      </div>

      <style jsx>{`
        @keyframes bounce-subtle {
          0%, 100% {
            transform: translateY(0);
          }
          50% {
            transform: translateY(-8px);
          }
        }
        .animate-bounce-subtle {
          animation: bounce-subtle 2s ease-in-out infinite;
        }

        @keyframes spin-slow {
          0% {
            transform: rotate(0deg) scale(1);
          }
          50% {
            transform: rotate(180deg) scale(1.2);
          }
          100% {
            transform: rotate(360deg) scale(1);
          }
        }
        .animate-spin-slow {
          animation: spin-slow 3s ease-in-out infinite;
        }
      `}</style>
    </div>
  );
}
