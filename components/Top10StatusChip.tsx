/**
 * Top10StatusChip Component
 * Milestone 7.x: Displays Top-10 lock status in a compact chip
 *
 * Shows:
 * - When TOP10_OPEN: "Top-10 open • {N} guesses left"
 * - When TOP10_LOCKED: "Top-10 locked • Jackpot still live"
 *
 * Design:
 * - Compact, inline chip style
 * - No extra vertical space
 * - Color-coded: green when open, amber when locked
 */

interface Top10StatusChipProps {
  top10Locked: boolean;
  top10GuessesRemaining: number;
}

export default function Top10StatusChip({
  top10Locked,
  top10GuessesRemaining,
}: Top10StatusChipProps) {
  if (top10Locked) {
    // Locked state - amber/orange styling
    return (
      <div
        className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5"
        style={{
          backgroundColor: 'rgba(251, 191, 36, 0.15)',
          color: '#d97706', // amber-600
        }}
      >
        <span className="font-medium">Top 10 locked</span>
        <span className="opacity-70">•</span>
        <span className="opacity-80">Jackpot still live</span>
        {/* Pulsing green dot to indicate live jackpot */}
        <span className="relative flex h-2 w-2 ml-0.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
        </span>
      </div>
    );
  }

  // Open state - green styling
  return (
    <div
      className="inline-flex items-center gap-1 text-xs rounded-full px-2 py-0.5"
      style={{
        backgroundColor: 'rgba(34, 197, 94, 0.12)',
        color: '#166534', // green-800
      }}
    >
      <span className="font-medium">Top 10 open</span>
      <span className="opacity-70">•</span>
      <span className="opacity-80">{top10GuessesRemaining.toLocaleString()} guesses left</span>
    </div>
  );
}
