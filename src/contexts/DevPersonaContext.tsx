/**
 * Dev Persona Context
 * Milestone 6.4.7 — Dev Mode Persona Switcher
 *
 * Provides a way to simulate different user types and daily states
 * in dev mode without touching the database directly.
 *
 * Use cases:
 * - QA testing modal flows (share prompts, pack purchases, out-of-guesses)
 * - Testing CLANKTON holder vs non-holder experiences
 * - Validating UI for different user states
 */

import React, { createContext, useContext, useState, useCallback, useMemo } from 'react';
import type { UserStateResponse } from '../../pages/api/user-state';

/**
 * Persona definitions for QA testing
 */
export type PersonaId =
  | 'real' // Use real API state (no overrides)
  | 'new_non_holder'
  | 'engaged_non_holder_share_unused'
  | 'non_holder_share_used_out_of_guesses'
  | 'clankton_holder_low_tier'
  | 'clankton_holder_high_tier'
  | 'maxed_out_buyer';

export interface PersonaDefinition {
  id: PersonaId;
  name: string;
  description: string;
  overrides: Partial<UserStateResponse>;
}

/**
 * Predefined personas for testing different user states
 */
export const PERSONAS: PersonaDefinition[] = [
  {
    id: 'real',
    name: 'Real State',
    description: 'Use actual API data (no overrides)',
    overrides: {},
  },
  {
    id: 'new_non_holder',
    name: 'New Non-Holder',
    description: '1 free guess, no share used, no CLANKTON',
    overrides: {
      isClanktonHolder: false,
      clanktonBonusActive: false,
      freeGuessesRemaining: 1,
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 1,
      hasSharedToday: false,
      paidPacksPurchased: 0,
      freeAllocations: {
        base: 1,
        clankton: 0,
        shareBonus: 0,
      },
    },
  },
  {
    id: 'engaged_non_holder_share_unused',
    name: 'Engaged Non-Holder',
    description: 'Has guessed before, share bonus available',
    overrides: {
      isClanktonHolder: false,
      clanktonBonusActive: false,
      freeGuessesRemaining: 0,
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 0,
      hasSharedToday: false,
      paidPacksPurchased: 0,
      freeAllocations: {
        base: 1,
        clankton: 0,
        shareBonus: 0,
      },
    },
  },
  {
    id: 'non_holder_share_used_out_of_guesses',
    name: 'Non-Holder Out of Guesses',
    description: 'Share used, no guesses left, no packs bought',
    overrides: {
      isClanktonHolder: false,
      clanktonBonusActive: false,
      freeGuessesRemaining: 0,
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 0,
      hasSharedToday: true,
      paidPacksPurchased: 0,
      freeAllocations: {
        base: 1,
        clankton: 0,
        shareBonus: 1,
      },
    },
  },
  {
    id: 'clankton_holder_low_tier',
    name: 'CLANKTON Holder (Low Tier)',
    description: '+2 bonus guesses, share available',
    overrides: {
      isClanktonHolder: true,
      clanktonBonusActive: true,
      freeGuessesRemaining: 3, // 1 base + 2 holder bonus
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 3,
      hasSharedToday: false,
      paidPacksPurchased: 0,
      freeAllocations: {
        base: 1,
        clankton: 2,
        shareBonus: 0,
      },
    },
  },
  {
    id: 'clankton_holder_high_tier',
    name: 'CLANKTON Holder (High Tier)',
    description: '+3 bonus guesses, share available',
    overrides: {
      isClanktonHolder: true,
      clanktonBonusActive: true,
      freeGuessesRemaining: 4, // 1 base + 3 holder bonus
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 4,
      hasSharedToday: false,
      paidPacksPurchased: 0,
      freeAllocations: {
        base: 1,
        clankton: 3,
        shareBonus: 0,
      },
    },
  },
  {
    id: 'maxed_out_buyer',
    name: 'Maxed-Out Buyer',
    description: 'Max packs bought, share used, no guesses',
    overrides: {
      isClanktonHolder: false,
      clanktonBonusActive: false,
      freeGuessesRemaining: 0,
      paidGuessesRemaining: 0,
      totalGuessesRemaining: 0,
      hasSharedToday: true,
      paidPacksPurchased: 3, // maxPaidPacksPerDay
      canBuyMorePacks: false,
      freeAllocations: {
        base: 1,
        clankton: 0,
        shareBonus: 1,
      },
    },
  },
];

/**
 * Callback for triggering modal test from the panel
 */
export type TriggerModalTestCallback = () => void;

/**
 * Context value type
 */
interface DevPersonaContextValue {
  /** Whether dev mode is enabled */
  isDevMode: boolean;

  /** Currently selected persona ID */
  currentPersonaId: PersonaId;

  /** Current persona definition */
  currentPersona: PersonaDefinition;

  /** Select a persona by ID */
  selectPersona: (id: PersonaId) => void;

  /** Reset to real state */
  resetToReal: () => void;

  /** Apply overrides to a user state response */
  applyOverrides: (realState: UserStateResponse) => UserStateResponse;

  /** Whether the panel is open */
  isPanelOpen: boolean;

  /** Toggle panel visibility */
  togglePanel: () => void;

  /** Close the panel */
  closePanel: () => void;

  /** Register a callback for triggering modal test */
  registerModalTestCallback: (callback: TriggerModalTestCallback) => void;

  /** Trigger modal test (calls the registered callback) */
  triggerModalTest: () => void;
}

const DevPersonaContext = createContext<DevPersonaContextValue | null>(null);

/**
 * Check if dev mode is enabled on the client
 */
export function isClientDevMode(): boolean {
  if (typeof window === 'undefined') return false;
  return process.env.NEXT_PUBLIC_LHAW_DEV_MODE === 'true';
}

/**
 * Provider component for dev persona functionality
 */
export function DevPersonaProvider({ children }: { children: React.ReactNode }) {
  const isDevMode = isClientDevMode();
  const [currentPersonaId, setCurrentPersonaId] = useState<PersonaId>('real');
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [modalTestCallback, setModalTestCallback] = useState<TriggerModalTestCallback | null>(null);

  const currentPersona = useMemo(() => {
    return PERSONAS.find(p => p.id === currentPersonaId) || PERSONAS[0];
  }, [currentPersonaId]);

  const selectPersona = useCallback((id: PersonaId) => {
    setCurrentPersonaId(id);
    console.log(`[DevPersona] Selected persona: ${id}`);
  }, []);

  const resetToReal = useCallback(() => {
    setCurrentPersonaId('real');
    console.log('[DevPersona] Reset to real state');
  }, []);

  const applyOverrides = useCallback((realState: UserStateResponse): UserStateResponse => {
    // If not in dev mode or using real persona, return unchanged
    if (!isDevMode || currentPersonaId === 'real') {
      return realState;
    }

    // Apply overrides from current persona
    const overrides = currentPersona.overrides;
    return {
      ...realState,
      ...overrides,
      // Deep merge freeAllocations if present
      freeAllocations: overrides.freeAllocations
        ? { ...realState.freeAllocations, ...overrides.freeAllocations }
        : realState.freeAllocations,
    };
  }, [isDevMode, currentPersonaId, currentPersona]);

  const togglePanel = useCallback(() => {
    setIsPanelOpen(prev => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
  }, []);

  // Register a callback for triggering modal test
  const registerModalTestCallback = useCallback((callback: TriggerModalTestCallback) => {
    setModalTestCallback(() => callback);
  }, []);

  // Trigger modal test
  const triggerModalTest = useCallback(() => {
    if (modalTestCallback) {
      console.log('[DevPersona] Triggering modal test');
      modalTestCallback();
    } else {
      console.warn('[DevPersona] No modal test callback registered');
    }
  }, [modalTestCallback]);

  const value: DevPersonaContextValue = {
    isDevMode,
    currentPersonaId,
    currentPersona,
    selectPersona,
    resetToReal,
    applyOverrides,
    isPanelOpen,
    togglePanel,
    closePanel,
    registerModalTestCallback,
    triggerModalTest,
  };

  return (
    <DevPersonaContext.Provider value={value}>
      {children}
    </DevPersonaContext.Provider>
  );
}

/**
 * Hook to access dev persona context
 */
export function useDevPersona(): DevPersonaContextValue {
  const context = useContext(DevPersonaContext);
  if (!context) {
    // Return a no-op context when provider is missing
    return {
      isDevMode: false,
      currentPersonaId: 'real',
      currentPersona: PERSONAS[0],
      selectPersona: () => {},
      resetToReal: () => {},
      applyOverrides: (state) => state,
      isPanelOpen: false,
      togglePanel: () => {},
      closePanel: () => {},
      registerModalTestCallback: () => {},
      triggerModalTest: () => {},
    };
  }
  return context;
}
