/**
 * One operational-status feed for the whole admin panel (Phase D of the
 * cleanup). Before this, the shell, Operations, and Wallet each polled
 * /api/admin/operational/status independently with three divergent copies of
 * the type — which is how the header once said Normal while a tab knew
 * better. One provider polls; every consumer reads the same object and can
 * force a refresh after mutating actions.
 */

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

export interface OperationalStatus {
  ok: boolean;
  status: 'NORMAL' | 'KILL_SWITCH_ACTIVE' | 'DEAD_DAY_ACTIVE' | 'PAUSED_BETWEEN_ROUNDS';
  activeRoundId?: number;
  killSwitch: {
    enabled: boolean;
    activatedAt?: string;
    reason?: string;
    roundId?: number;
    activatedBy?: number;
    refundsRunning?: boolean;
  };
  deadDay: {
    enabled: boolean;
    activatedAt?: string;
    reason?: string;
    reopenAt?: string;
    appliesAfterRoundId?: number;
    activatedBy?: number;
  };
  cancelledRounds: Array<{
    roundId: number;
    cancelledAt: string;
    cancelledReason?: string;
    cancelledBy?: number;
    refundsStartedAt?: string;
    refundsCompletedAt?: string;
    refunds: {
      total: number;
      pending: number;
      processing: number;
      sent: number;
      failed: number;
      totalAmountEth: string;
    };
  }>;
  refundCron?: {
    lastRun: string | null;
    lastResult: {
      roundsProcessed: number;
      totalSent: number;
      totalFailed: number;
      durationMs: number;
      timestamp: string;
    } | null;
    nextRunEstimate: string;
  };
  wordManagerConfigured?: boolean;
  timestamp: string;
}

interface OperationalStatusContextValue {
  status: OperationalStatus | null;
  loading: boolean;
  error: string | null;
  /** Force a refetch — call after any action that changes operational state. */
  refresh: () => Promise<void>;
}

const OperationalStatusContext = createContext<OperationalStatusContextValue>({
  status: null,
  loading: false,
  error: null,
  refresh: async () => {},
});

const POLL_MS = 30_000;

export function OperationalStatusProvider({
  fid,
  children,
}: {
  fid?: number;
  children: React.ReactNode;
}) {
  const [status, setStatus] = useState<OperationalStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The poll must never race a refresh() fired by an action.
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (!fid || inFlight.current) return;
    inFlight.current = true;
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/operational/status?devFid=${fid}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to fetch status');
      }
      setStatus(data);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to fetch status');
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, [fid]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  return (
    <OperationalStatusContext.Provider value={{ status, loading, error, refresh }}>
      {children}
    </OperationalStatusContext.Provider>
  );
}

export function useOperationalStatus(): OperationalStatusContextValue {
  return useContext(OperationalStatusContext);
}
