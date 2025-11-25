/**
 * Dev Persona Panel
 * Milestone 6.4.7 — Dev Mode Persona Switcher UI
 *
 * A slide-out panel for switching between different user personas
 * during QA testing. Only visible when NEXT_PUBLIC_LHAW_DEV_MODE=true.
 */

import { useDevPersona, PERSONAS, type PersonaId } from '../src/contexts/DevPersonaContext';

/**
 * Floating "Dev" button that opens the persona panel
 * Only renders when dev mode is enabled
 */
export function DevModeButton() {
  const { isDevMode, togglePanel, currentPersonaId } = useDevPersona();

  if (!isDevMode) return null;

  const isOverrideActive = currentPersonaId !== 'real';

  return (
    <button
      onClick={togglePanel}
      className={`
        fixed top-2 right-2 z-50
        px-2 py-1 rounded-full
        text-xs font-bold uppercase tracking-wider
        shadow-lg
        transition-all duration-150
        ${isOverrideActive
          ? 'bg-orange-500 text-white animate-pulse'
          : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
        }
      `}
      title="Open Dev Persona Panel"
    >
      {isOverrideActive ? 'DEV*' : 'DEV'}
    </button>
  );
}

/**
 * Slide-out panel with persona selection
 */
export function DevPersonaPanel() {
  const {
    isDevMode,
    isPanelOpen,
    closePanel,
    currentPersonaId,
    selectPersona,
    resetToReal,
  } = useDevPersona();

  if (!isDevMode || !isPanelOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-50"
        onClick={closePanel}
      />

      {/* Panel */}
      <div className="fixed top-0 right-0 h-full w-80 bg-gray-900 text-white z-50 shadow-2xl overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-4 py-3 flex items-center justify-between">
          <h2 className="text-lg font-bold">Dev Persona Switcher</h2>
          <button
            onClick={closePanel}
            className="text-gray-400 hover:text-white text-2xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* Info */}
        <div className="px-4 py-3 bg-gray-800 border-b border-gray-700 text-sm text-gray-400">
          Simulate different user states for QA testing.
          Overrides are client-side only and don't affect the database.
        </div>

        {/* Persona List */}
        <div className="p-4 space-y-2">
          {PERSONAS.map((persona) => (
            <PersonaCard
              key={persona.id}
              persona={persona}
              isSelected={currentPersonaId === persona.id}
              onSelect={() => selectPersona(persona.id)}
            />
          ))}
        </div>

        {/* Reset Button */}
        <div className="sticky bottom-0 bg-gray-900 border-t border-gray-700 p-4">
          <button
            onClick={() => {
              resetToReal();
              closePanel();
            }}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg transition-colors"
          >
            Reset to Real State
          </button>
        </div>
      </div>
    </>
  );
}

/**
 * Individual persona card
 */
function PersonaCard({
  persona,
  isSelected,
  onSelect,
}: {
  persona: typeof PERSONAS[number];
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`
        w-full text-left p-3 rounded-lg transition-all
        ${isSelected
          ? 'bg-blue-600 border-2 border-blue-400'
          : 'bg-gray-800 border-2 border-transparent hover:border-gray-600'
        }
      `}
    >
      <div className="flex items-center gap-2">
        <div className={`
          w-3 h-3 rounded-full
          ${isSelected ? 'bg-green-400' : 'bg-gray-600'}
        `} />
        <span className="font-semibold text-sm">{persona.name}</span>
      </div>
      <p className="text-xs text-gray-400 mt-1 ml-5">
        {persona.description}
      </p>

      {/* Show key state values for non-real personas */}
      {persona.id !== 'real' && (
        <div className="mt-2 ml-5 flex flex-wrap gap-1">
          {persona.overrides.isClanktonHolder && (
            <StateTag label="CLANKTON" color="purple" />
          )}
          {!persona.overrides.hasSharedToday && persona.overrides.totalGuessesRemaining === 0 && (
            <StateTag label="Share Available" color="green" />
          )}
          {persona.overrides.hasSharedToday && (
            <StateTag label="Shared" color="gray" />
          )}
          {(persona.overrides.totalGuessesRemaining ?? 0) > 0 && (
            <StateTag
              label={`${persona.overrides.totalGuessesRemaining} guesses`}
              color="blue"
            />
          )}
          {persona.overrides.totalGuessesRemaining === 0 && (
            <StateTag label="No guesses" color="red" />
          )}
          {persona.overrides.paidPacksPurchased === 3 && (
            <StateTag label="Max packs" color="orange" />
          )}
        </div>
      )}
    </button>
  );
}

/**
 * Small colored tag for displaying state
 */
function StateTag({ label, color }: { label: string; color: string }) {
  const colorClasses: Record<string, string> = {
    purple: 'bg-purple-900/50 text-purple-300 border-purple-700',
    green: 'bg-green-900/50 text-green-300 border-green-700',
    gray: 'bg-gray-700/50 text-gray-400 border-gray-600',
    blue: 'bg-blue-900/50 text-blue-300 border-blue-700',
    red: 'bg-red-900/50 text-red-300 border-red-700',
    orange: 'bg-orange-900/50 text-orange-300 border-orange-700',
  };

  return (
    <span className={`
      text-[10px] px-1.5 py-0.5 rounded border
      ${colorClasses[color] || colorClasses.gray}
    `}>
      {label}
    </span>
  );
}

/**
 * Combined export for easy import
 */
export default function DevPersonaSwitcher() {
  return (
    <>
      <DevModeButton />
      <DevPersonaPanel />
    </>
  );
}
