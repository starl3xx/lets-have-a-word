/**
 * Top10Status Component
 * Milestone 7.x: Wrapper that fetches round state and displays Top10StatusChip
 *
 * Fetches /api/round-state and displays the Top-10 lock status.
 * Uses same polling interval as TopTicker for consistency.
 */

import { useEffect, useState } from 'react';
import type { RoundStatus } from '../src/lib/wheel';
import Top10StatusChip from './Top10StatusChip';

/**
 * Top10Status Component
 * Fetches round state and displays compact Top-10 status chip
 */
export default function Top10Status() {
  const [status, setStatus] = useState<RoundStatus | null>(null);

  useEffect(() => {
    const fetchRoundStatus = async () => {
      try {
        const response = await fetch('/api/round-state');
        if (response.ok) {
          const data: RoundStatus = await response.json();
          setStatus(data);
        }
      } catch (err) {
        console.debug('[Top10Status] Failed to fetch:', err);
      }
    };

    // Initial fetch
    fetchRoundStatus();

    // Poll every 15 seconds (same as TopTicker)
    const interval = setInterval(fetchRoundStatus, 15000);

    return () => clearInterval(interval);
  }, []);

  // Don't render anything while loading or on error
  if (!status) {
    return null;
  }

  return (
    <div className="flex justify-center py-1">
      <Top10StatusChip
        top10Locked={status.top10Locked}
        top10GuessesRemaining={status.top10GuessesRemaining}
      />
    </div>
  );
}
