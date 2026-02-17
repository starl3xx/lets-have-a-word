import { useState, useEffect } from 'react';

interface XPSheetProps {
  fid: number | null;
  onClose: () => void;
}

// Client-side XP tier constants (static, duplicated from config/economy.ts)
const XP_TIERS = [
  { tier: 0, name: 'Passive',  xpThreshold: 0,      multiplier: 1.00, color: '#9CA3AF' },
  { tier: 1, name: 'Bronze',   xpThreshold: 1_000,  multiplier: 1.15, color: '#CD7F32' },
  { tier: 2, name: 'Silver',   xpThreshold: 5_000,  multiplier: 1.35, color: '#A0AEC0' },
  { tier: 3, name: 'Gold',     xpThreshold: 15_000, multiplier: 1.60, color: '#F59E0B' },
] as const;

function getClientXpTier(totalXp: number) {
  for (let i = XP_TIERS.length - 1; i >= 0; i--) {
    if (totalXp >= XP_TIERS[i].xpThreshold) return XP_TIERS[i];
  }
  return XP_TIERS[0];
}

/**
 * XPSheet Component
 * Shows XP balance with live tier progression display.
 * Replaces the old "Coming Soon" placeholder.
 */
export default function XPSheet({ fid, onClose }: XPSheetProps) {
  const [xp, setXp] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchXP = async () => {
      if (!fid) {
        setIsLoading(false);
        return;
      }

      try {
        // Fetch user's current XP from user-state API
        const response = await fetch(`/api/user/state?devFid=${fid}`);

        if (response.ok) {
          const data = await response.json();
          setXp(data.xp || 0);
        }
      } catch (err) {
        console.error('Error fetching XP:', err);
      } finally {
        setIsLoading(false);
      }
    };

    fetchXP();
  }, [fid]);

  const currentTier = getClientXpTier(xp);
  const nextTier = currentTier.tier < 3 ? XP_TIERS[currentTier.tier + 1] : null;
  const xpToNext = nextTier ? nextTier.xpThreshold - xp : null;
  const progressPercent = nextTier
    ? Math.min(100, ((xp - currentTier.xpThreshold) / (nextTier.xpThreshold - currentTier.xpThreshold)) * 100)
    : 100;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50" onClick={onClose}>
      <div
        className="bg-white rounded-t-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-3">
          <h2 className="text-2xl font-bold text-gray-900">XP & Progression</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-8">
            <p className="text-gray-500 animate-pulse">Loading XP...</p>
          </div>
        )}

        {/* XP Display */}
        {!isLoading && (
          <div className="space-y-4">
            {/* Current XP */}
            <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-lg p-6 text-center space-y-2">
              <p className="text-sm text-orange-700 font-semibold">Your XP</p>
              <p className="text-5xl font-bold text-orange-900">{xp.toLocaleString()}</p>
            </div>

            {/* Tier Progression Card */}
            <div
              className="rounded-xl p-4 space-y-3"
              style={{
                background: `linear-gradient(135deg, ${currentTier.color}15, ${currentTier.color}08)`,
                border: `1px solid ${currentTier.color}30`,
              }}
            >
              {/* Current tier badge */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full text-white"
                    style={{ background: currentTier.color }}
                  >
                    {currentTier.name.toUpperCase()}
                  </span>
                  <span className="text-sm font-semibold text-gray-700">
                    {currentTier.multiplier}x staking boost
                  </span>
                </div>
              </div>

              {/* Progress bar */}
              {nextTier ? (
                <div className="space-y-1">
                  <div className="w-full h-2.5 bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-500"
                      style={{
                        width: `${progressPercent}%`,
                        background: currentTier.color,
                      }}
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    {xpToNext?.toLocaleString()} XP to {nextTier.name} ({nextTier.multiplier}x)
                  </p>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">
                    MAX TIER
                  </span>
                  <span className="text-xs text-gray-500">You've reached the highest staking boost</span>
                </div>
              )}

              {/* Tier roadmap */}
              <div className="flex items-center gap-1 pt-1">
                {XP_TIERS.map((t) => (
                  <div key={t.tier} className="flex-1 flex flex-col items-center">
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold ${
                        t.tier <= currentTier.tier ? 'text-white' : 'text-gray-400 bg-gray-200'
                      }`}
                      style={t.tier <= currentTier.tier ? { background: t.color } : undefined}
                    >
                      {t.tier < currentTier.tier ? '✓' : t.tier === currentTier.tier ? '●' : t.tier}
                    </div>
                    <span className="text-[9px] text-gray-500 mt-0.5">{t.name}</span>
                    <span className="text-[8px] text-gray-400">{t.multiplier}x</span>
                  </div>
                ))}
              </div>

              <p className="text-xs text-gray-600 pt-1">
                Your XP earns a <strong>{currentTier.multiplier}x</strong> boost on staking rewards
              </p>
            </div>

            {/* How XP is Earned */}
            <div className="bg-gray-50 rounded-lg p-4 space-y-2">
              <h3 className="text-sm font-bold text-gray-900">How to Earn XP</h3>
              <ul className="text-xs text-gray-700 space-y-1">
                <li>• Making guesses (free or paid)</li>
                <li>• Winning jackpots</li>
                <li>• Referring new players</li>
                <li>• Daily participation</li>
              </ul>
              <p className="text-xs text-gray-500 italic pt-2">
                Keep playing to level up your staking tier!
              </p>
            </div>
          </div>
        )}

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full py-3 px-4 bg-gray-100 text-gray-700 font-semibold rounded-lg hover:bg-gray-200 transition-all"
        >
          Close
        </button>
      </div>
    </div>
  );
}
